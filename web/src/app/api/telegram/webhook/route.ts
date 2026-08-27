import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { parseStartCommand } from "@/lib/telegram-connect";

export async function POST(request: Request) {
  const update = await request.json<{
    message?: { text?: string; chat?: { id?: number } };
  }>();
  const message = update.message;
  const text: string | undefined = message?.text;
  const chatId: number | undefined = message?.chat?.id;

  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }

  const token = parseStartCommand(text);
  if (!token) {
    return NextResponse.json({ ok: true });
  }

  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({ where: { connectToken: token } });
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: String(chatId), connectToken: null },
  });

  return NextResponse.json({ ok: true });
}
