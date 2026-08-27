/**
 * Delivery abstraction — sends a daily card to the user via Telegram.
 * Email delivery is out of scope for the MVP (Telegram-only).
 */

import type { User, JobSignal, DailyCard } from "@/generated/prisma/client";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function deliverCard(
  user: User,
  card: DailyCard,
  signal: JobSignal
): Promise<{ ok: boolean; error?: string }> {
  const text = formatCardText(signal, card.whyYou, card.draftText);
  return deliverViaTelegram(user.telegramChatId, text);
}

function formatCardText(signal: JobSignal, whyYou: string, draftText: string): string {
  const compLine =
    signal.compFrom && signal.compTo
      ? `$${signal.compFrom.toLocaleString()}-${signal.compTo.toLocaleString()}`
      : signal.compFrom
        ? `From $${signal.compFrom.toLocaleString()}`
        : "Compensation not listed";

  return [
    `${signal.company ?? "Unknown company"}, ${signal.role}`,
    `${compLine}${signal.remote ? `, ${signal.remote}` : ""}`,
    "",
    `Why you: ${whyYou}`,
    "",
    draftText,
  ].join("\n");
}

async function deliverViaTelegram(
  chatId: string | null,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  }
  if (!chatId) {
    return { ok: false, error: "User has no linked Telegram chat_id" };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
  const data = (await res.json()) as { ok: boolean };
  return data.ok ? { ok: true } : { ok: false, error: JSON.stringify(data) };
}
