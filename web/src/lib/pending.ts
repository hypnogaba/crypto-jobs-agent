import { one, run, uuid } from "@/lib/db";
import { persistProfile, type WritableProfile } from "@/lib/profile-write";

/**
 * Анкета, заповнена на сайті, доки в неї ще немає жодного способу зв'язку.
 *
 * Акаунт створювався одразу після другого кроку, і єдиним ключем до нього
 * лишалась кука на тридцять днів. Виміряно 02.09: сім акаунтів із двадцяти
 * чотирьох не мали Telegram, отримали 105 добірок і зробили нуль подач, а
 * двоє вже не мали навіть сесії, тобто до свого кабінету не дістались би
 * ніколи.
 *
 * Тепер між анкетою і акаунтом стоїть цей рядок. Він нічого не коштує: ні
 * добірок, ні викликів моделі, ні місця в статистиці. Людина, яка не дійшла
 * до бота, не лишає по собі сироту, і нам не треба вирішувати, що з нею
 * робити через два тижні.
 */

/** Кука з ідентифікатором анкети. Токен у ній не лежить: він їде в Telegram. */
export const PENDING_COOKIE = "nr_pending";

/**
 * Скільки чекаємо. Тиждень — це «завтра з іншого пристрою», але вже не
 * «колись». Далі рядок зносить прибиральник, і людина заповнює анкету
 * заново, а не отримує добірку за профілем, якого не пам'ятає.
 */
export const PENDING_TTL = "-7 day";

export interface PendingInput {
  locale: string;
  timezone: string;
  profile: WritableProfile;
  rawInput: string | null;
  source: string;
}

export async function createPending(p: PendingInput): Promise<{ id: string; token: string }> {
  const id = uuid();
  const token = crypto.randomUUID().replace(/-/g, "");
  await run(
    `INSERT INTO pending_signups (id,token,locale,timezone,profile,raw_input,source)
     VALUES (?,?,?,?,?,?,?)`,
    id, token, p.locale, p.timezone, JSON.stringify(p.profile), p.rawInput, p.source);
  await sweepPending();
  return { id, token };
}

export interface PendingRow {
  id: string; token: string; locale: string; timezone: string;
  profile: WritableProfile; rawInput: string | null; source: string;
  claimedUserId: string | null;
}

const parseRow = (r: {
  id: string; token: string; locale: string; timezone: string; profile: string;
  raw_input: string | null; source: string; claimed_user_id: string | null;
}): PendingRow | null => {
  try {
    return { id: r.id, token: r.token, locale: r.locale, timezone: r.timezone,
             profile: JSON.parse(r.profile) as WritableProfile,
             rawInput: r.raw_input, source: r.source, claimedUserId: r.claimed_user_id };
  } catch { return null; }
};

const COLUMNS = "id,token,locale,timezone,profile,raw_input,source,claimed_user_id";

/** Анкета за кукою. Прострочену не віддаємо, навіть якщо рядок ще лежить. */
export async function pendingById(id: string): Promise<PendingRow | null> {
  const row = await one<Parameters<typeof parseRow>[0]>(
    `SELECT ${COLUMNS} FROM pending_signups WHERE id=? AND created_at >= datetime('now', ?)`,
    id, PENDING_TTL);
  return row ? parseRow(row) : null;
}

/** Анкета за токеном із глибокого посилання. */
export async function pendingByToken(token: string): Promise<PendingRow | null> {
  const row = await one<Parameters<typeof parseRow>[0]>(
    `SELECT ${COLUMNS} FROM pending_signups WHERE token=? AND created_at >= datetime('now', ?)`,
    token, PENDING_TTL);
  return row ? parseRow(row) : null;
}

/**
 * Забрати анкету собі: народження акаунта.
 *
 * Викликає бот, і лише він: до цієї миті рядка в `users` не існує. Двічі
 * забрати не можна — другий дотик по тому самому посиланню віддає той самий
 * акаунт, а не створює новий.
 */
export async function claimPending(
  token: string, chatId: string,
): Promise<{ userId: string; locale: string; fresh: boolean } | null> {
  const p = await pendingByToken(token);
  if (!p) return null;
  if (p.claimedUserId) return { userId: p.claimedUserId, locale: p.locale, fresh: false };

  // Цей chat_id уже може мати акаунт: людина пройшла /start у боті, а потім
  // заповнила анкету на сайті. Тоді анкета лягає в наявний акаунт, а другий
  // не створюється — інакше в неї було б два, і добірки йшли б із того, про
  // який вона не знає.
  const existing = await one<{ id: string }>(
    "SELECT id FROM users WHERE telegram_chat_id=?", chatId);
  const userId = existing?.id ?? uuid();

  if (!existing) {
    await run(
      `INSERT INTO users (id,telegram_chat_id,locale,timezone,delivery_hour,last_interaction_at)
       VALUES (?,?,?,?,9,datetime('now'))`,
      userId, chatId, p.locale, p.timezone);
  }
  await persistProfile(userId, p.rawInput, p.source, p.profile);
  // Слід для сайту: людина повернеться з тією самою кукою, і сторінка
  // перетворить її на сесію замість того, щоб питати вхід.
  await run("UPDATE pending_signups SET claimed_user_id=? WHERE id=?", userId, p.id);
  return { userId, locale: p.locale, fresh: !existing };
}

/** Рядок відпрацював: сесію створено, більше він не потрібен. */
export async function dropPending(id: string): Promise<void> {
  await run("DELETE FROM pending_signups WHERE id=?", id);
}

/**
 * Прибирання. Окремого крона у Воркера немає, тож чистимо там, де й так
 * пишемо: чужа анкета не має лежати довше, ніж ми пообіцяли.
 */
export async function sweepPending(): Promise<void> {
  await run("DELETE FROM pending_signups WHERE created_at < datetime('now', ?)", PENDING_TTL);
}
