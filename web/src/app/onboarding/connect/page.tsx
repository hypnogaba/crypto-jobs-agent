import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "@/lib/prisma";
import { buildTelegramDeepLink } from "@/lib/telegram-connect";
import { regenerateConnectToken } from "../../actions";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "your_bot";

export default async function OnboardingConnect() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  if (user.telegramChatId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
        <main className="w-full max-w-lg text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            You&apos;re connected
          </h1>
          <p className="mt-2 text-zinc-500">
            We&apos;ll send up to 5 matching roles a day to your Telegram.
          </p>
          <Link
            href="/dashboard"
            className="mt-8 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Go to dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (!user.connectToken) {
    const { generateConnectToken } = await import("@/lib/telegram-connect");
    const token = generateConnectToken();
    user = await prisma.user.update({ where: { id: userId }, data: { connectToken: token } });
  }

  const deepLink = buildTelegramDeepLink(BOT_USERNAME, user.connectToken!);

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Connect Telegram
        </h1>
        <p className="mt-2 text-zinc-500">
          Press the button, then press Start in Telegram. Come back and refresh this
          page once you have.
        </p>
        <a
          href={deepLink}
          className="mt-8 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Connect Telegram
        </a>
        <form action={regenerateConnectToken} className="mt-4">
          <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900">
            Link not working? Get a new one
          </button>
        </form>
      </main>
    </div>
  );
}
