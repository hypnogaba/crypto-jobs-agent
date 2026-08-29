/**
 * Один виклик Bot API на всіх.
 *
 * Досі кожне місце, що писало в Telegram, робило власний fetch і не дивилось
 * на відповідь: помилка (заблокований бот, задовгий текст, ліміт 429) зникала
 * мовчки, і зрозуміти з логів, чому людина нічого не отримала, було нічим.
 *
 * Тепер: невдала відповідь пишеться в console.warn разом із описом від
 * Telegram; на 429 чекаємо стільки, скільки просить retry_after, і пробуємо
 * ще раз — один. Далі здаємось: вебхук мусить відповісти Telegram швидко.
 */

export interface TgResult<T = unknown> { ok: boolean; result?: T; description?: string; error_code?: number }

/** Стеля очікування на 429: довше — і Workers уб'є запит раніше за нас. */
const MAX_RETRY_MS = 5_000;

/** Скільки чекати перед повтором, або null, якщо повторювати не варто. Чиста — для тесту. */
export function retryDelayMs(status: number, body: { parameters?: { retry_after?: number } } | null): number | null {
  if (status !== 429) return null;
  const s = body?.parameters?.retry_after;
  const ms = typeof s === "number" && s > 0 ? s * 1000 : 1000;
  return ms <= MAX_RETRY_MS ? ms : null;
}

export async function callTelegram<T = unknown>(
  token: string | undefined, method: string, payload: Record<string, unknown>,
): Promise<TgResult<T>> {
  if (!token) return { ok: false, description: "no token" };

  const once = async (): Promise<{ status: number; body: TgResult<T> & { parameters?: { retry_after?: number } } }> => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: TgResult<T> = { ok: false, description: `http ${res.status}` };
    try { body = (await res.json()) as TgResult<T>; } catch { /* тіло не JSON — лишаємо статус */ }
    return { status: res.status, body };
  };

  try {
    let { status, body } = await once();
    const wait = retryDelayMs(status, body);
    if (wait !== null) {
      await new Promise((r) => setTimeout(r, wait));
      ({ status, body } = await once());
    }
    if (!body.ok) {
      console.warn(`telegram ${method} failed: ${status} ${body.description ?? ""} chat=${String(payload.chat_id ?? "")}`);
    }
    return body;
  } catch (e) {
    console.warn(`telegram ${method} threw: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, description: "network" };
  }
}

/** Просте текстове повідомлення без прев'ю посилань. */
export const sendText = (token: string | undefined, chatId: number | string, text: string): Promise<TgResult> =>
  callTelegram(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
