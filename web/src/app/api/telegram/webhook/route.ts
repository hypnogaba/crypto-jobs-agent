import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { one, run, uuid } from "@/lib/db";
import { parseProfile } from "@/lib/parse";
import { handleCommand, startBotOnboarding, continueBotOnboarding,
         handleOnboardingButton, handleOnboardingText } from "@/lib/bot";
import { isLocale } from "@/lib/i18n";
import { t as botCopy } from "@/lib/bot-copy";

/**
 * Вебхук Telegram.
 *
 * Захист: приймаємо ЛИШЕ запити з секретним заголовком, який знає сам Telegram
 * (задається при setWebhook). Без нього сторонній, що дізнався адресу, міг би
 * перехопити чужий connect_token і привласнити акаунт до того, як людина
 * завершить онбординг.
 */
export async function POST(request: Request): Promise<Response> {
  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  const expected = env.TELEGRAM_WEBHOOK_SECRET;

  // Закриваємось за замовчуванням: поки секрет не заданий, вебхук не приймає
  // НІЧОГО. Умовна перевірка тут була б дірою — на свіжому деплої без секрету
  // будь-хто міг би слати оновлення від імені Telegram.
  const got = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || got !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as {
    message?: { text?: string; chat?: { id?: number }; document?: { file_id?: string };
                from?: { language_code?: string } };
    callback_query?: { data?: string; message?: { chat?: { id?: number } }; id?: string;
                       from?: { language_code?: string } };
  };

  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return NextResponse.json({ ok: true });

  const text = update.message?.text?.trim() ?? "";
  const callback = update.callback_query?.data;

  // Telegram сам каже, якою мовою людина користується. Досі тут стояло жорстке
  // "en", тож той, хто зареєструвався в боті, отримував англійський сайт.
  const langCode = (update.message?.from?.language_code
    ?? update.callback_query?.from?.language_code ?? "en").slice(0, 2).toLowerCase();
  const locale = isLocale(langCode) ? langCode : "en";

  // ── /start із токеном: прив'язка акаунту, створеного на сайті ──
  const startToken = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text)?.[1];

  // Глибоке посилання «увійти на сайт»: сторінка входу веде сюди, і одного
  // дотику по Start досить. Без цього людині доводилось знати команду /site.
  if (startToken === "site") {
    await handleCommand(env, chatId, "/site", locale);
    return NextResponse.json({ ok: true });
  }

  if (startToken) {
    const user = await one<{ id: string; connect_expires_at: string | null }>(
      "SELECT id,connect_expires_at FROM users WHERE connect_token=?", startToken);

    const fresh = user?.connect_expires_at && new Date(user.connect_expires_at).getTime() > Date.now();
    if (user && fresh) {
      await run(
        `UPDATE users SET telegram_chat_id=?, connect_token=NULL, connect_expires_at=NULL,
           last_interaction_at=datetime('now') WHERE id=?`,
        String(chatId), user.id);
      await send(env, chatId, botCopy("linked", locale));
    } else {
      await send(env, chatId, botCopy("linkExpired", locale));
    }
    return NextResponse.json({ ok: true });
  }

  // ── /start без токена: повна реєстрація прямо в чаті ──
  if (/^\/start\b/.test(text)) {
    await startBotOnboarding(env, chatId, locale);
    return NextResponse.json({ ok: true });
  }

  if (text.startsWith("/")) {
    await handleCommand(env, chatId, text, locale);
    return NextResponse.json({ ok: true });
  }

  if (callback) {
    // Кнопки онбордингу йдуть першими: реакції на добірку мають префікс fb:
    if (await handleOnboardingButton(env, chatId, callback, update.callback_query?.id, locale)) {
      return NextResponse.json({ ok: true });
    }
    await continueBotOnboarding(env, chatId, callback, locale);
    return NextResponse.json({ ok: true });
  }

  // Єдине місце, де в онбордингу лишився вільний текст, — «інша сума»
  if (text.length >= 1 && await handleOnboardingText(env, chatId, text, locale)) {
    return NextResponse.json({ ok: true });
  }

  // Вільний текст від людини, що реєструється в боті
  if (text.length >= 3) {
    const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
    const parsed = await parseProfile(text, env.ANTHROPIC_API_KEY ?? null);
    const userId = existing?.id ?? uuid();

    if (!existing) {
      await run(
        `INSERT INTO users (id,telegram_chat_id,locale,timezone,delivery_hour,last_interaction_at)
         VALUES (?,?,?,?,7,datetime('now'))`,
        userId, String(chatId), locale, "UTC");
    }

    await run(
      `INSERT INTO profiles (user_id,mode,raw_input,spheres,industries,seniority,remote_mode,location,salary_min,salary_currency,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         raw_input=excluded.raw_input, spheres=excluded.spheres, industries=excluded.industries,
         seniority=excluded.seniority, remote_mode=excluded.remote_mode, location=excluded.location,
         salary_min=excluded.salary_min, salary_currency=excluded.salary_currency, updated_at=datetime('now')`,
      userId, text.length > 800 ? "cv" : "freetext", text.slice(0, 20_000),
      JSON.stringify(parsed.spheres), JSON.stringify(parsed.industries),
      parsed.seniority, parsed.remoteMode, parsed.location, parsed.salaryMin, parsed.salaryCurrency);

    await send(env, chatId,
      `Зрозумів так:\n\n` +
      `Сфери: ${parsed.spheres.join(", ") || "не визначено"}\n` +
      `Рівень: ${parsed.seniority ?? "не визначено"}\n` +
      `Робота: ${parsed.remoteMode}\n` +
      `Зарплата від: ${parsed.salaryMin ? `${parsed.salaryMin} ${parsed.salaryCurrency ?? ""}` : "не вказано"}\n\n` +
      `Якщо все вірно — нічого не роби, перша добірка прийде завтра вранці. ` +
      `Якщо ні — просто напиши уточнення ще раз.`);
  }

  return NextResponse.json({ ok: true });
}

async function send(env: Record<string, string | undefined>, chatId: number, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}
