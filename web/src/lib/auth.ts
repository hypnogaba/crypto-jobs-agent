import { cookies } from "next/headers";
import { one, run, uuid } from "./db";

/**
 * Сесія в базі, непрозорий id у куці. Раніше в застосунку не було захисту
 * взагалі — userId лежав у непідписаній куці, і будь-хто, підставивши чужий
 * id, відкривав чужий кабінет.
 *
 * Паролів більше немає: вхід лише через Telegram (одноразове посилання з
 * бота). Код PBKDF2 прибрано разом із формою входу — мертвий код із
 * криптографією всередині лише вводить в оману під час перевірок.
 */

const SESSION_COOKIE = "nr_session";
const SESSION_DAYS = 30;

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
  // Вихід — зручний момент прибрати протерміноване: нічого не чекає на відповідь.
  await pruneSessions();
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
