import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { one, run } from "@/lib/db";
import { handleCommand, startBotOnboarding, continueBotOnboarding,
         handleOnboardingButton, handleOnboardingText, handleWhyButton, handleDocument } from "@/lib/bot";
import { isLocale } from "@/lib/i18n";
import { t as botCopy } from "@/lib/bot-copy";
import { sendText } from "@/lib/telegram-send";

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
  const got = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || got !== expected) {
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
    message?: { text?: string; chat?: { id?: number };
                document?: { file_id?: string; file_name?: string; file_size?: number };
                from?: { language_code?: string } };
    callback_query?: { data?: string; message?: { chat?: { id?: number } }; id?: string;
                       from?: { language_code?: string } };
  };

  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return;

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
  const known = await one<{ locale: string }>(
    "SELECT locale FROM users WHERE telegram_chat_id=?", String(chatId));
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

    // Цей chat_id може вже належати іншому акаунту — тому, що людина колись
    // пройшла /start у боті, а тепер зареєструвалась на сайті. UNIQUE не дав
    // би прив'язати. Правило: акаунт із сайту головний (у нього свіжий
    // профіль); ботовий, який ще нічого не отримував, просто зникає. А якщо
    // він уже має історію добірок — нічого не стираємо, людина сама обирає.
    const other = await one<{ id: string }>(
      "SELECT id FROM users WHERE telegram_chat_id=? AND id<>?", String(chatId), user.id);
    if (other) {
      const hasHistory = await one<{ n: number }>("SELECT 1 n FROM sent WHERE user_id=? LIMIT 1", other.id);
      if (hasHistory) {
        await send(env, chatId, botCopy("alreadyLinked", locale));
        return;
      }
      await run("DELETE FROM users WHERE id=?", other.id);       // каскад стирає профіль і запити
      await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
    }

    await run(
      `UPDATE users SET telegram_chat_id=?, connect_token=NULL, connect_expires_at=NULL,
         last_interaction_at=datetime('now') WHERE id=?`,
      String(chatId), user.id);
    await send(env, chatId, botCopy("linked", locale));
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
    // Кнопки онбордингу йдуть першими: реакції на добірку мають префікс fb:
    if (await handleOnboardingButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    if (await handleWhyButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return;
    }
    await continueBotOnboarding(env, chatId, callback, locale);
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
  // Тепер акаунт із вільного тексту не створюється ніде: новачка веде та
  // сама кнопкова анкета, що й /start, а написане стає її підказкою.
  if (text.length >= 3) {
    const inFlow = await one<{ chat_id: string }>("SELECT chat_id FROM bot_state WHERE chat_id=?", String(chatId));
    if (inFlow) {
      // Коротке слово посеред питань: анкету не перезапускаємо, бо це
      // стерло б уже обране.
      await send(env, chatId, botCopy("useButtons", locale));
    } else if (known) {
      await send(env, chatId, botCopy("freeTextHint", locale));
    } else {
      await startBotOnboarding(env, chatId, locale);
      if (text.length >= 8) await handleOnboardingText(env, chatId, text, locale);
    }
  }
}

async function send(env: Record<string, string | undefined>, chatId: number, text: string): Promise<void> {
  await sendText(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
