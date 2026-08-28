import { one, run, uuid } from "./db";
import {
  emptyDraft, keyboard, nextStep, questionText, askOtherAmount, readyText,
  summary, toggle, type Draft, type Step,
} from "./bot-onboarding";
import { isLocale } from "./i18n";
import type { Locale } from "./vocab";

/** Команди бота. Кабінет у чаті — мінімальний, повний лишається на сайті. */

type Env = Record<string, string | undefined>;

async function send(env: Env, chatId: number, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

// ── Покроковий онбординг ──────────────────────────────────────
// Кнопки, а не вільний текст: людині не було зрозуміло, що писати, а бот
// мовчки приймав будь-що — на «тест» він зберігав порожній профіль.

interface Keyed { text: string; callback_data: string }

async function sendKeyboard(
  env: Env, chatId: number, text: string, rows: Keyed[][]
): Promise<number | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: rows } }),
  });
  const body = (await res.json()) as { result?: { message_id?: number } };
  return body.result?.message_id ?? null;
}

/** Редагуємо те саме повідомлення, щоб чат не заріс десятком однакових. */
async function editKeyboard(
  env: Env, chatId: number, messageId: number, text: string, rows: Keyed[][]
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text,
                           reply_markup: { inline_keyboard: rows } }),
  });
}

/** Без цього кнопка крутиться, доки Telegram не здасться. */
async function ackButton(env: Env, callbackId: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
  });
}

interface StateRow { step: string; draft: string; message_id: number | null }

const readDraft = (raw: string): Draft => {
  try { return { ...emptyDraft(), ...(JSON.parse(raw) as Partial<Draft>) }; }
  catch { return emptyDraft(); }
};

async function saveState(chatId: number, step: Step, draft: Draft, messageId: number | null): Promise<void> {
  await run(
    `INSERT INTO bot_state (chat_id,step,draft,message_id,updated_at)
     VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       step=excluded.step, draft=excluded.draft,
       message_id=COALESCE(excluded.message_id, bot_state.message_id),
       updated_at=datetime('now')`,
    String(chatId), step, JSON.stringify(draft), messageId);
}

export async function startBotOnboarding(env: Env, chatId: number, locale: Locale = "en"): Promise<void> {
  const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (existing) {
    await send(env, chatId, "Ти вже підключений. /profile — подивитись профіль, /time — змінити годину, /pause — призупинити.");
    return;
  }

  const greeting = locale === "uk"
    ? "Привіт. Я щоранку надсилаю п'ять вакансій, підібраних під тебе.\nЧотири питання, тридцять секунд."
    : "Hi. Every morning I send five jobs picked for you.\nFour questions, thirty seconds.";
  await send(env, chatId, greeting);

  const draft = emptyDraft();
  const id = await sendKeyboard(env, chatId, questionText("spheres", locale), keyboard("spheres", draft, locale));
  await saveState(chatId, "spheres", draft, id);
}

/** Один дотик по кнопці. Повертає true, якщо це справді був онбординг. */
export async function handleOnboardingButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined, locale: Locale
): Promise<boolean> {
  if (!data.startsWith("ob:")) return false;
  if (callbackId) await ackButton(env, callbackId);

  const [, field, value] = data.split(":");
  if (field === "noop" || !field || value === undefined) return true;

  const row = await one<StateRow>("SELECT step,draft,message_id FROM bot_state WHERE chat_id=?", String(chatId));
  if (!row) return true;                       // стан загубився — мовчимо, /start почне заново

  const draft = readDraft(row.draft);
  const step = row.step as Step;

  // Кілька відповідей: перемикаємо й перемальовуємо те саме питання
  if ((step === "spheres" || step === "industries") && value !== "__next") {
    if (step === "spheres") draft.spheres = toggle(draft.spheres, value);
    else draft.industries = toggle(draft.industries, value);
    await saveState(chatId, step, draft, null);
    if (row.message_id) {
      await editKeyboard(env, chatId, row.message_id, questionText(step, locale), keyboard(step, draft, locale));
    }
    return true;
  }

  // Одна відповідь — або «Готово» в списку з кількома
  if (step === "seniority") draft.seniority = value;
  if (step === "where") draft.remoteMode = value;
  if (step === "salary") {
    if (value === "__other") {
      await saveState(chatId, "salary", draft, null);
      await send(env, chatId, askOtherAmount(locale));
      return true;
    }
    const n = Number.parseInt(value, 10);
    draft.salaryMin = Number.isFinite(n) && n > 0 ? n : null;
    draft.salaryCurrency = draft.salaryMin ? "EUR" : null;
  }

  const after = nextStep(step);
  if (after) {
    await saveState(chatId, after, draft, null);
    if (row.message_id) {
      await editKeyboard(env, chatId, row.message_id, questionText(after, locale), keyboard(after, draft, locale));
    }
    return true;
  }

  await finishOnboarding(env, chatId, draft, locale, row.message_id);
  return true;
}

/** «Інша сума» — єдине місце, де в онбордингу лишився вільний текст. */
export async function handleOnboardingText(
  env: Env, chatId: number, text: string, locale: Locale
): Promise<boolean> {
  const row = await one<StateRow>("SELECT step,draft,message_id FROM bot_state WHERE chat_id=?", String(chatId));
  if (!row || row.step !== "salary") return false;

  const m = /(\d[\d\s.,]*)\s*([a-zA-Z€$£]{1,4})?/.exec(text);
  const amount = m ? Number.parseInt(m[1]!.replace(/[^\d]/g, ""), 10) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    await send(env, chatId, askOtherAmount(locale));
    return true;
  }

  const draft = readDraft(row.draft);
  draft.salaryMin = amount;
  const cur = (m?.[2] ?? "EUR").toUpperCase().replace("€", "EUR").replace("$", "USD").replace("£", "GBP");
  draft.salaryCurrency = cur.slice(0, 3);
  await finishOnboarding(env, chatId, draft, locale, row.message_id);
  return true;
}

async function finishOnboarding(
  env: Env, chatId: number, draft: Draft, locale: Locale, messageId: number | null
): Promise<void> {
  const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
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
       mode=excluded.mode, raw_input=excluded.raw_input, spheres=excluded.spheres,
       industries=excluded.industries, seniority=excluded.seniority,
       remote_mode=excluded.remote_mode, salary_min=excluded.salary_min,
       salary_currency=excluded.salary_currency, updated_at=datetime('now')`,
    userId, "bot", null,
    JSON.stringify(draft.spheres), JSON.stringify(draft.industries),
    draft.seniority, draft.remoteMode ?? "remote_only", null,
    draft.salaryMin, draft.salaryCurrency);

  await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));

  const done = `${summary(draft, locale)}\n\n${readyText(locale)}`;
  if (messageId) await editKeyboard(env, chatId, messageId, done, []);
  else await send(env, chatId, done);
}

export const botLocale = (code: string | undefined): Locale => {
  const two = (code ?? "en").slice(0, 2).toLowerCase();
  return isLocale(two) ? two : "en";
};

export async function continueBotOnboarding(env: Env, chatId: number, data: string): Promise<void> {
  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user) return;

  if (data.startsWith("fb:")) {
    const [, digestId, reaction] = data.split(":");
    if (digestId && (reaction === "not_relevant" || reaction === "more")) {
      await run("INSERT INTO feedback (id,user_id,digest_id,reaction) VALUES (?,?,?,?)",
        uuid(), user.id, digestId, reaction);
      await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
      if (reaction === "more") {
        // Черга, а не обіцянка: сайт на Workers не дотягнеться до сканера,
        // тому запит підбирає сервер під час найближчого прогону доставки.
        await run("INSERT INTO delivery_requests (id,user_id) VALUES (?,?)", uuid(), user.id);
        await send(env, chatId, "Прийняв. Наступна добірка прийде протягом години.");
      } else {
        await send(env, chatId, "Дякую, врахую. Завтрашня добірка буде точнішою.");
      }
    }
  }
}

export async function handleCommand(env: Env, chatId: number, text: string): Promise<void> {
  const user = await one<{ id: string; status: string }>(
    "SELECT id,status FROM users WHERE telegram_chat_id=?", String(chatId));
  const cmd = text.split(/\s+/)[0]!.replace(/@\w+$/, "");

  if (!user && cmd !== "/start") {
    await send(env, chatId, "Спершу /start, щоб я знав, кого шукати.");
    return;
  }

  switch (cmd) {
    case "/pause":
      await run("UPDATE users SET status='paused', paused_reason='manual' WHERE id=?", user!.id);
      await send(env, chatId, "Призупинив. /resume коли захочеш повернутись.");
      break;

    case "/resume":
      await run("UPDATE users SET status='active', paused_reason=NULL, last_interaction_at=datetime('now') WHERE id=?", user!.id);
      await send(env, chatId, "Відновив. Наступна добірка прийде вранці.");
      break;

    // Єдине налаштування, яке справді хочеться змінити з телефона. Досі його
    // можна було змінити лише на сайті, хоча людина живе в боті.
    case "/time": {
      const arg = text.split(/\s+/)[1];
      const row = await one<{ delivery_hour: number; timezone: string }>(
        "SELECT delivery_hour,timezone FROM users WHERE id=?", user!.id);
      const current = row?.delivery_hour ?? 7;
      const zone = row?.timezone ?? "UTC";

      if (arg === undefined) {
        await send(env, chatId,
          `Зараз добірка приходить о ${String(current).padStart(2, "0")}:00 за твоїм часом (${zone}).\n\n` +
          "Щоб змінити — напиши /time і годину, наприклад /time 9.");
        break;
      }

      // Приймаємо і «9», і «09:00»: людина напише як звикла.
      const hour = Number.parseInt(arg.replace(/:.*$/, ""), 10);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        await send(env, chatId, "Година має бути числом від 0 до 23. Наприклад: /time 9");
        break;
      }

      await run("UPDATE users SET delivery_hour=?, updated_at=datetime('now') WHERE id=?", hour, user!.id);
      await send(env, chatId,
        `Готово. Наступні добірки приходитимуть о ${String(hour).padStart(2, "0")}:00 за твоїм часом (${zone}).`);
      break;
    }

    case "/profile": {
      const p = await one<{ spheres: string; seniority: string | null; remote_mode: string; salary_min: number | null }>(
        "SELECT spheres,seniority,remote_mode,salary_min FROM profiles WHERE user_id=?", user!.id);
      await send(env, chatId, p
        ? `Сфери: ${(JSON.parse(p.spheres || "[]") as string[]).join(", ") || "—"}\n` +
          `Рівень: ${p.seniority ?? "—"}\nРобота: ${p.remote_mode}\n` +
          `Зарплата від: ${p.salary_min ?? "—"}\n\nЩоб змінити — просто напиши новий опис.`
        : "Профілю ще немає. Напиши, яку роботу шукаєш.");
      break;
    }

    case "/site": {
      const token = crypto.randomUUID().replace(/-/g, "");
      await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?",
        token, new Date(Date.now() + 15 * 60_000).toISOString(), user!.id);
      const base = env.SITE_URL ?? "https://nextrole.info";
      await send(env, chatId, `Разове посилання для входу, дійсне 15 хвилин:\n${base}/enter?token=${token}`);
      break;
    }

    case "/delete":
      await run("DELETE FROM users WHERE id=?", user!.id);
      await send(env, chatId, "Видалив акаунт і всі дані. Захочеш повернутись — просто /start.");
      break;

    default:
      await send(env, chatId,
        "/profile — профіль\n/time — година доставки\n/pause і /resume — пауза\n/site — вхід на сайт\n/delete — видалити все");
  }
}
