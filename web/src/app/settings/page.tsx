import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { regenerateConnectToken } from "../actions";

export default async function Settings() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  return (
    <div className="flex flex-1 justify-center bg-white px-6 py-16">
      <main className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Delivery settings
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Your daily opportunities are sent to Telegram.
        </p>

        <div className="mt-8 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-700">
          {user.telegramChatId ? "Telegram connected." : "Telegram not connected yet."}
        </div>

        <form action={regenerateConnectToken} className="mt-4">
          <button
            type="submit"
            className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {user.telegramChatId ? "Reconnect Telegram" : "Connect Telegram"}
          </button>
        </form>
      </main>
    </div>
  );
}
