/**
 * Delivery abstraction — sends a daily card to the user via their chosen
 * channel (Telegram or email). Telegram is fully wired up (reuses the
 * Phase 1 test bot). Email is a no-op until RESEND_API_KEY is set.
 */

import type { User, JobSignal, DailyCard } from "@/generated/prisma/client";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

export async function deliverCard(
  user: User,
  card: DailyCard,
  signal: JobSignal
): Promise<{ ok: boolean; error?: string }> {
  const text = formatCardText(signal, card.whyYou, card.draftText);

  if (user.deliveryChannel === "TELEGRAM") {
    return deliverViaTelegram(user.telegramChatId, text);
  }
  return deliverViaEmail(user.email, signal.role, text);
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
  const data = await res.json();
  return data.ok ? { ok: true } : { ok: false, error: JSON.stringify(data) };
}

async function deliverViaEmail(
  email: string,
  role: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "jobs@yourdomain.com",
      to: email,
      subject: `New opportunity: ${role}`,
      text,
    }),
  });
  if (!res.ok) {
    return { ok: false, error: await res.text() };
  }
  return { ok: true };
}
