import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateDeliveryChannel } from "../actions";

export default async function Settings() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  return (
    <div className="flex flex-1 justify-center bg-white px-6 py-16">
      <main className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Delivery settings
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Choose where your daily opportunities land.
        </p>

        <form action={updateDeliveryChannel} className="mt-8 flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="radio"
                name="deliveryChannel"
                value="EMAIL"
                defaultChecked={user.deliveryChannel === "EMAIL"}
              />
              Email ({user.email})
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="radio"
                name="deliveryChannel"
                value="TELEGRAM"
                defaultChecked={user.deliveryChannel === "TELEGRAM"}
              />
              Telegram
            </label>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              Telegram chat ID
            </span>
            <input
              type="text"
              name="telegramChatId"
              defaultValue={user.telegramChatId ?? ""}
              placeholder="Message the bot, we'll show you how"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Save
          </button>
        </form>
      </main>
    </div>
  );
}
