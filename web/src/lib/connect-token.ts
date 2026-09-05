import { one, run } from "./db";

/**
 * Разові токени: вхід на сайт і прив'язка Telegram.
 *
 * ЩО БУЛО. Один стовпець `users.connect_token` тримав ВІДКРИТИМ ТЕКСТОМ
 * секрет, який відмикає акаунт, і обслуговував двоє різних дверей одночасно:
 * `/enter?token=` (вхід, 30 днів сесії) і `t.me/…?start=` (прив'язка чату).
 * Бот шле посилання входу в чат, і токен читається просто з екрана — власник
 * надіслав скриншот, де він розбірливий. Далі одного дотику досить: двері
 * прив'язки приймали цей самий токен як свій, і акаунт жертви переїжджав на
 * Telegram того, хто скриншот побачив. Доставка йде за users.telegram_chat_id
 * (scanner/src/digest.ts), тож жертва мовчки переставала отримувати добірки, а
 * нападник отримував і їх, і всі наступні посилання входу.
 *
 * ЩО ТЕПЕР, двома змінами, які працюють лише разом:
 *
 *  1. У базу лягає SHA-256, а не сам токен. Хто прочитав базу (дамп, зайвий
 *     SELECT в адмінці, підрядник), має 64 непридатні символи, а не ключ.
 *
 *  2. Призначення входить у САМ дайджест: sha256("link:"+t) проти
 *     sha256("enter:"+t). Окремий стовпець `purpose` був би другою умовою в
 *     WHERE, яку можна забути дописати — і саме її колись і забули, звідси вся
 *     вада. Тут забути неможливо: двері прив'язки рахують свій дайджест, і
 *     токен входу не знаходить рядка ВЗАГАЛІ, скільки б перевірок поруч потім
 *     не прибрали.
 *
 * Порівняння секретів у сталому часі тут не потрібне, і його свідомо немає:
 * ми не звіряємо рядки в коді, а шукаємо точний збіг 256-бітного дайджесту в
 * унікальному індексі. Додавати «безпечне порівняння» тут нема куди.
 */
export type ConnectPurpose = "link" | "enter";

/** Скільки живе разове посилання. 15 хвилин — стільки й було. */
export const CONNECT_TTL_MS = 15 * 60_000;

/** 32 hex, 128 біт випадковості. Формат той самий, що видавався досі. */
export function newConnectToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Дайджест, який лягає в базу.
 *
 * Асинхронна, бо crypto.subtle.digest на Workers повертає проміс. Усі сім
 * місць, звідки вона кличеться, вже стоять усередині async-функції й уже
 * роблять await one()/await run() — колір функції не змінюється ніде.
 */
export async function hashConnectToken(purpose: ConnectPurpose, token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${purpose}:${token}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Видати токен: у базу — хеш, назовні — сам токен.
 *
 * Єдине місце карбування в проєкті. Це не охайність, а умова правильності:
 * рядок, записаний повз цю функцію, або лишиться відкритим текстом, або
 * матиме дайджест не того призначення, і симптом буде «посилання просто не
 * працює», без жодної помилки в лозі.
 */
export async function issueConnectToken(
  userId: string, purpose: ConnectPurpose, ttlMs: number = CONNECT_TTL_MS,
): Promise<string> {
  const token = newConnectToken();
  await run("UPDATE users SET connect_token_hash=?, connect_expires_at=? WHERE id=?",
    await hashConnectToken(purpose, token), new Date(Date.now() + ttlMs).toISOString(), userId);
  return token;
}

/** Свіжий власник цього хеша, або null. Рядка НЕ чистить. */
export async function findUserByConnectHash(hash: string): Promise<{ id: string } | null> {
  const row = await one<{ id: string; connect_expires_at: string | null }>(
    "SELECT id,connect_expires_at FROM users WHERE connect_token_hash=?", hash);
  if (!row?.connect_expires_at) return null;
  return new Date(row.connect_expires_at).getTime() > Date.now() ? { id: row.id } : null;
}

/** Те саме, коли на руках сам токен: звірка ЗАВЖДИ з призначенням. */
export async function verifyConnectToken(
  purpose: ConnectPurpose, token: string,
): Promise<{ id: string } | null> {
  return findUserByConnectHash(await hashConnectToken(purpose, token));
}

/**
 * Гасіння токена окремої функції не має навмисно: обидва місця, де токен
 * витрачається, все одно пишуть у той самий рядок (`last_interaction_at` на
 * вході, `telegram_chat_id` при прив'язці). Один UPDATE замість двох — це не
 * стиль, а гроші: у D1 запис коштує $1 за мільйон рядків проти $0.001 за
 * мільйон читань, і саме запис у нас найближче до стелі (0044).
 */

/** Переїхало з telegram-connect.ts: про токен має бути один модуль. */
export function buildTelegramDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}

export function parseStartCommand(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text.trim());
  return match ? match[1]! : null;
}
