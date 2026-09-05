import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { one, run } from "@/lib/db";
import { WEBHOOK_401_LIMITS, checkRate, recordFailure } from "@/lib/ratelimit";
import { handleCommand, startBotOnboarding, continueBotOnboarding,
         handleOnboardingButton, handleOnboardingText, handleWhyButton, handleLevelCapButton, handleUndoButton, handleDocument,
         handleDeleteButton, handleEditButton, handleFirstButton, handleLangButton, handleStartButton, sendFirstOffer,
         sendSiteLink } from "@/lib/bot";
import { freeTextAction } from "@/lib/bot-onboarding";
import { claimPending } from "@/lib/pending";
import { findUserByConnectHash, hashConnectToken, parseStartCommand } from "@/lib/connect-token";
import { isLocale } from "@/lib/i18n";
import { CV_MAX_BYTES } from "@/lib/cv";
import type { Locale } from "@/lib/vocab";
import { t as botCopy, tf as botCopyF } from "@/lib/bot-copy";
import { callTelegram, sendText } from "@/lib/telegram-send";

/**
 * Вебхук Telegram.
 *
 * Захист: приймаємо ЛИШЕ запити з секретним заголовком, який знає сам Telegram
 * (задається при setWebhook). Без нього сторонній, що дізнався адресу, міг би
 * підробити оновлення від будь-якого chat_id.
 *
 * Секрет закриває підробку оновлень, але НЕ закриває шлях, коли сторонній
 * пише боту зі свого справжнього чату чужим токеном із чату жертви. Проти
 * цього тут дві інші перепони, і обидві мусять стояти разом: токен прив'язки
 * і токен входу мають різні дайджести (connect-token.ts), а прив'язка не
 * переписує акаунт, у якого вже є свій Telegram (bindChat нижче).
 */
type Env = Record<string, string | undefined>;

export async function POST(request: Request): Promise<Response> {
  const env = getCloudflareContext().env as unknown as Env;
  const expected = env.TELEGRAM_WEBHOOK_SECRET;

  // Закриваємось за замовчуванням: поки секрет не заданий, вебхук не приймає
  // НІЧОГО. Умовна перевірка тут була б дірою — на свіжому деплої без секрету
  // будь-хто міг би слати оновлення від імені Telegram.
  // Невдалі спроби рахуємо за адресою: сам секрет — єдина перепона між
  // стороннім і чужим chat_id, тож підбирати його з пропускною здатністю
  // Workers не можна дозволити. Cloudflare сам ставить cf-connecting-ip,
  // клієнт його не підробить.
  const got = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || got !== expected) {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const key = `webhook401:${ip}`;
    if ((await checkRate(key)).allowed) await recordFailure(key, WEBHOOK_401_LIMITS);
    console.warn(`telegram webhook: bad secret from ${ip}`);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Telegram повторює оновлення, на яке не отримав 200, доки не отримає.
  // Один виняток усередині (наприклад, UNIQUE на telegram_chat_id) означав
  // би 500 і той самий апдейт по колу — назавжди. Тому будь-яка помилка
  // лишається в лозі, а Telegram чує «прийнято».
  try {
    await handle(env, await request.json());
  } catch (e) {
    console.error(`telegram webhook failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  return NextResponse.json({ ok: true });
}

/** Те з відправника, що нам потрібне: як його звати. */
interface Sender { language_code?: string; username?: string; first_name?: string; last_name?: string }

/**
 * Зберігає нік, лише коли він змінився.
 *
 * Людина пише боту десятки разів на день; UPDATE на кожне натискання кнопки
 * був би записом у базу заради того самого рядка. Умова в WHERE робить це
 * безкоштовним: збіг — і жоден рядок не чіпається.
 */
async function rememberName(chatId: number, from: Sender | undefined): Promise<void> {
  if (!from) return;
  const username = from.username ?? null;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
  if (!username && !name) return;
  // Ключ — chat_id, а не id акаунта: людина, що тільки-но створилась у цьому
  // ж оновленні, рядка ще не мала, коли ми його шукали. Її нік доїде
  // наступним повідомленням, а не загубиться в гілці «акаунт незнайомий».
  await run(
    `UPDATE users SET telegram_username=?, telegram_name=?
      WHERE telegram_chat_id=? AND (COALESCE(telegram_username,'') <> COALESCE(?,'')
                                 OR COALESCE(telegram_name,'') <> COALESCE(?,''))`,
    username, name, String(chatId), username, name);
}

async function handle(env: Env, raw: unknown): Promise<void> {
  const update = raw as {
    update_id?: number;
    message?: { text?: string; chat?: { id?: number };
                document?: { file_id?: string; file_name?: string; file_size?: number };
                from?: Sender };
    callback_query?: { data?: string; message?: { chat?: { id?: number } }; id?: string;
                       from?: Sender };
  };

  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return;

  // Кожен update_id обробляємо один раз. Telegram сам повторює оновлення,
  // на яке не почув 200, а той, хто якось перехопив тіло запиту, міг би
  // прокручувати його по колу (наприклад, підтвердження видалення).
  if (typeof update.update_id === "number" && !(await claimUpdate(update.update_id))) return;

  const text = update.message?.text?.trim() ?? "";
  const callback = update.callback_query?.data;

  // Одне джерело правди про мову.
  //
  // Добірку шле сканер за users.locale, а кнопки відповідав вебхук за
  // language_code із Telegram. У людини з українським акаунтом і англійським
  // клієнтом мова стрибала посеред розмови: добірка українською, питання під
  // нею англійською.
  //
  // Тепер збережена мова перемагає завжди. Telegram лишається першим здогадом
  // лише для того, у кого акаунта ще немає.
  const known = await one<{ id: string; locale: string }>(
    "SELECT id,locale FROM users WHERE telegram_chat_id=?", String(chatId));

  // Нік — побіжно, з того самого оновлення. Telegram кладе його в КОЖЕН
  // апдейт, і ми його весь час викидали: в адмінці людина була вісьмома
  // символами UUID, за якими нікого не впізнати й нікому не написати.
  await rememberName(chatId, update.message?.from ?? update.callback_query?.from);

  // Слід дотику — окремим рядком, бо `webhook_updates` живе добу й існує
  // заради захисту від повторів, а не заради історії. Пишемо лише рід дії:
  // що саме людина написала, для графіка активності не потрібно.
  await run("INSERT INTO bot_activity (chat_id, kind) VALUES (?,?)",
    String(chatId), update.callback_query ? "button" : "message");
  const langCode = (update.message?.from?.language_code
    ?? update.callback_query?.from?.language_code ?? "en").slice(0, 2).toLowerCase();
  const locale = known && isLocale(known.locale)
    ? known.locale
    : isLocale(langCode) ? langCode : "en";

  // ── /start із токеном: прив'язка акаунту, створеного на сайті ──
  const startToken = parseStartCommand(text);

  // Глибоке посилання «увійти на сайт»: сторінка входу веде сюди, і одного
  // дотику по Start досить. Без цього людині доводилось знати команду /site.
  if (startToken === "site") {
    await handleCommand(env, chatId, "/site", locale);
    return;
  }

  if (startToken) {
    // Двері прив'язки рахують СВІЙ дайджест. Токен, виданий для входу на сайт
    // (його бот шле текстом у чат, і він читається зі скриншота), тут не
    // знаходить рядка взагалі — не «знаходить і не проходить перевірку».
    // Різниця принципова: перевірку поруч можна прибрати рефактором, а
    // дайджест іншого призначення не збігається ніколи.
    const linkHash = await hashConnectToken("link", startToken);
    const user = await findUserByConnectHash(linkHash);

    /**
     * Анкета з сайту, у якої ще немає акаунта.
     *
     * Це головний шлях реєстрації з сайту, відколи акаунт народжується саме
     * тут. Підтвердження кнопкою тут НЕ питаємо: воно захищає від прив'язки
     * чужого наявного акаунта, а тут прив'язувати нічого — акаунт з'явиться
     * рівно від цього дотику.
     */
    if (!user) {
      const claimed = await claimPending(startToken, String(chatId));
      if (claimed) {
        /**
         * Забрану анкету можна забрати ще раз — але лише СВОЄМУ чату.
         *
         * claimPending для вже забраного рядка віддає claimed_user_id кому
         * завгодно, а нижче йде безумовний sendSiteLink — тобто посилання
         * входу в чужий кабінет, і повторювати це можна сім днів (стільки
         * живе pending_signups проти 15 хвилин у connect-токена). Обіцянка,
         * записана в 0039: «Знання токена дає рівно одне право — забрати цю
         * анкету собі, і рівно один раз».
         *
         * Перевіряємо не окремим стовпцем, а самим наслідком claim'у: акаунт,
         * що забрав анкету, має її чат у telegram_chat_id. Це не потребує
         * міграції й не бреше про минуле, як заповнений заднім числом стовпець.
         * Стороннього проводжаємо тим самим «застаріло»: чесніше сказати
         * менше, ніж повідомити, що такий рядок існує і чий він.
         */
        if (!claimed.fresh) {
          const owner = await one<{ telegram_chat_id: string | null }>(
            "SELECT telegram_chat_id FROM users WHERE id=?", claimed.userId);
          if (owner?.telegram_chat_id !== String(chatId)) {
            console.warn(`telegram webhook: pending token replayed from chat ${chatId}`);
            await send(env, chatId, botCopy("linkExpired", locale));
            return;
          }
        }
        // Мова анкети, а не мова Telegram: людина щойно писала про себе на
        // сайті саме нею, і бот має відповісти тією ж.
        const mine = isLocale(claimed.locale) ? claimed.locale : locale;
        await send(env, chatId, botCopy("linked", mine));
        await sendSiteLink(env, chatId, claimed.userId, mine, "cabinet");
        await sendFirstOffer(env, chatId, claimed.userId, mine);
        return;
      }
    }

    // Свіжість перевіряє findUserByConnectHash: строк живе в одному місці з
    // видачею, а не переписується в кожних дверях.
    if (!user) {
      await send(env, chatId, botCopy("linkExpired", locale));
      return;
    }

    // Не прив'язуємо одразу: спершу людина підтверджує кнопкою. У bot_state
    // лягає ХЕШ, а не сам токен: інакше ми прибрали б відкритий секрет із
    // users і лишили його в сусідній таблиці, де він до того ж живе довше —
    // прибиральника bot_state немає ні у web/, ні в scanner/, тож рядок
    // лежить, доки чат не зробить чогось іншого.
    await run(
      `INSERT INTO bot_state (chat_id, step, draft, message_id, updated_at)
       VALUES (?, ?, '{}', NULL, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET step=excluded.step, draft='{}', message_id=NULL, updated_at=datetime('now')`,
      String(chatId), `link:${linkHash}`);
    await callTelegram(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId, text: botCopy("linkAsk", locale),
      reply_markup: { inline_keyboard: [[
        { text: botCopy("linkYes", locale), callback_data: "lk:yes" },
        { text: botCopy("linkNo", locale),  callback_data: "lk:no" },
      ]] },
    });
    return;
  }

  // ── /start без токена: повна реєстрація прямо в чаті ──
  if (/^\/start\b/.test(text)) {
    await startBotOnboarding(env, chatId, locale);
    return;
  }

  if (text.startsWith("/")) {
    await handleCommand(env, chatId, text, locale);
    return;
  }

  if (callback) {
    const cbId = update.callback_query?.id;
    if (callback.startsWith("lk:")) {
      if (cbId) await callTelegram(env.TELEGRAM_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbId });
      await handleLinkButton(env, chatId, callback, locale);
      return;
    }
    if (await handleDeleteButton(env, chatId, callback, cbId, locale)) return;
    if (await handleStartButton(env, chatId, callback, cbId, locale)) return;
    if (await handleFirstButton(env, chatId, callback, cbId, locale)) return;
    if (await handleEditButton(env, chatId, callback, cbId, locale)) return;
    if (await handleLangButton(env, chatId, callback, cbId)) return;
    // Кнопки онбордингу йдуть першими: реакції на добірку мають префікс fb:
    if (await handleOnboardingButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    if (await handleLevelCapButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    if (await handleUndoButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    if (await handleWhyButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    await continueBotOnboarding(env, chatId, callback, locale, update.callback_query?.id);
    return;
  }

  // Резюме файлом. До вільного тексту, бо документ приходить без тексту.
  const doc = update.message?.document;
  if (doc?.file_id) {
    // Стеля та сама, що на сайті (CV_MAX_BYTES): той самий файл не має
    // проходити там і відскакувати тут. Раніше на завеликий файл ішов /help —
    // тобто список команд у відповідь на «ось моє резюме». Виглядало як
    // поломка, а не як відповідь.
    if ((doc.file_size ?? 0) > CV_MAX_BYTES) {
      await sendText(env.TELEGRAM_BOT_TOKEN, chatId, botCopy("cvTooBig", locale));
      return;
    }
    await handleDocument(env, chatId, doc.file_id, doc.file_name ?? "cv.pdf", locale);
    return;
  }

  // Єдине місце, де в онбордингу лишився вільний текст, — «інша сума»
  if (text.length >= 1 && await handleOnboardingText(env, chatId, text, locale)) {
    return;
  }

  // Вільний текст поза командами.
  //
  // Раніше тут жила «реєстрація одним реченням»: будь-які три літери від
  // будь-кого ставали профілем. Для того, хто вже підключений, це означало
  // профіль, переписаний порожніми сферами, — і відповідь українською всім.
  // Тепер: у кого профіль є — текст стає ПОБАЖАННЯМ і дописується до
  // profiles.wishes, решта профілю не торкається. Новачка веде та сама
  // кнопкова анкета, що й /start, а написане стає її підказкою.
  if (text.length >= 3) {
    // Відкрите меню правки — не питання: людина нічого не набирає для нього,
    // тож текст лишається побажанням, як і поза правкою.
    const state = await one<{ step: string }>("SELECT step FROM bot_state WHERE chat_id=?", String(chatId));
    const inFlow = Boolean(state) && state!.step !== "edit:menu";
    const hasProfile = known
      ? await one<{ user_id: string }>("SELECT user_id FROM profiles WHERE user_id=?", known.id) : null;

    switch (freeTextAction(Boolean(known), Boolean(hasProfile), inFlow)) {
      case "useButtons":
        // Коротке слово посеред питань: анкету не перезапускаємо, бо це
        // стерло б уже обране.
        await send(env, chatId, botCopy("useButtons", locale));
        return;
      case "wish": {
        const wish = text.slice(0, 1000);
        // Дописуємо, а не замінюємо: людина може надіслати кілька побажань
        // у різні дні, і кожне має пережити наступне.
        await run(
          `UPDATE profiles SET wishes=TRIM(COALESCE(wishes,'') || char(10) || ?, char(10) || ' '), updated_at=datetime('now')
            WHERE user_id=?`, wish, known!.id);
        await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", known!.id);
        await send(env, chatId, botCopyF("wishNoted", locale, { text: wish.slice(0, 200) }));
        return;
      }
      case "hint":
        await send(env, chatId, botCopy("freeTextHint", locale));
        return;
      case "register":
        await startBotOnboarding(env, chatId, locale);
        if (text.length >= 8) await handleOnboardingText(env, chatId, text, locale);
        return;
    }
  }
}

async function send(env: Record<string, string | undefined>, chatId: number, text: string): Promise<void> {
  await sendText(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

/**
 * Позначає update_id як побачений. false — уже бачили, обробляти не треба.
 * Старі позначки прибираємо дорогою: таблиця не має рости вічно.
 */
async function claimUpdate(updateId: number): Promise<boolean> {
  const seen = await one<{ n: number }>(
    "SELECT 1 n FROM webhook_updates WHERE update_id=?", updateId);
  if (seen) return false;
  await run("INSERT OR IGNORE INTO webhook_updates (update_id) VALUES (?)", updateId);
  await run("DELETE FROM webhook_updates WHERE seen_at < datetime('now','-1 day')");
  return true;
}

/** Відповідь на «прив'язати цей Telegram?». Токен беремо з bot_state, не з кнопки. */
async function handleLinkButton(
  env: Record<string, string | undefined>, chatId: number, data: string, locale: Locale,
): Promise<void> {
  const state = await one<{ step: string }>("SELECT step FROM bot_state WHERE chat_id=?", String(chatId));
  await run("DELETE FROM bot_state WHERE chat_id=? AND step LIKE 'link:%'", String(chatId));
  // У кроці лежить уже готовий хеш — хешувати вдруге не треба й не можна.
  const hash = state?.step.startsWith("link:") ? state.step.slice(5) : null;
  if (data !== "lk:yes" || !hash) {
    await send(env, chatId, botCopy("linkCancelled", locale));
    return;
  }
  const user = await findUserByConnectHash(hash);
  if (!user) {
    await send(env, chatId, botCopy("linkExpired", locale));
    return;
  }
  await bindChat(env, chatId, user.id, locale);
}

/** Власне прив'язка chat_id до акаунта — після підтвердження. */
async function bindChat(
  env: Record<string, string | undefined>, chatId: number, userId: string, locale: Locale,
): Promise<void> {
  const user = { id: userId };

  /**
   * Чи не перевішуємо ми акаунт, у якого вже є СВІЙ Telegram.
   *
   * Це друга половина тієї самої діри. Усі три перевірки нижче дивляться на
   * ЧАТ того, хто натиснув: чи він належить іншому акаунту, чи має історію
   * добірок, чи він часом не власників. Жодна не дивиться на акаунт, який
   * зараз перепишуть. Тому свіжий чат нападника проходив їх усі, а рядок
   * жертви мовчки переїжджав: добірки далі йшли в чат нападника (сканер бере
   * users.telegram_chat_id), а сама жертва зникала з бота — за її chat_id
   * більше не було акаунта, і /start дав би їй новий, порожній.
   *
   * Умова саме «IS NOT NULL і не цей чат», а не «не дорівнює цьому чату»:
   * акаунт, відв'язаний при переприв'язці (paused_reason='relinked'), має тут
   * NULL, і наївне порівняння заблокувало б саме той законний випадок, заради
   * якого відв'язка й існує. Повторний дотик тим самим чатом теж проходить.
   *
   * Переїзд на інший Telegram — окрема дія ВЛАСНИКА продукту («відв'язати
   * Telegram» у панелі), а не наслідок дотику по посиланню, яке хтось побачив.
   *
   * Відмова — той самий `linkExpired`, що й на вигаданий токен, і це свідомо.
   * Дві вимоги тягнули в різні боки: сторонній не має відрізнити «токена не
   * існує» від «токен справжній, і акаунт чужий» (інакше він перевіряє здогади
   * по одному й дізнається, що акаунт живий), а людина, яка справді втратила
   * свій Telegram, мусить почути, що робити далі. Розв'язок не в тому, щоб
   * обрати одну вимогу, а в тому, щоб порада була ОДНАКОВА для обох: у
   * `linkExpired` тепер названо /feedback, і ця порада не залежить від того,
   * існує рядок чи ні. Стороннього вона нікуди не веде, людину — веде.
   * Хто саме відскочив, лишається в лозі: він видимий нам, не чату.
   */
  const target = await one<{ telegram_chat_id: string | null }>(
    "SELECT telegram_chat_id FROM users WHERE id=?", user.id);
  if (target?.telegram_chat_id && target.telegram_chat_id !== String(chatId)) {
    console.warn(`telegram webhook: refused to move user ${user.id} from its own chat to ${chatId}`);
    await send(env, chatId, botCopy("linkExpired", locale));
    return;
  }

  // Цей chat_id може вже належати іншому акаунту — тому, що людина колись
  // пройшла /start у боті, а тепер зареєструвалась на сайті. UNIQUE не дав
  // би прив'язати. Правило: акаунт із сайту головний (у нього свіжий
  // профіль); ботовий, який ще нічого не отримував, просто відв'язується.
  // А якщо він уже має історію добірок — нічого не чіпаємо, людина сама обирає.
  //
  // Chat_id власника — виняток без винятків. Адмінство визначається саме
  // ним, тож підроблене оновлення «/start <мій токен>» від імені цього
  // chat_id перевісило б адмінку на чужий акаунт. Тому такий зв'язок
  // приймаємо лише тоді, коли акаунт уже і є акаунтом власника.
  const other = await one<{ id: string }>(
    "SELECT id FROM users WHERE telegram_chat_id=? AND id<>?", String(chatId), user.id);
  if (other) {
    if (env.ADMIN_CHAT_ID && String(chatId) === env.ADMIN_CHAT_ID) {
      console.warn(`telegram webhook: refused to relink ADMIN_CHAT_ID to user ${user.id}`);
      await send(env, chatId, botCopy("alreadyLinked", locale));
      return;
    }
    const hasHistory = await one<{ n: number }>("SELECT 1 n FROM sent WHERE user_id=? LIMIT 1", other.id);
    if (hasHistory) {
      await send(env, chatId, botCopy("alreadyLinked", locale));
      return;
    }
    // Не стираємо: рядок лишається без Telegram і без розсилки. Видалення
    // чужого акаунту з вебхука — надто гострий інструмент для цього місця.
    await run(
      `UPDATE users SET telegram_chat_id=NULL, status='paused', paused_reason='relinked',
         updated_at=datetime('now') WHERE id=?`, other.id);
    // Втратив чат — втратив і сесії. Сесія живе 30 днів і від Telegram не
    // залежить узагалі, а прив'язка відмикається саме умовою «чату немає»
    // (перевірка на десять рядків вище). Тобто рядок без чату, у якого
    // лишилась жива сесія, знову можна перевісити на будь-який Telegram —
    // рівно та самообслуговна перепривʼязка, від якої тут і захищаємось.
    // Само собою це місце дірою не було: сесії цього рядка видавались саме
    // в цей чат, тобто тому, хто зараз і тисне кнопку. Але стан після нього
    // однаковий, тож і правило одне.
    await run("DELETE FROM sessions WHERE user_id=?", other.id);
    await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
  }

  await run(
    `UPDATE users SET telegram_chat_id=?, connect_token_hash=NULL, connect_expires_at=NULL,
       last_interaction_at=datetime('now') WHERE id=?`,
    String(chatId), user.id);
  // Акаунт міг лежати на паузі саме через відсутність Telegram — тепер
  // причина зникла. Перелік мусить покривати ОБИДВІ причини «слати нема куди»,
  // бо жодну з них не ставить людина, їх ставимо ми самі:
  //   'no_telegram' — сканер, побачивши рядок без чату (orphans.ts);
  //   'relinked'    — цей самий bindChat, десятьма рядками вище, коли забирає
  //                   чат у попереднього акаунта.
  // Другої тут якраз і не було. Тобто законний шлях «акаунт після паузи
  // relinked підключається назад» закінчувався мовчазною паузою: сканер шле
  // добірки лише за status='active', тож людина чула «готово» і не отримувала
  // нічого, ніколи, без жодного повідомлення.
  //
  // 'manual' сюди не входить свідомо: там паузу обрала сама людина («/pause»),
  // і прив'язка чату не є скасуванням її рішення.
  await run(
    `UPDATE users SET status='active', paused_reason=NULL, paused_at=NULL
      WHERE id=? AND paused_reason IN ('no_telegram','relinked')`, user.id);
  await send(env, chatId, botCopy("linked", locale));
  await sendFirstOffer(env, chatId, user.id, locale);
}
