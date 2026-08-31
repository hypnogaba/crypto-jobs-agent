import { one, run, uuid } from "./db";
import {
  emptyDraft, keyboard, nextStep, questionText, askOtherAmount, askCustomFor, askTime, askWishes,
  readyText, draftTimezone, profileMenu, profileUpdateFor, backButton,
  STEPS, EDITABLE,
  summary, toggle, fieldLabel, type Draft, type Step,
} from "./bot-onboarding";
import { isLocale, LOCALES, toLocale } from "./i18n";
import { CvError, extractCvText } from "./cv";
import { parseProfile, type ParsedProfile } from "./parse";
import { monthlyFrom, yearlyFrom } from "./salary-period";
import { t as say, tf, timeNow, timeSet } from "./bot-copy";
import { parseModes, serializeModes, toggleMode, type Locale } from "./vocab";
import { persistDerived } from "@/lib/profile-country";
import { timezoneFor } from "./geo";
import { isKnownZone, timezoneFromCity, zoneForHour, zoneName } from "./tz";
import { formatWhen, nextDelivery } from "./digest-time";
import { callTelegram, sendText } from "./telegram-send";

/** Команди бота. Кабінет у чаті — мінімальний, повний лишається на сайті. */

type Env = Record<string, string | undefined>;

async function send(env: Env, chatId: number, text: string): Promise<void> {
  await sendText(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

// ── Покроковий онбординг ──────────────────────────────────────
// Кнопки, а не вільний текст: людині не було зрозуміло, що писати, а бот
// мовчки приймав будь-що — на «тест» він зберігав порожній профіль.

interface Keyed { text: string; callback_data: string }

async function sendKeyboard(
  env: Env, chatId: number, text: string, rows: Keyed[][]
): Promise<number | null> {
  const body = await callTelegram<{ message_id?: number }>(env.TELEGRAM_BOT_TOKEN, "sendMessage",
    { chat_id: chatId, text, reply_markup: { inline_keyboard: rows } });
  return body.result?.message_id ?? null;
}

/** Редагуємо те саме повідомлення, щоб чат не заріс десятком однакових. */
async function editKeyboard(
  env: Env, chatId: number, messageId: number, text: string, rows: Keyed[][]
): Promise<boolean> {
  const r = await callTelegram(env.TELEGRAM_BOT_TOKEN, "editMessageText",
    { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: rows } });
  // «Не змінилось» — це вже потрібний стан, а не поразка: два дотики поспіль
  // по тій самій кнопці не мають народжувати другого повідомлення.
  return r.ok || (r.description ?? "").includes("not modified");
}

/**
 * Знімає кнопки з повідомлення, лишаючи його текст.
 *
 * Потрібно там, де питання переїжджає вниз: дві живі клавіатури в одному
 * чаті — це два різні стани того самого кроку, і людина не може знати, який
 * із них справжній.
 */
async function dropKeyboard(env: Env, chatId: number, messageId: number | null): Promise<void> {
  if (!messageId) return;
  await callTelegram(env.TELEGRAM_BOT_TOKEN, "editMessageReplyMarkup",
    { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

/**
 * Питання після написаного людиною — НОВИМ повідомленням, а не правкою старого.
 *
 * Ось як це виглядало доти. Людина тисне «Немає в списку», бот шле окреме
 * повідомлення «напиши свою роль» БЕЗ кнопок, вона пише «Комуніті менеджер»,
 * а бот редагує ЯКІР — повідомлення, яке її власний текст щойно виштовхнув
 * угору за екран. Знизу не змінюється нічого: ні кнопок, ні підтвердження.
 * На живому прогоні людина написала те саме двічі, вирішивши, що не дійшло,
 * і другий раз ліг у побажання.
 *
 * Тому після кожної текстової відповіді якір переїжджає вниз, а старий
 * лишається в чаті вже без кнопок.
 */
async function reanchor(
  env: Env, chatId: number, oldId: number | null, step: Step, draft: Draft,
  locale: Locale, prefix = ""
): Promise<void> {
  await dropKeyboard(env, chatId, oldId);
  const id = await sendKeyboard(env, chatId,
    `${prefix}${questionText(step, locale)}`, keyboard(step, draft, locale));
  await saveState(chatId, step, draft, id);
}

/**
 * Повідомлення-якір: уся правка профілю живе в ОДНОМУ повідомленні.
 *
 * Раніше кожен дотик слав нове: /profile — меню, пункт — питання, відповідь —
 * підтвердження. Щоб повернутись до меню, треба було знову набрати /profile,
 * і чат заростав однаковими списками. Тепер те саме повідомлення
 * переписується на місці.
 *
 * Якщо переписати не вийшло (людина його видалила, або Telegram уже не дає —
 * повідомлення старше за 48 годин), шлемо нове й запам'ятовуємо як новий якір.
 */
async function anchor(
  env: Env, chatId: number, messageId: number | null, text: string, rows: Keyed[][]
): Promise<number | null> {
  if (messageId !== null && await editKeyboard(env, chatId, messageId, text, rows)) return messageId;
  return sendKeyboard(env, chatId, text, rows);
}

/** Крок «меню правки відкрите»: якір є, поле ще не обране. */
const MENU = "edit:menu" as Step;

/** Без цього кнопка крутиться, доки Telegram не здасться. */
async function ackButton(env: Env, callbackId: string): Promise<void> {
  await callTelegram(env.TELEGRAM_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: callbackId });
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

/**
 * /start. Тому, хто вже має профіль, анкету не перезапускаємо мовчки —
 * це стерло б усе. Пропонуємо два виходи кнопками; `force` — це вже
 * підтверджений «почати заново».
 */
export async function startBotOnboarding(
  env: Env, chatId: number, locale: Locale = "en", force = false
): Promise<void> {
  const existing = await one<{ id: string; timezone: string }>(
    "SELECT id,timezone FROM users WHERE telegram_chat_id=?", String(chatId));
  const hasProfile = existing
    && await one<{ user_id: string }>("SELECT user_id FROM profiles WHERE user_id=?", existing.id);

  if (hasProfile && !force) {
    const id = await sendKeyboard(env, chatId, say("startExisting", locale), [
      [{ text: say("startAgain", locale), callback_data: "st:restart" },
       { text: say("startEdit", locale),  callback_data: "st:edit" }],
    ]);
    // Це повідомлення і стає якорем: «Редагувати по пунктах» перепише його
    // на меню, а не додасть ще одне.
    await saveState(chatId, MENU, (await loadDraft(existing!.id)) ?? emptyDraft(), id);
    return;
  }

  if (!existing) await send(env, chatId, say("greeting", locale));

  // Порожній чернетці передує пропозиція написати одним реченням: тоді
  // галочки на першому екрані вже стоять, і людині лишається їх підтвердити,
  // а не збирати профіль із нуля. На сайті так і працює — тепер і тут.
  const draft = emptyDraft();
  // Відому зону не перепитуємо: вона вже стоїть у users.
  if (existing && existing.timezone !== "UTC") draft.timezone = existing.timezone;
  const id = await sendKeyboard(env, chatId,
    `${say("orWrite", locale)}\n\n${questionText("spheres", locale)}`,
    keyboard("spheres", draft, locale));
  await saveState(chatId, "spheres", draft, id);
}

/** Кнопки під /start для того, хто вже має профіль. */
export async function handleStartButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined, locale: Locale
): Promise<boolean> {
  if (!data.startsWith("st:")) return false;
  if (callbackId) await ackButton(env, callbackId);
  if (data === "st:restart") { await startBotOnboarding(env, chatId, locale, true); return true; }
  if (data === "st:edit") {
    const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
    const row = await one<StateRow>("SELECT step,draft,message_id FROM bot_state WHERE chat_id=?", String(chatId));
    if (user) await showProfileMenu(env, chatId, user.id, locale, row?.message_id ?? null);
  }
  return true;
}

/** Профіль із бази у вигляді чернетки — для /profile і правки по пунктах. */
async function loadDraft(userId: string): Promise<Draft | null> {
  const p = await one<{ spheres: string; industries: string;
    remote_mode: string; location: string | null; salary_min: number | null; salary_currency: string | null;
    custom_role: string | null; custom_industry: string | null;
    wishes: string | null }>(
    `SELECT spheres,industries,remote_mode,location,salary_min,salary_currency,
            custom_role,custom_industry,wishes
       FROM profiles WHERE user_id=?`, userId);
  if (!p) return null;
  const list = (raw: string | null): string[] => {
    try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  return {
    ...emptyDraft(),
    spheres: list(p.spheres), industries: list(p.industries), customRole: p.custom_role,
    customIndustry: p.custom_industry,
    remoteMode: p.remote_mode, location: p.location,
    salaryMin: p.salary_min, salaryCurrency: p.salary_currency, wishes: p.wishes,
  };
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
  // Крок «own:<поле>» — це те саме питання, тільки ми чекаємо на текст. Дотик
  // по кнопці означає, що людина передумала писати й обрала зі списку, тож
  // повертаємось до звичайного кроку.
  const step = (row.step.startsWith("own:") ? row.step.slice(4) : row.step) as Step;
  // Клавіатура зі старого повідомлення, коли анкети вже немає (відкрите меню
  // правки, наприклад). Мовчимо: інакше «наступного питання немає»
  // прочиталось би як «анкету завершено» — і переписало б профіль.
  if (!STEPS.includes(step)) return true;

  // «Немає в списку» — єдина кнопка, що веде до вільного тексту. Крок
  // запам'ятовуємо, щоб знати, куди покласти написане й куди повернутись.
  if (value === "__mine") {
    // Прохання написати йде новим повідомленням і САМЕ ВОНО стає якорем: усе
    // наступне — і підтвердження, і наступне питання — з'явиться там, куди
    // людина дивиться. Кнопки на ньому ті самі, тож передумати можна дотиком.
    await dropKeyboard(env, chatId, row.message_id);
    const id = await sendKeyboard(env, chatId, askCustomFor(step, locale),
      keyboard(step, draft, locale));
    await run(
      `UPDATE bot_state SET step=?, message_id=COALESCE(?, message_id), updated_at=datetime('now')
        WHERE chat_id=?`, `own:${step}`, id, String(chatId));
    return true;
  }

  // Кілька відповідей: перемикаємо й перемальовуємо те саме питання
  if ((step === "spheres" || step === "industries" || step === "where") && value !== "__next") {
    if (step === "spheres") draft.spheres = toggle(draft.spheres, value);
    else if (step === "where") draft.remoteMode = toggleMode(draft.remoteMode, value);
    else draft.industries = toggle(draft.industries, value);
    await saveState(chatId, step, draft, null);
    if (row.message_id) {
      await editKeyboard(env, chatId, row.message_id, questionText(step, locale), keyboard(step, draft, locale));
    }
    return true;
  }

  // Котра година: кнопка несе зону; «Інша» — просимо написати час.
  if (step === "tz") {
    if (value === "__other") {
      await run("UPDATE bot_state SET step='tzhour', updated_at=datetime('now') WHERE chat_id=?", String(chatId));
      await send(env, chatId, askTime(locale));
      return true;
    }
    if (isKnownZone(value)) draft.timezone = value;
  }

  // Одна відповідь — або «Готово» в списку з кількома
  if (step === "salary") {
    if (value === "__other") {
      // Окремий крок, а не той самий «salary»: інакше «90000 EUR» (дев'ять
      // символів) перехоплював розбір вільного тексту нижче — він спрацьовує
      // на будь-чому довшому за сім символів — і сума не записувалась зовсім.
      await dropKeyboard(env, chatId, row.message_id);
      const id = await sendKeyboard(env, chatId, askOtherAmount(locale), []);
      await run(
        `UPDATE bot_state SET step='salaryother', draft=?, message_id=COALESCE(?, message_id),
                              updated_at=datetime('now') WHERE chat_id=?`,
        JSON.stringify(draft), id, String(chatId));
      return true;
    }
    // Кнопки підписані «на місяць», а чернетка й база живуть у річній —
    // одна одиниця виміру на всю систему. Перехід саме тут, а не в списку
    // сум: тоді підпис кнопки й записане число не можуть розійтися.
    const n = Number.parseInt(value, 10);
    draft.salaryMin = Number.isFinite(n) && n > 0 ? yearlyFrom(n) : null;
    draft.salaryCurrency = draft.salaryMin ? "EUR" : null;
  }

  const after = nextStep(step, draft);
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

  // Побажання: усе написане й є відповіддю, далі — наступне питання.
  if (row.step === "wishes") {
    const draft = readDraft(row.draft);
    draft.wishes = text.slice(0, 1000).trim() || null;
    await advance(env, chatId, "wishes", draft, locale, row.message_id, true);
    return true;
  }

  // Котра година, написана словами («14:30»): підбираємо зону за годиною.
  if (row.step === "tz" || row.step === "tzhour") {
    const zone = zoneForHour(text, new Date());
    if (!zone) { await send(env, chatId, say("timeBadHour", locale)); return true; }
    const draft = readDraft(row.draft);
    draft.timezone = zone;
    await advance(env, chatId, "tz", draft, locale, row.message_id, true);
    return true;
  }

  if (row.step.startsWith("edit:") || row.step.startsWith("editown:")) {
    return handleEditText(env, chatId, row, text, locale);
  }

  // Вільний текст просто посеред питань: людина написала, ким хоче бути.
  // Розбираємо тим самим парсером, що й сайт, і ставимо галочки — далі вона
  // лише підтверджує. Це і є «підтягнути з того, що можна написати текстом».
  if (STEPS.includes(row.step as Step) && row.step !== "city" && text.length >= 8) {
    const parsed = await parseProfile(text, env.ANTHROPIC_API_KEY ?? null);
    const draft = readDraft(row.draft);
    if (parsed.spheres.length) draft.spheres = parsed.spheres;
    if (parsed.industries.length) draft.industries = parsed.industries;
    if (parsed.remoteMode) draft.remoteMode = parsed.remoteMode;
    if (parsed.location) draft.location = parsed.location;
    if (parsed.salaryMin) { draft.salaryMin = parsed.salaryMin; draft.salaryCurrency = parsed.salaryCurrency; }
    // Те, що не влізло в жодну кнопку («тільки стартапи», «без on-call»), —
    // не сміття: підбір дає за нього до +6 балів. Сайт кладе його в wishes,
    // а бот досі губив, тобто той самий текст працював по-різному залежно
    // від того, звідки прийшла людина. Уже написане не перетираємо.
    if (parsed.leftover && !draft.wishes) draft.wishes = parsed.leftover;

    const step = row.step as Step;
    await saveState(chatId, step, draft, null);
    if (row.message_id) {
      await editKeyboard(env, chatId, row.message_id,
        `${questionText(step, locale)}\n\n${say("prefilled", locale)}`,
        keyboard(step, draft, locale));
    }
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

  // Написане своїми словами: кладемо в поле того питання, на якому стояли,
  // і повертаємось до нього — щоб можна було ще й дообрати щось зі списку.
  if (row.step.startsWith("own:")) {
    const back = row.step.slice(4) as Step;
    const draft = readDraft(row.draft);
    const own = text.slice(0, 120);
    if (back === "spheres") draft.customRole = own;
    else if (back === "industries") draft.customIndustry = own;
    else if (back === "where") {
      draft.customWhere = own;
      // Написане тут і є місцем: окремо перепитувати місто після цього
      // означало б питати те саме двічі.
      draft.location = own;
    }

    // Питання з однією відповіддю після свого варіанта йдуть далі самі:
    // вертатись до списку, з якого людина щойно відмовилась, безглуздо.
    const single = back === "where";
    const goto = single ? nextStep(back, draft) : back;
    if (!goto) { await finishOnboarding(env, chatId, draft, locale, row.message_id, true); return true; }

    // Слова людини повертаються їй же. Мовчазне збереження — це те саме, що
    // втрачене: побачити галочку на кнопці «Немає в списку» можна лише коли
    // знаєш, що вона там з'явилась.
    await reanchor(env, chatId, row.message_id, goto, draft, locale,
      `${tf("ownSaved", locale, { value: own })}\n\n`);
    return true;
  }

  // Місто: коротка відповідь вільним текстом, далі — останнє питання.
  if (row.step === "city") {
    const draft = readDraft(row.draft);
    const city = text.slice(0, 120).trim();
    // Порожня відповідь не проходить: питання ставиться лише тому, хто сам
    // обрав місце, а профіль без міста лишається без країни й без місцевих дошок.
    if (!city) { await send(env, chatId, questionText("city", locale)); return true; }
    draft.location = city;
    const goto = nextStep("city", draft);
    if (!goto) { await finishOnboarding(env, chatId, draft, locale, row.message_id, true); return true; }
    await reanchor(env, chatId, row.message_id, goto, draft, locale,
      `${tf("ownSaved", locale, { value: city })}\n\n`);
    return true;
  }

  if (row.step !== "salary" && row.step !== "salaryother") return false;

  const m = /(\d[\d\s.,]*)\s*([a-zA-Z€$£]{1,4})?/.exec(text);
  const amount = m ? Number.parseInt(m[1]!.replace(/[^\d]/g, ""), 10) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    await send(env, chatId, askOtherAmount(locale));
    return true;
  }

  const draft = readDraft(row.draft);
  // Написане число теж місячне: питання і приклад у підказці кажуть саме це.
  draft.salaryMin = yearlyFrom(amount);
  const cur = (m?.[2] ?? "EUR").toUpperCase().replace("€", "EUR").replace("$", "USD").replace("£", "GBP");
  draft.salaryCurrency = cur.slice(0, 3);
  await finishOnboarding(env, chatId, draft, locale, row.message_id, true);
  return true;
}

/** Перехід до наступного питання, або завершення, якщо воно було останнім. */
async function advance(
  env: Env, chatId: number, from: Step, draft: Draft, locale: Locale, messageId: number | null,
  afterText = false
): Promise<void> {
  const goto = nextStep(from, draft);
  if (!goto) { await finishOnboarding(env, chatId, draft, locale, messageId, afterText); return; }
  // Після написаного людиною якір переїжджає вниз: її власне повідомлення
  // щойно виштовхнуло старе за екран, і правка там нікому не видима.
  if (afterText) { await reanchor(env, chatId, messageId, goto, draft, locale); return; }
  await saveState(chatId, goto, draft, null);
  if (messageId) {
    await editKeyboard(env, chatId, messageId, questionText(goto, locale), keyboard(goto, draft, locale));
  }
}

async function finishOnboarding(
  env: Env, chatId: number, draft: Draft, locale: Locale, messageId: number | null,
  afterText = false
): Promise<void> {
  const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  const userId = existing?.id ?? uuid();
  // Зона: кнопка «котра година» → місто → країна → мова. UTC лише коли
  // жоден сигнал нічого не сказав.
  const timezone = draftTimezone(draft, locale) ?? timezoneFor(locale, draft.location);
  if (!existing) {
    await run(
      `INSERT INTO users (id,telegram_chat_id,locale,timezone,delivery_hour,last_interaction_at)
       VALUES (?,?,?,?,9,datetime('now'))`,
      userId, String(chatId), locale, timezone);
  } else if (timezone !== "UTC") {
    await run("UPDATE users SET timezone=?, updated_at=datetime('now') WHERE id=?", timezone, userId);
  }

  await run(
    `INSERT INTO profiles (user_id,mode,raw_input,spheres,custom_role,industries,custom_industry,
                           remote_mode,location,salary_min,salary_currency,wishes,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       mode=excluded.mode, raw_input=excluded.raw_input, spheres=excluded.spheres,
       custom_role=excluded.custom_role, industries=excluded.industries,
       custom_industry=excluded.custom_industry,
       remote_mode=excluded.remote_mode, location=excluded.location,
       salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
       wishes=excluded.wishes,
       updated_at=datetime('now')`,
    userId, "bot", null,
    JSON.stringify(draft.spheres), draft.customRole ?? null,
    JSON.stringify(draft.industries), draft.customIndustry ?? null,
    serializeModes(parseModes(draft.remoteMode)) || "remote_only", draft.location ?? null,
    draft.salaryMin, draft.salaryCurrency, draft.wishes?.trim() || null);

  await persistDerived(userId, env.ANTHROPIC_API_KEY ?? null);

  await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));

  // Дата найближчої планової добірки — і кнопка, щоб побачити формат уже
  // зараз. Автоматично першу добірку більше не замовляємо: людина сама
  // вирішує, чекати понеділка чи отримати п'ять одразу. Година — та, що
  // в базі: /time міг її вже змінити.
  const hour = (await one<{ delivery_hour: number }>(
    "SELECT delivery_hour FROM users WHERE id=?", userId))?.delivery_hour ?? 9;
  const done = `${summary(draft, locale)}\n\n${readyText(locale, firstOfferVars(timezone, hour, locale))}`;
  if (afterText) await dropKeyboard(env, chatId, messageId);
  if (messageId && !afterText) await editKeyboard(env, chatId, messageId, done, FIRST_KEYS(locale));
  else await sendKeyboard(env, chatId, done, FIRST_KEYS(locale));
}

/** Кнопки «Прислати 5 зараз / Чекатиму» — одна пара для всіх шляхів реєстрації. */
export const FIRST_KEYS = (locale: Locale): Keyed[][] => [[
  { text: say("firstNow", locale),  callback_data: "first:now" },
  { text: say("firstWait", locale), callback_data: "first:wait" },
]];

/** Підстановки для тексту «добірки приходять у робочі дні о … найближча …». */
export function firstOfferVars(timezone: string, hour: number, locale: Locale): { h: string; tz: string; when: string } {
  return {
    h: `${String(hour).padStart(2, "0")}:00`,
    tz: zoneName(timezone, locale),
    when: formatWhen(nextDelivery(timezone, hour, new Date()), timezone, locale),
  };
}

/** Після CV чи прив'язки з сайту: та сама пропозиція, що й після анкети. */
export async function sendFirstOffer(env: Env, chatId: number, userId: string, locale: Locale): Promise<void> {
  const u = await one<{ timezone: string; delivery_hour: number }>(
    "SELECT timezone, delivery_hour FROM users WHERE id=?", userId);
  if (!u) return;
  await sendKeyboard(env, chatId, tf("firstOffer", locale, firstOfferVars(u.timezone, u.delivery_hour, locale)), FIRST_KEYS(locale));
}

/** Кнопки під «Готово»: п'ять вакансій зараз або чекати планової. */
export async function handleFirstButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined, locale: Locale
): Promise<boolean> {
  if (!data.startsWith("first:")) return false;
  if (callbackId) await ackButton(env, callbackId);
  const u = await one<{ id: string; timezone: string; delivery_hour: number }>(
    "SELECT id, timezone, delivery_hour FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!u) return true;
  const when = formatWhen(nextDelivery(u.timezone, u.delivery_hour, new Date()), u.timezone, locale);
  if (data === "first:now") {
    await run(
      `INSERT INTO delivery_requests (id,user_id)
       SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=? AND handled_at IS NULL)`,
      uuid(), u.id, u.id);
    await send(env, chatId, tf("firstQueued", locale, { when }));
  } else {
    await send(env, chatId, tf("firstAgreed", locale, { when }));
  }
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", u.id);
  return true;
}

// ── Правка по пунктах (/profile) ─────────────────────────────
// Та сама клавіатура, що й в онбордингу, але з префіксом ed: і записом
// лише одного поля. Переходити всю анкету заради зарплати — надто дорого.

/** Меню правки: підсумок профілю й пункти — у якорі. `note` пише, що щойно сталось. */
async function showProfileMenu(
  env: Env, chatId: number, userId: string, locale: Locale,
  messageId: number | null, note?: string,
): Promise<void> {
  const draft = (await loadDraft(userId)) ?? emptyDraft();
  const id = await anchor(env, chatId, messageId,
    `${summary(draft, locale)}\n\n${note ?? say("profileHow", locale)}`, profileMenu(locale));
  await saveState(chatId, MENU, draft, id);
}

/**
 * Питання одного поля — у тому самому якорі, з «Назад» останнім рядком.
 * Без «Назад» відкрите питання було глухим кутом: вийти з нього можна було
 * лише командою, а команда слала ще одне повідомлення.
 */
async function showEdit(
  env: Env, chatId: number, state: string, draft: Draft, locale: Locale,
  messageId: number | null, text: string, rows: Keyed[][],
): Promise<void> {
  const id = await anchor(env, chatId, messageId, text, [...rows, [backButton(locale)]]);
  await saveState(chatId, state as Step, draft, id);
}

/** Стан «правлю поле» — чернетка з бази, крок edit:<поле>. */
async function openEditor(
  env: Env, chatId: number, userId: string, step: Step, locale: Locale, messageId: number | null
): Promise<void> {
  const draft = (await loadDraft(userId)) ?? emptyDraft();
  // Побажання — вільний текст: замість списку показуємо вже записане.
  const text = step === "wishes"
    ? `${draft.wishes?.trim() ? `«${draft.wishes.trim()}»\n\n` : ""}${askWishes(locale)}`
    : questionText(step, locale, { bare: true });
  const rows = step === "wishes" ? [] : keyboard(step, draft, locale, { prefix: "ed" });
  await showEdit(env, chatId, `edit:${step}`, draft, locale, messageId, text, rows);
}

/** Запис одного поля й підтвердження. Назва стовпця — з profileUpdateFor, не з кнопки. */
async function commitField(
  env: Env, chatId: number, userId: string, step: Step, draft: Draft, locale: Locale, messageId: number | null
): Promise<void> {
  const upd = profileUpdateFor(step, draft);
  if (upd) {
    await run(`UPDATE profiles SET ${upd.set}, updated_at=datetime('now') WHERE user_id=?`, ...upd.params, userId);
    if (step === "where" || step === "city") await persistDerived(userId, env.ANTHROPIC_API_KEY ?? null);
  }
  // Не прощаємось: люди правлять кілька пунктів поспіль, тож той самий якір
  // одразу повертається в меню — з підсумком, уже зі свіжим полем.
  await showProfileMenu(env, chatId, userId, locale, messageId, say("fieldSaved", locale));
}

export async function handleEditButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined, locale: Locale
): Promise<boolean> {
  if (!data.startsWith("ed:")) return false;
  if (callbackId) await ackButton(env, callbackId);

  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user) return true;

  const [, field, value] = data.split(":");
  if (!field || field === "noop") return true;

  // Якір читаємо завжди: у ньому живе і меню, і питання, і підтвердження.
  const row = await one<StateRow>("SELECT step,draft,message_id FROM bot_state WHERE chat_id=?", String(chatId));
  const at = row?.message_id ?? null;

  // «Назад»: нічого не записуємо, просто повертаємо меню в те саме повідомлення.
  if (field === "back") { await showProfileMenu(env, chatId, user.id, locale, at); return true; }

  // Пункт меню: те саме повідомлення стає питанням
  if (value === undefined) {
    if (field === "lang") { await showLangPicker(env, chatId, user.id, locale, at); return true; }
    if (EDITABLE.includes(field as Step)) await openEditor(env, chatId, user.id, field as Step, locale, at);
    return true;
  }

  const step = field as Step;
  // Стан загубився, або дотик прийшов зі старої клавіатури. Мовчати не можна:
  // кнопка просто не спрацювала б. Показуємо це саме питання заново — з того,
  // що зараз у базі.
  if (!row || row.step !== `edit:${step}`) {
    if (EDITABLE.includes(step)) await openEditor(env, chatId, user.id, step, locale, at);
    return true;
  }
  const draft = readDraft(row.draft);

  if (value === "__mine") {
    // Тут якір і так стоїть під рукою — це те саме повідомлення /profile, у
    // яке людина щойно тикала, — тож переносити його вниз нема потреби.
    // «Назад» під ним додає showEdit.
    await showEdit(env, chatId, `editown:${step}`, draft, locale, at, askCustomFor(step, locale), []);
    return true;
  }

  if ((step === "spheres" || step === "industries" || step === "where") && value !== "__next") {
    if (step === "spheres") draft.spheres = toggle(draft.spheres, value);
    else if (step === "where") { draft.remoteMode = toggleMode(draft.remoteMode, value); draft.customWhere = null; }
    else draft.industries = toggle(draft.industries, value);
    await showEdit(env, chatId, row.step, draft, locale, at,
      questionText(step, locale, { bare: true }), keyboard(step, draft, locale, { prefix: "ed" }));
    return true;
  }

  if (step === "salary") {
    if (value === "__other") {
      await showEdit(env, chatId, "edit:salary", draft, locale, at, askOtherAmount(locale), []);
      return true;
    }
    const n = Number.parseInt(value, 10);
    draft.salaryMin = Number.isFinite(n) && n > 0 ? yearlyFrom(n) : null;
    draft.salaryCurrency = draft.salaryMin ? "EUR" : null;
  }
  if (step === "tz") {
    if (value === "__other") {
      await showEdit(env, chatId, "edit:tz", draft, locale, at, askTime(locale), []);
      return true;
    }
    if (!isKnownZone(value)) return true;
    await setZone(env, chatId, user.id, value, locale, at);
    return true;
  }

  await commitField(env, chatId, user.id, step, draft, locale, at);
  return true;
}

/** Зона в users — окремо від profiles, бо це про доставку, а не про підбір. */
async function setZone(
  env: Env, chatId: number, userId: string, zone: string, locale: Locale, messageId: number | null
): Promise<void> {
  await run("UPDATE users SET timezone=?, updated_at=datetime('now') WHERE id=?", zone, userId);
  const row = await one<{ delivery_hour: number }>("SELECT delivery_hour FROM users WHERE id=?", userId);
  await showProfileMenu(env, chatId, userId, locale, messageId,
    `${tf("zoneSet", locale, { zone })}\n${timeNow(locale, row?.delivery_hour ?? 9, zone)}`);
}

/** Вільний текст під час правки: побажання, інша сума, «немає в списку», година. */
async function handleEditText(
  env: Env, chatId: number, row: StateRow, text: string, locale: Locale
): Promise<boolean> {
  // Меню відкрите, поле ще не обране: написане — це побажання, а не відповідь
  // на питання. Хай із ним розбирається вебхук, як із текстом поза правкою.
  if (row.step === MENU) return false;

  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user) return false;
  const draft = readDraft(row.draft);

  if (row.step === "edit:wishes") {
    draft.wishes = text.slice(0, 1000);
    await commitField(env, chatId, user.id, "wishes", draft, locale, row.message_id);
    return true;
  }

  if (row.step === "edit:tz") {
    const zone = zoneForHour(text, new Date());
    if (!zone) { await send(env, chatId, say("timeBadHour", locale)); return true; }
    await setZone(env, chatId, user.id, zone, locale, row.message_id);
    return true;
  }

  if (row.step === "edit:salary") {
    const m = /(\d[\d\s.,]*)\s*([a-zA-Z€$£]{1,4})?/.exec(text);
    const amount = m ? Number.parseInt(m[1]!.replace(/[^\d]/g, ""), 10) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) { await send(env, chatId, askOtherAmount(locale)); return true; }
    draft.salaryMin = yearlyFrom(amount);
    const cur = (m?.[2] ?? "EUR").toUpperCase().replace("€", "EUR").replace("$", "USD").replace("£", "GBP");
    draft.salaryCurrency = cur.slice(0, 3);
    await commitField(env, chatId, user.id, "salary", draft, locale, row.message_id);
    return true;
  }

  if (row.step.startsWith("editown:")) {
    const step = row.step.slice(8) as Step;
    const own = text.slice(0, 120);
    if (step === "spheres") draft.customRole = own;
    else if (step === "industries") draft.customIndustry = own;
    else if (step === "where") { draft.customWhere = own; draft.location = own; }
    // Списки повертаються до клавіатури — можна дообрати; одиночні пишуться одразу.
    if (step === "spheres" || step === "industries") {
      await showEdit(env, chatId, `edit:${step}`, draft, locale, row.message_id,
        questionText(step, locale, { bare: true }), keyboard(step, draft, locale, { prefix: "ed" }));
      return true;
    }
    await commitField(env, chatId, user.id, step, draft, locale, row.message_id);
    return true;
  }

  /**
   * Будь-який інший крок правки: текст ПРИЙМАЄТЬСЯ, а не відхиляється.
   *
   * Тут стояло «скористайся кнопками вище». Живий випадок: людина тисне
   * «Побажання», пише «комуніті менеджер» — записалось; повертається в меню,
   * пише те саме ще раз — відмова. Той самий текст то приймався, то ні,
   * залежно від невидимого їй стану, і жодна відмова не пояснювала, який
   * стан правильний. Ще гірше на списках: «Сфери» приймали текст лише ПІСЛЯ
   * «Немає в списку», тобто кнопки й слова були взаємно виключні.
   *
   * Тепер вони доповнюють одне одного. Написане розбирається тим самим
   * парсером, що й на сайті, і лягає в УСІ поля, які він упізнав, — галочки
   * при цьому лишаються, їх можна дообрати. Правило просте на весь бот:
   * написане людиною ніколи не пропадає.
   */
  if (text.trim().length < 3) {
    await send(env, chatId, say("useButtons", locale));
    return true;
  }
  const parsed = await parseProfile(text, env.ANTHROPIC_API_KEY ?? null);
  const changed = mergeIntoDraft(draft, parsed, text);
  if (changed.length === 0) {
    await send(env, chatId, say("useButtons", locale));
    return true;
  }
  await saveWholeProfile(env, user.id, draft);
  await send(env, chatId, savedLine(changed, locale));
  await showProfileMenu(env, chatId, user.id, locale, row.message_id);
  return true;
}

/**
 * Що з розібраного справді нове — і одразу список полів для підтвердження.
 *
 * Порожнє поле не перетирає заповнене: людина, яка написала одну роль, не
 * має втратити місто, назване раніше.
 */
function mergeIntoDraft(draft: Draft, parsed: ParsedProfile, text: string): Array<[string, string]> {
  const changed: Array<[string, string]> = [];
  if (parsed.spheres.length) {
    draft.spheres = [...new Set([...draft.spheres, ...parsed.spheres])];
    changed.push(["spheres", String(draft.spheres.length)]);
  }
  if (parsed.industries.length) {
    draft.industries = [...new Set([...draft.industries, ...parsed.industries])];
    changed.push(["industries", String(draft.industries.length)]);
  }
  if (parsed.customRole) { draft.customRole = parsed.customRole; changed.push(["role", parsed.customRole]); }
  if (parsed.customIndustry) {
    draft.customIndustry = parsed.customIndustry;
    changed.push(["industry", parsed.customIndustry]);
  }
  if (parsed.remoteMode) { draft.remoteMode = parsed.remoteMode; changed.push(["where", parsed.remoteMode]); }
  if (parsed.location) { draft.location = parsed.location; changed.push(["city", parsed.location]); }
  if (parsed.salaryMin) {
    draft.salaryMin = parsed.salaryMin;
    draft.salaryCurrency = parsed.salaryCurrency;
    changed.push(["salary", `${monthlyFrom(parsed.salaryMin)} ${parsed.salaryCurrency ?? "EUR"}`]);
  }
  // Нічого не впізнали — написане не викидаємо: воно йде в побажання, за які
  // підбір дає до +6 балів. Саме так із цим текстом чинить сайт.
  if (changed.length === 0) {
    const own = (parsed.leftover ?? text).trim().slice(0, 1000);
    if (own) { draft.wishes = own; changed.push(["wishes", own]); }
  } else if (parsed.leftover && !draft.wishes) {
    draft.wishes = parsed.leftover;
    changed.push(["wishes", parsed.leftover]);
  }
  return changed;
}

/** Підтвердження, яке називає поле й значення, а не саме себе. */
function savedLine(changed: Array<[string, string]>, locale: Locale): string {
  const rows = changed.map(([field, value]) => `${fieldLabel(field as Step, locale)}: ${value}`);
  return `${say("savedFields", locale)}\n${rows.join("\n")}`;
}

/** Уся чернетка в profiles одним записом: розбір міняє кілька полів одразу. */
async function saveWholeProfile(env: Env, userId: string, draft: Draft): Promise<void> {
  await run(
    `UPDATE profiles SET spheres=?, custom_role=?, industries=?, custom_industry=?,
                         remote_mode=?, location=?, salary_min=?, salary_currency=?, wishes=?,
                         updated_at=datetime('now')
      WHERE user_id=?`,
    JSON.stringify(draft.spheres), draft.customRole ?? null,
    JSON.stringify(draft.industries), draft.customIndustry ?? null,
    serializeModes(parseModes(draft.remoteMode)) || "remote_only", draft.location ?? null,
    draft.salaryMin, draft.salaryCurrency, draft.wishes?.trim() || null, userId);
  await persistDerived(userId, env.ANTHROPIC_API_KEY ?? null);
}

// ── Мова ─────────────────────────────────────────────────────

/** Окрема команда /lang: якоря немає, тож просто нове повідомлення. */
async function sendLangKeyboard(env: Env, chatId: number, locale: Locale): Promise<void> {
  const items = LOCALES.map((l) => ({ text: l.name, callback_data: `lg:${l.id}` }));
  await sendKeyboard(env, chatId, say("langAsk", locale), [items.slice(0, 2), items.slice(2)]);
}

/** Мова з меню правки: той самий якір, зі «Назад» — як і решта пунктів. */
async function showLangPicker(
  env: Env, chatId: number, userId: string, locale: Locale, messageId: number | null
): Promise<void> {
  const items = LOCALES.map((l) => ({ text: l.name, callback_data: `lg:${l.id}` }));
  const draft = (await loadDraft(userId)) ?? emptyDraft();
  await showEdit(env, chatId, "edit:lang", draft, locale, messageId,
    say("langAsk", locale), [items.slice(0, 2), items.slice(2)]);
}

async function saveLocale(userId: string, next: Locale): Promise<void> {
  await run("UPDATE users SET locale=?, updated_at=datetime('now') WHERE id=?", next, userId);
}

async function setLocale(env: Env, chatId: number, userId: string, next: Locale): Promise<void> {
  await saveLocale(userId, next);
  await send(env, chatId, say("langSet", next));
}

export async function handleLangButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined
): Promise<boolean> {
  if (!data.startsWith("lg:")) return false;
  if (callbackId) await ackButton(env, callbackId);
  const next = data.slice(3);
  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user || !isLocale(next)) return true;

  // Мову міняли з меню правки — туди ж і повертаємось, уже новою мовою.
  const row = await one<StateRow>("SELECT step,draft,message_id FROM bot_state WHERE chat_id=?", String(chatId));
  if (row?.step === "edit:lang") {
    await saveLocale(user.id, next);
    await showProfileMenu(env, chatId, user.id, next, row.message_id, say("langSet", next));
    return true;
  }
  await setLocale(env, chatId, user.id, next);
  return true;
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
  place: "location_weight", money: "salary_weight",
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
    // Назва стовпця підставляється в SQL, а не передається параметром — так
    // не можна. Зараз це безпечно лише тому, що значення береться з TUNED,
    // але одна необережна правка перетворила б це на ін'єкцію. Тому перевірка
    // явна: у запит потрапляє тільки те, що є в цьому списку.
    const ALLOWED = ["location_weight", "salary_weight"] as const;
    if (!ALLOWED.includes(column as (typeof ALLOWED)[number])) return true;

    await run(
      `UPDATE user_tuning SET ${column} = MIN(${column} + 0.5, 3.0),
                              updated_at = datetime('now') WHERE user_id=?`, user.id);
    const told = reason === "place" ? "learnedPlace"
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
    // Розбір більше не вигадує режим роботи: коли людина про це не написала,
    // він порожній. Стовпець remote_mode — NOT NULL, і порожній рядок означав
    // би «жодного варіанта», чого людина не обирала. Найвужче з безпечних —
    // те саме замовчування, що й на сайті.
    const remoteMode = parsed.remoteMode || "remote_only";

    const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
    const userId = existing?.id ?? uuid();
    if (!existing) {
      await run(
        `INSERT INTO users (id,telegram_chat_id,locale,timezone,delivery_hour,last_interaction_at)
         VALUES (?,?,?,?,9,datetime('now'))`, userId, String(chatId), locale, timezoneFor(locale, parsed.location));
    }

    // Резюме в боті пише те саме, що й резюме на сайті. Досі цей запит
    // брав самі лише галочки: назва ролі, індустрія своїми словами, витяг
    // (стек, роки, мови) і побажання з тексту губились мовчки — тобто
    // людина з бота отримувала гірший підбір, ніж та сама людина з сайту.
    await run(
      `INSERT INTO profiles (user_id,mode,cv_text,spheres,industries,remote_mode,location,salary_min,salary_currency,custom_role,custom_industry,cv_highlights,wishes,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         mode=excluded.mode, cv_text=excluded.cv_text, spheres=excluded.spheres,
         industries=excluded.industries,
         remote_mode=excluded.remote_mode, location=excluded.location,
         salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
         custom_role=excluded.custom_role, custom_industry=excluded.custom_industry,
         cv_highlights=excluded.cv_highlights,
         wishes=excluded.wishes,
         updated_at=datetime('now')`,
      userId, "cv", text.slice(0, 20_000),
      JSON.stringify(parsed.spheres), JSON.stringify(parsed.industries),
      remoteMode, parsed.location, parsed.salaryMin, parsed.salaryCurrency,
      parsed.customRole, parsed.customIndustry,
      parsed.cvHighlights, parsed.leftover);

    await persistDerived(userId, env.ANTHROPIC_API_KEY ?? null);

    await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
      await send(env, chatId, `${say("cvDone", locale)}\n\n${summary({
      spheres: parsed.spheres, industries: parsed.industries, customRole: parsed.customRole,
      remoteMode,
      salaryMin: parsed.salaryMin, salaryCurrency: parsed.salaryCurrency,
    }, locale)}`);
    await sendFirstOffer(env, chatId, userId, locale);
  } catch (e) {
    await send(env, chatId, e instanceof CvError ? say("cvUnreadable", locale) : say("cvFailed", locale));
  }
  return true;
}

/** Підтвердження /delete. Повертає true, якщо кнопка була саме про це. */
export async function handleDeleteButton(
  env: Env, chatId: number, data: string, callbackId: string | undefined, locale: Locale
): Promise<boolean> {
  if (!data.startsWith("del:")) return false;
  if (callbackId) await ackButton(env, callbackId);

  if (data !== "del:yes") {
    await send(env, chatId, say("deleteKept", locale));
    return true;
  }
  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (user) await run("DELETE FROM users WHERE id=?", user.id);
  await run("DELETE FROM bot_state WHERE chat_id=?", String(chatId));
  await send(env, chatId, say("deleted", locale));
  return true;
}

export const botLocale = (code: string | undefined): Locale => {
  const two = (code ?? "en").slice(0, 2).toLowerCase();
  return isLocale(two) ? two : "en";
};

export async function continueBotOnboarding(
  env: Env, chatId: number, data: string, locale: Locale = "en", callbackId?: string
): Promise<void> {
  // Без відповіді кнопка під добіркою крутилась, доки Telegram не здасться.
  if (callbackId) await ackButton(env, callbackId);

  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user) return;

  /**
   * «Не цікавить» по конкретній вакансії просто з добірки.
   *
   * Досі така дія жила лише в кабінеті, тобто була доступна половині людей
   * ніколи: у бота є ті, хто сайт не відкриває взагалі. А саме вона й впливає
   * на підбір — через пам'ять про компанії у scoreJob.
   *
   * Умова user_id — це перевірка власності: id рядка приходить із кнопки, і
   * без неї чужий id ховав би чужу вакансію.
   */
  if (data.startsWith("hd:")) {
    const sentId = data.slice(3);
    await run(
      "UPDATE sent SET hidden_at=COALESCE(hidden_at, datetime('now')) WHERE id=? AND user_id=?",
      sentId, user.id);
    await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
    await send(env, chatId, say("hidden", locale));
    return;
  }

  if (data.startsWith("fb:")) {
    const [, digestId, reaction] = data.split(":");
    if (digestId && (reaction === "not_relevant" || reaction === "more")) {
      await run("INSERT INTO feedback (id,user_id,digest_id,reaction) VALUES (?,?,?,?)",
        uuid(), user.id, digestId, reaction);
      await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
      if (reaction === "more") {
        // Черга, а не обіцянка: сайт на Workers не дотягнеться до сканера,
        // тому запит підбирає сервер під час найближчого прогону доставки.
        // Один відкритий запит на людину — те саме правило, що й на сайті.
        await run(
          `INSERT INTO delivery_requests (id,user_id)
           SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=? AND handled_at IS NULL)`,
          uuid(), user.id, user.id);
        await send(env, chatId, say("moreQueued", locale));
      } else {
        // «Дякую, врахую» було неправдою: реакція нікуди не впливала.
        // Тепер питаємо, ЩО саме не так — з цього можна вчитись.
        await sendKeyboard(env, chatId, say("askWhy", locale), [
          [{ text: say("whySphere", locale),   callback_data: `wh:${digestId}:sphere` },
           { text: say("whyPlace", locale),    callback_data: `wh:${digestId}:place` }],
          [{ text: say("whyMoney", locale),    callback_data: `wh:${digestId}:money` },
           { text: say("whyIndustry", locale), callback_data: `wh:${digestId}:industry` }],
          [{ text: say("whyRemote", locale),   callback_data: `wh:${digestId}:remote` },
           { text: say("whyStale", locale),    callback_data: `wh:${digestId}:stale` }],
          [{ text: say("whySame", locale),     callback_data: `wh:${digestId}:same` },
           { text: say("whyOther", locale),    callback_data: `wh:${digestId}:other` }],
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
      const current = row?.delivery_hour ?? 9;
      const zone = row?.timezone ?? "UTC";

      if (arg === undefined) {
        // Зону бот лише вгадує з мови чи міста — і каже про це прямо.
        await send(env, chatId,
          `${timeNow(locale, current, zone)}\n${say("timeZoneHint", locale)}\n\n${say("timeUsage", locale)}`);
        break;
      }

      // Приймаємо і «9», і «09:00»: людина напише як звикла.
      const hour = Number.parseInt(arg.replace(/:.*$/, ""), 10);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        await send(env, chatId, say("timeBad", locale));
        break;
      }

      // Другий аргумент — зона: /time 9 Europe/Paris, або містом: /time 9 Київ.
      const zoneArg = text.split(/\s+/).slice(2).join(" ").trim();
      let nextZone = zone;
      if (zoneArg) {
        const picked = isKnownZone(zoneArg) ? zoneArg : timezoneFromCity(zoneArg);
        if (!picked) { await send(env, chatId, say("zoneBad", locale)); break; }
        nextZone = picked;
      }

      await run("UPDATE users SET delivery_hour=?, timezone=?, updated_at=datetime('now') WHERE id=?",
        hour, nextZone, user!.id);
      await send(env, chatId, timeSet(locale, hour, nextZone));
      break;
    }

    // Мова: /lang ua (або сам код uk), без аргументу — кнопки.
    case "/lang": {
      const arg = (text.split(/\s+/)[1] ?? "").toLowerCase();
      if (!arg) { await sendLangKeyboard(env, chatId, locale); break; }
      const chosen = toLocale(arg);
      if (!chosen) { await send(env, chatId, say("langBad", locale)); break; }
      await setLocale(env, chatId, user!.id, chosen);
      break;
    }

    // Підсумок і рядок кнопок: кожна відкриває клавіатуру одного питання.
    case "/profile": {
      if (!(await loadDraft(user!.id))) { await send(env, chatId, say("noProfile", locale)); break; }
      // Команду набрали внизу чату — меню має бути там же, тож нове
      // повідомлення. Далі воно й стає якорем на всю правку.
      await showProfileMenu(env, chatId, user!.id, locale, null);
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

    // Вхід для власника: одна команда — і одразу в панель, без проміжного
    // кабінету. Сесія живе 30 днів, тож насправді це раз на місяць.
    case "/admin": {
      if (String(chatId) !== env.ADMIN_CHAT_ID) { await send(env, chatId, say("unknown", locale)); break; }
      const token = crypto.randomUUID().replace(/-/g, "");
      await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?",
        token, new Date(Date.now() + 15 * 60_000).toISOString(), user!.id);
      const base = env.SITE_URL ?? "https://nextrole.info";
      await send(env, chatId, `${say("adminLink", locale)}\n${base}/enter?token=${token}&to=/admin`);
      break;
    }

    case "/news":
      await send(env, chatId, say("channel", locale));
      break;

    case "/help":
      await send(env, chatId, say("help", locale));
      break;

    // Одна команда стирала все одразу — без жодного «точно?». Кнопка
    // «Скасувати» — бо в меню /delete стоїть поруч із /help, і промах пальцем
    // не має коштувати профілю.
    case "/delete":
      await sendKeyboard(env, chatId, say("deleteAsk", locale), [
        [{ text: say("deleteYes", locale), callback_data: "del:yes" },
         { text: say("deleteNo", locale),  callback_data: "del:no" }],
      ]);
      break;

    default:
      await send(env, chatId, say("help", locale));
  }
}
