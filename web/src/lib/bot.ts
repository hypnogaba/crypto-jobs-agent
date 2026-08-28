import { one, run, uuid } from "./db";
import {
  emptyDraft, keyboard, nextStep, questionText, askOtherAmount, askCustomRole, readyText,
  summary, toggle, type Draft, type Step,
} from "./bot-onboarding";
import { isLocale } from "./i18n";
import { CvError, extractCvText } from "./cv";
import { parseProfile } from "./parse";
import { t as say, timeNow, timeSet } from "./bot-copy";
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
    await send(env, chatId, say("alreadyIn", locale));
    return;
  }

  await send(env, chatId, say("greeting", locale));

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

  // «Мій варіант» — єдина кнопка, що веде до вільного тексту
  if (step === "spheres" && value === "__mine") {
    await run("UPDATE bot_state SET step='role', updated_at=datetime('now') WHERE chat_id=?", String(chatId));
    await send(env, chatId, askCustomRole(locale));
    return true;
  }

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
  if (!row) return false;

  if (row.step === "why") {
    const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
    const digestId = (JSON.parse(row.draft || "{}") as { digestId?: string }).digestId ?? "";
    if (user) {
      await run(
        "UPDATE feedback SET reason='other', note=? WHERE user_id=? AND digest_id=? AND reaction='not_relevant'",
        text.slice(0, 1000), user.id, digestId);
    }
    await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
    await send(env, chatId, say("noted", locale));
    return true;
  }

  if (row.step === "feedback") {
    const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
    await run(
      "INSERT INTO site_feedback (id,user_id,contact,locale,page,message) VALUES (?,?,?,?,?,?)",
      uuid(), user?.id ?? null, `tg:${chatId}`, locale, "bot", text.slice(0, 4000));
    await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));

    // Летить власнику тим самим ботом, що й з сайту.
    if (env.ADMIN_CHAT_ID) {
      await send(env, Number(env.ADMIN_CHAT_ID),
        `Відгук із бота (${locale}, chat ${chatId})\n\n${text.slice(0, 3000)}`);
    }
    await send(env, chatId, say("feedbackThanks", locale));
    return true;
  }

  // Своя роль: записуємо й повертаємось до того самого питання про сфери,
  // щоб людина могла ще й дообрати щось зі списку.
  if (row.step === "role") {
    const draft = readDraft(row.draft);
    draft.customRole = text.slice(0, 120);
    await saveState(chatId, "spheres", draft, null);
    if (row.message_id) {
      await editKeyboard(env, chatId, row.message_id,
        questionText("spheres", locale), keyboard("spheres", draft, locale));
    }
    return true;
  }

  if (row.step !== "salary") return false;

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
    `INSERT INTO profiles (user_id,mode,raw_input,spheres,custom_role,industries,seniority,remote_mode,location,salary_min,salary_currency,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       mode=excluded.mode, raw_input=excluded.raw_input, spheres=excluded.spheres,
       custom_role=excluded.custom_role, industries=excluded.industries,
       seniority=excluded.seniority, remote_mode=excluded.remote_mode,
       salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
       updated_at=datetime('now')`,
    userId, "bot", null,
    JSON.stringify(draft.spheres), draft.customRole ?? null, JSON.stringify(draft.industries),
    draft.seniority, draft.remoteMode ?? "remote_only", null,
    draft.salaryMin, draft.salaryCurrency);

  await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));

  const done = `${summary(draft, locale)}\n\n${readyText(locale)}`;
  if (messageId) await editKeyboard(env, chatId, messageId, done, []);
  else await send(env, chatId, done);
}

/**
 * Причина, чому добірка не підійшла.
 *
 * Кожна причина, крім «інше» й «не та сфера», піднімає вагу свого правила
 * саме для цієї людини: наступного разу невідповідність цього виміру
 * коштуватиме дорожче. Пів бала за скаргу, стеля — три: без стелі одна
 * роздратована людина зробила б собі порожню добірку.
 *
 * «Не та сфера» вагою не лікується — там треба міняти самі сфери, тож бот
 * чесно каже це, а не вдає, що щось підкрутив.
 */
const TUNED: Record<string, string> = {
  level: "seniority_weight", place: "location_weight", money: "salary_weight",
  // «Насправді не віддалено» — це та сама скарга на місце: вакансія
  // назвалась віддаленою, а нею не є.
  remote: "location_weight",
};

export async function handleWhyButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined, locale: Locale
): Promise<boolean> {
  if (!data.startsWith("wh:")) return false;
  if (callbackId) await ackButton(env, callbackId);

  const [, digestId, reason] = data.split(":");
  if (!digestId || !reason) return true;

  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user) return true;

  await run("UPDATE feedback SET reason=? WHERE user_id=? AND digest_id=? AND reaction='not_relevant'",
    reason, user.id, digestId);
  await run(
    "INSERT INTO user_tuning (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", user.id);

  const column = TUNED[reason];
  if (column) {
    await run(
      `UPDATE user_tuning SET ${column} = MIN(${column} + 0.5, 3.0),
                              updated_at = datetime('now') WHERE user_id=?`, user.id);
    const told = reason === "level" ? "learnedLevel"
      : reason === "place" ? "learnedPlace"
      : reason === "remote" ? "learnedRemote" : "learnedMoney";
    await send(env, chatId, say(told, locale));
    return true;
  }

  if (reason === "sphere") {
    await run(
      `UPDATE user_tuning SET sphere_complaints = sphere_complaints + 1,
                              updated_at = datetime('now') WHERE user_id=?`, user.id);
    await send(env, chatId, say("learnedSphere", locale));
    return true;
  }

  // Індустрія, застаріла вакансія, одноманітність — ваги тут не допоможуть,
  // але причину треба зберегти: з неї видно, що саме ламається.
  if (["industry", "stale", "same"].includes(reason)) {
    await send(env, chatId, say("learnedNote", locale));
    return true;
  }

  // «Інше» — просимо написати словами; текст ловить handleOnboardingText
  await run(
    `INSERT INTO bot_state (chat_id,step,draft,updated_at)
     VALUES (?,'why','{}',datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET step='why', draft=?, updated_at=datetime('now')`,
    String(chatId), JSON.stringify({ digestId }));
  await send(env, chatId, say("whyWrite", locale));
  return true;
}

/**
 * Резюме файлом просто в чаті.
 *
 * Досі PDF розбирався лише на сайті, а в боті доводилось вставляти текстом.
 * Telegram не віддає файл напряму: спершу getFile за file_id, потім
 * завантаження за шляхом. Файл ніде не зберігається — з нього беруться
 * чотири поля профілю, і на цьому все.
 */
export async function handleDocument(
  env: Env, chatId: number, fileId: string, fileName: string, locale: Locale
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  await send(env, chatId, say("cvReading", locale));

  try {
    const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const path = ((await meta.json()) as { result?: { file_path?: string } }).result?.file_path;
    if (!path) { await send(env, chatId, say("cvFailed", locale)); return true; }

    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    const blob = await res.blob();
    const file = new File([blob], fileName || "cv.pdf",
      { type: fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain" });

    const text = await extractCvText(file);
    const parsed = await parseProfile(text, env.ANTHROPIC_API_KEY ?? null);

    const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
    const userId = existing?.id ?? uuid();
    if (!existing) {
      await run(
        `INSERT INTO users (id,telegram_chat_id,locale,timezone,delivery_hour,last_interaction_at)
         VALUES (?,?,?,?,7,datetime('now'))`, userId, String(chatId), locale, "UTC");
    }

    await run(
      `INSERT INTO profiles (user_id,mode,cv_text,spheres,industries,seniority,remote_mode,location,salary_min,salary_currency,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         mode=excluded.mode, cv_text=excluded.cv_text, spheres=excluded.spheres,
         industries=excluded.industries, seniority=excluded.seniority,
         remote_mode=excluded.remote_mode, location=excluded.location,
         salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
         updated_at=datetime('now')`,
      userId, "cv", text.slice(0, 20_000),
      JSON.stringify(parsed.spheres), JSON.stringify(parsed.industries),
      parsed.seniority, parsed.remoteMode, parsed.location, parsed.salaryMin, parsed.salaryCurrency);

    await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
    await send(env, chatId, `${say("cvDone", locale)}\n\n${summary({
      spheres: parsed.spheres, industries: parsed.industries, customRole: null,
      seniority: parsed.seniority, remoteMode: parsed.remoteMode,
      salaryMin: parsed.salaryMin, salaryCurrency: parsed.salaryCurrency,
    }, locale)}`);
  } catch (e) {
    await send(env, chatId, e instanceof CvError ? say("cvUnreadable", locale) : say("cvFailed", locale));
  }
  return true;
}

export const botLocale = (code: string | undefined): Locale => {
  const two = (code ?? "en").slice(0, 2).toLowerCase();
  return isLocale(two) ? two : "en";
};

export async function continueBotOnboarding(
  env: Env, chatId: number, data: string, locale: Locale = "en"
): Promise<void> {
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
        await send(env, chatId, say("moreQueued", locale));
      } else {
        // «Дякую, врахую» було неправдою: реакція нікуди не впливала.
        // Тепер питаємо, ЩО саме не так — з цього можна вчитись.
        await sendKeyboard(env, chatId, say("askWhy", locale), [
          [{ text: say("whySphere", locale),   callback_data: `wh:${digestId}:sphere` },
           { text: say("whyLevel", locale),    callback_data: `wh:${digestId}:level` }],
          [{ text: say("whyPlace", locale),    callback_data: `wh:${digestId}:place` },
           { text: say("whyMoney", locale),    callback_data: `wh:${digestId}:money` }],
          [{ text: say("whyRemote", locale),   callback_data: `wh:${digestId}:remote` },
           { text: say("whyIndustry", locale), callback_data: `wh:${digestId}:industry` }],
          [{ text: say("whyStale", locale),    callback_data: `wh:${digestId}:stale` },
           { text: say("whySame", locale),     callback_data: `wh:${digestId}:same` }],
          [{ text: say("whyOther", locale),    callback_data: `wh:${digestId}:other` }],
        ]);
      }
    }
  }
}

export async function handleCommand(
  env: Env, chatId: number, text: string, locale: Locale = "en"
): Promise<void> {
  const user = await one<{ id: string; status: string }>(
    "SELECT id,status FROM users WHERE telegram_chat_id=?", String(chatId));
  const cmd = text.split(/\s+/)[0]!.replace(/@\w+$/, "");

  if (!user && cmd !== "/start") {
    await send(env, chatId, say("startFirst", locale));
    return;
  }

  switch (cmd) {
    case "/pause":
      await run("UPDATE users SET status='paused', paused_reason='manual' WHERE id=?", user!.id);
      await send(env, chatId, say("paused", locale));
      break;

    case "/resume":
      await run("UPDATE users SET status='active', paused_reason=NULL, last_interaction_at=datetime('now') WHERE id=?", user!.id);
      await send(env, chatId, say("resumed", locale));
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
        await send(env, chatId, `${timeNow(locale, current, zone)}\n\n${say("timeUsage", locale)}`);
        break;
      }

      // Приймаємо і «9», і «09:00»: людина напише як звикла.
      const hour = Number.parseInt(arg.replace(/:.*$/, ""), 10);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        await send(env, chatId, say("timeBad", locale));
        break;
      }

      await run("UPDATE users SET delivery_hour=?, updated_at=datetime('now') WHERE id=?", hour, user!.id);
      await send(env, chatId, timeSet(locale, hour, zone));
      break;
    }

    case "/profile": {
      const p = await one<{ spheres: string; industries: string; seniority: string | null;
        remote_mode: string; salary_min: number | null; salary_currency: string | null;
        custom_role: string | null }>(
        `SELECT spheres,industries,seniority,remote_mode,salary_min,salary_currency,custom_role
           FROM profiles WHERE user_id=?`, user!.id);
      const list = (raw: string | null): string[] => {
        try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
      };
      await send(env, chatId, p
        ? `${summary({
            spheres: list(p.spheres), industries: list(p.industries), customRole: p.custom_role,
            seniority: p.seniority, remoteMode: p.remote_mode,
            salaryMin: p.salary_min, salaryCurrency: p.salary_currency,
          }, locale)}\n\n${say("profileHow", locale)}`
        : say("noProfile", locale));
      break;
    }

    case "/site": {
      const token = crypto.randomUUID().replace(/-/g, "");
      await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?",
        token, new Date(Date.now() + 15 * 60_000).toISOString(), user!.id);
      const base = env.SITE_URL ?? "https://nextrole.info";
      await send(env, chatId, `${say("siteLink", locale)}\n${base}/enter?token=${token}`);
      break;
    }

    // Відгук просто в чаті: людина живе тут, а не на сайті.
    case "/feedback":
      await run(
        `INSERT INTO bot_state (chat_id,step,draft,updated_at) VALUES (?,'feedback','{}',datetime('now'))
         ON CONFLICT(chat_id) DO UPDATE SET step='feedback', draft='{}', updated_at=datetime('now')`,
        String(chatId));
      await send(env, chatId, say("feedbackAsk", locale));
      break;

    case "/help":
      await send(env, chatId, say("help", locale));
      break;

    case "/delete":
      await run("DELETE FROM users WHERE id=?", user!.id);
      await send(env, chatId, say("deleted", locale));
      break;

    default:
      await send(env, chatId, say("help", locale));
  }
}
