import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { one, run } from "@/lib/db";
import { WEBHOOK_401_LIMITS, checkRate, recordFailure } from "@/lib/ratelimit";
import { handleCommand, startBotOnboarding, continueBotOnboarding,
         handleOnboardingButton, handleOnboardingText, handleWhyButton, handleDocument,
         handleDeleteButton, handleEditButton, handleFirstButton, handleLangButton, handleStartButton, sendFirstOffer } from "@/lib/bot";
import { freeTextAction } from "@/lib/bot-onboarding";
import { isLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";
import { t as botCopy, tf as botCopyF } from "@/lib/bot-copy";
import { callTelegram, sendText } from "@/lib/telegram-send";

/**
 * Вебхук Telegram.
 *
 * Захист: приймаємо ЛИШЕ запити з секретним заголовком, який знає сам Telegram
 * (задається при setWebhook). Без нього сторонній, що дізнався адресу, міг би
 * перехопити чужий connect_token і привласнити акаунт до того, як людина
 * завершить онбординг.
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

async function handle(env: Env, raw: unknown): Promise<void> {
  const update = raw as {
    update_id?: number;
    message?: { text?: string; chat?: { id?: number };
                document?: { file_id?: string; file_name?: string; file_size?: number };
                from?: { language_code?: string } };
    callback_query?: { data?: string; message?: { chat?: { id?: number } }; id?: string;
                       from?: { language_code?: string } };
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
  const langCode = (update.message?.from?.language_code
    ?? update.callback_query?.from?.language_code ?? "en").slice(0, 2).toLowerCase();
  const locale = known && isLocale(known.locale)
    ? known.locale
    : isLocale(langCode) ? langCode : "en";

  // ── /start із токеном: прив'язка акаунту, створеного на сайті ──
  const startToken = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text)?.[1];

  // Глибоке посилання «увійти на сайт»: сторінка входу веде сюди, і одного
  // дотику по Start досить. Без цього людині доводилось знати команду /site.
  if (startToken === "site") {
    await handleCommand(env, chatId, "/site", locale);
    return;
  }

  if (startToken) {
    const user = await one<{ id: string; connect_expires_at: string | null }>(
      "SELECT id,connect_expires_at FROM users WHERE connect_token=?", startToken);

    const fresh = user?.connect_expires_at && new Date(user.connect_expires_at).getTime() > Date.now();
    if (!user || !fresh) {
      await send(env, chatId, botCopy("linkExpired", locale));
      return;
    }

    // Не прив'язуємо одразу: спершу людина підтверджує кнопкою. Токен
    // лишається в bot_state до відповіді; його свіжість перевіримо ще раз.
    await run(
      `INSERT INTO bot_state (chat_id, step, draft, message_id, updated_at)
       VALUES (?, ?, '{}', NULL, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET step=excluded.step, draft='{}', message_id=NULL, updated_at=datetime('now')`,
      String(chatId), `link:${startToken}`);
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
    if (await handleWhyButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    await continueBotOnboarding(env, chatId, callback, locale, update.callback_query?.id);
    return;
  }

  // Резюме файлом. До вільного тексту, бо документ приходить без тексту.
  const doc = update.message?.document;
  if (doc?.file_id) {
    // Три мегабайти — стеля: більше майже напевно скан, який ми не прочитаємо.
    if ((doc.file_size ?? 0) > 3_000_000) {
      await handleCommand(env, chatId, "/help", locale);
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
  const token = state?.step.startsWith("link:") ? state.step.slice(5) : null;
  if (data !== "lk:yes" || !token) {
    await send(env, chatId, botCopy("linkCancelled", locale));
    return;
  }
  const user = await one<{ id: string; connect_expires_at: string | null }>(
    "SELECT id,connect_expires_at FROM users WHERE connect_token=?", token);
  const fresh = user?.connect_expires_at && new Date(user.connect_expires_at).getTime() > Date.now();
  if (!user || !fresh) {
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
    await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
  }

  await run(
    `UPDATE users SET telegram_chat_id=?, connect_token=NULL, connect_expires_at=NULL,
       last_interaction_at=datetime('now') WHERE id=?`,
    String(chatId), user.id);
  await send(env, chatId, botCopy("linked", locale));
  await sendFirstOffer(env, chatId, user.id, locale);
}
