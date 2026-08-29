import { cookies } from "next/headers";
import { all, one, run, uuid } from "./db";

/**
 * Аутентифікація на власних силах: PBKDF2 із WebCrypto (доступний у Workers)
 * і сесія в базі. Раніше в застосунку не було захисту взагалі — userId лежав
 * у непідписаній куці, і будь-хто, підставивши чужий id, відкривав чужий кабінет.
 */

const SESSION_COOKIE = "nr_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 210_000;

const enc = new TextEncoder();
const toHex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function derive(password: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await derive(password, salt)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !expected) return false;
  const actual = await derive(password, salt);
  // Порівняння сталого часу — щоб не зливати хеш через таймінг
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface SessionUser {
  id: string;
  email: string | null;
  telegramChatId: string | null;
  locale: string;
  status: string;
  isAdmin: boolean;
  /**
   * Часовий пояс людини. Лежить у сесії, а не добирається окремим запитом:
   * його читає кожна внутрішня сторінка, щоб тихо доповнити зону, коли в
   * базі досі стоїть UTC.
   */
  timezone: string;
}

/**
 * Адмін — це власник, названий явно.
 *
 * Раніше запасним варіантом був «перший зареєстрований акаунт». Відколи
 * реєстрація не питає пошти, першим акаунтом стає перший випадковий
 * відвідувач — тож запасний варіант прибрано. Без ADMIN_CHAT_ID (або
 * застарілого ADMIN_EMAIL) адмінки немає ні в кого.
 */
async function isAdminUser(email: string | null, chatId: string | null): Promise<boolean> {
  const { env } = await import("@opennextjs/cloudflare").then((m) => m.getCloudflareContext());
  const vars = env as unknown as Record<string, string | undefined>;

  if (vars.ADMIN_CHAT_ID && chatId && chatId === vars.ADMIN_CHAT_ID) return true;
  if (vars.ADMIN_EMAIL && email && email.toLowerCase() === vars.ADMIN_EMAIL.toLowerCase()) return true;
  return false;
}

export async function createSession(userId: string): Promise<void> {
  const id = uuid();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await run("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)", id, userId, expires.toISOString());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await run("DELETE FROM sessions WHERE id=?", id);
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;

  const row = await one<{
    id: string; email: string | null; telegram_chat_id: string | null;
    locale: string; status: string; timezone: string; expires_at: string;
  }>(`SELECT u.id,u.email,u.telegram_chat_id,u.locale,u.status,u.timezone,s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sid);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run("DELETE FROM sessions WHERE id=?", sid);
    return null;
  }
  if (row.status === "deleted") return null;

  return {
    id: row.id, email: row.email, telegramChatId: row.telegram_chat_id,
    locale: row.locale, status: row.status, timezone: row.timezone,
    isAdmin: await isAdminUser(row.email, row.telegram_chat_id),
  };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error("FORBIDDEN");
  return u;
}

/** Прибирання протермінованих сесій — дешево і не дає таблиці рости вічно. */
export async function pruneSessions(): Promise<void> {
  await run("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
}

export const listSessions = (userId: string) =>
  all<{ id: string; expires_at: string }>("SELECT id,expires_at FROM sessions WHERE user_id=?", userId);
