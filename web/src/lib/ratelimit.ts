import { one, run } from "./db";

/**
 * Просте вікняне обмеження на D1.
 *
 * Вхід і реєстрація були єдиними ендпоінтами без жодного гальма: пароль можна
 * було підбирати нескінченно. Рахуємо спроби у вікні й блокуємо на час.
 */

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 8;
const BLOCK_MINUTES = 30;

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
export function nextState(row: AttemptRow | null, now: Date): AttemptRow {
  const windowExpired = !row ||
    (now.getTime() - new Date(row.window_start).getTime()) > WINDOW_MINUTES * 60_000;
  const attempts = windowExpired ? 1 : row.attempts + 1;
  return {
    attempts,
    window_start: windowExpired ? now.toISOString() : row.window_start,
    blocked_until: attempts >= MAX_ATTEMPTS
      ? new Date(now.getTime() + BLOCK_MINUTES * 60_000).toISOString() : null,
  };
}

export async function checkRate(key: string): Promise<RateVerdict> {
  const row = await one<AttemptRow>(
    "SELECT attempts,window_start,blocked_until FROM auth_attempts WHERE key=?", key);
  return decide(row, new Date());
}

/** Викликається ПІСЛЯ невдалої спроби. */
export async function recordFailure(key: string): Promise<void> {
  const row = await one<AttemptRow>(
    "SELECT attempts,window_start,blocked_until FROM auth_attempts WHERE key=?", key);
  const next = nextState(row, new Date());
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
