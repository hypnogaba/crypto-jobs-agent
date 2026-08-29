import { one, run } from "./db";

/**
 * Просте вікняне обмеження на D1.
 *
 * Рахуємо спроби у вікні за ключем (зазвичай адреса з cf-connecting-ip) і
 * блокуємо на час. Стан у базі, а не в пам'яті: ізоляти Workers живуть
 * недовго, і лічильник у пам'яті скидався б сам собою.
 */

export interface Limits { windowMinutes: number; maxAttempts: number; blockMinutes: number }

/**
 * Жорсткий ліміт — для того, що має вигляд підбору. Сьогодні це вебхук
 * Telegram із неправильним секретом: справжній Telegram у секреті ніколи
 * не помиляється, тож кожна невдача тут — чужа.
 */
export const STRICT_LIMITS: Limits = { windowMinutes: 15, maxAttempts: 8, blockMinutes: 30 };
export const WEBHOOK_401_LIMITS: Limits = STRICT_LIMITS;

/**
 * Початок анкети з головної: без сесії, з викликом моделі всередині. Без
 * ліміту це був би відкритий кран на рахунок Anthropic і на таблицю users.
 * Двадцять на годину з однієї адреси — з запасом для офісу за NAT.
 */
export const ONBOARD_LIMITS: Limits = { windowMinutes: 60, maxAttempts: 20, blockMinutes: 60 };

/**
 * Відгук: м'яко. Він рахує УСПІШНІ надсилання, а не невдачі, і за однією
 * адресою може сидіти цілий офіс чи мобільна мережа за NAT. Вісім відгуків
 * за чверть години блокували на пів години всіх сусідів по адресі.
 */
export const FEEDBACK_LIMITS: Limits = { windowMinutes: 60, maxAttempts: 20, blockMinutes: 60 };

export interface RateVerdict { allowed: boolean; retryAfterMinutes: number }

export interface AttemptRow { attempts: number; window_start: string; blocked_until: string | null }

/** Чисте рішення — щоб його можна було перевірити тестом без бази. */
export function decide(row: AttemptRow | null, now: Date): RateVerdict {
  if (!row?.blocked_until) return { allowed: true, retryAfterMinutes: 0 };
  const until = new Date(row.blocked_until).getTime();
  if (until <= now.getTime()) return { allowed: true, retryAfterMinutes: 0 };
  return { allowed: false, retryAfterMinutes: Math.ceil((until - now.getTime()) / 60_000) };
}

/** Чистий підрахунок наступного стану після невдалої спроби. */
export function nextState(row: AttemptRow | null, now: Date, limits: Limits = STRICT_LIMITS): AttemptRow {
  const windowExpired = !row ||
    (now.getTime() - new Date(row.window_start).getTime()) > limits.windowMinutes * 60_000;
  const attempts = windowExpired ? 1 : row.attempts + 1;
  return {
    attempts,
    window_start: windowExpired ? now.toISOString() : row.window_start,
    blocked_until: attempts >= limits.maxAttempts
      ? new Date(now.getTime() + limits.blockMinutes * 60_000).toISOString() : null,
  };
}

export async function checkRate(key: string): Promise<RateVerdict> {
  const row = await one<AttemptRow>(
    "SELECT attempts,window_start,blocked_until FROM auth_attempts WHERE key=?", key);
  return decide(row, new Date());
}

/** Викликається ПІСЛЯ невдалої спроби (або, з м'якими лімітами, після кожної). */
export async function recordFailure(key: string, limits: Limits): Promise<void> {
  const row = await one<AttemptRow>(
    "SELECT attempts,window_start,blocked_until FROM auth_attempts WHERE key=?", key);
  const next = nextState(row, new Date(), limits);
  await run(
    `INSERT INTO auth_attempts (key,attempts,window_start,blocked_until) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts,
       window_start=excluded.window_start, blocked_until=excluded.blocked_until`,
    key, next.attempts, next.window_start, next.blocked_until);
}

/** Успішний вхід стирає лічильник. */
export async function clearRate(key: string): Promise<void> {
  await run("DELETE FROM auth_attempts WHERE key=?", key);
}
