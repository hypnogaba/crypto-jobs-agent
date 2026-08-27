import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Nav from "../nav";
import { createConnectToken, detectLocale } from "../actions";
import { currentUser } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { t } from "@/lib/i18n";

export default async function Telegram() {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");

  if (user.telegramChatId) {
    return (
      <>
        <Nav locale={locale} />
        <main className="mx-auto w-full max-w-md flex-1 px-6 py-20 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "telegram.done")}</h1>
          <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "telegram.doneLede")}</p>
          <Link href="/dashboard" className="btn mt-8 inline-block">{t(locale, "dash.title")}</Link>
        </main>
      </>
    );
  }

  // Токен одноразовий і живе 15 хвилин
  let row = await one<{ connect_token: string | null; connect_expires_at: string | null }>(
    "SELECT connect_token,connect_expires_at FROM users WHERE id=?", user.id);
  const expired = !row?.connect_expires_at || new Date(row.connect_expires_at).getTime() < Date.now();
  if (!row?.connect_token || expired) {
    const token = crypto.randomUUID().replace(/-/g, "");
    await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?",
      token, new Date(Date.now() + 15 * 60_000).toISOString(), user.id);
    row = { connect_token: token, connect_expires_at: null };
  }

  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  const bot = env.TELEGRAM_BOT_USERNAME ?? "mynextrole_bot";
  const deepLink = `https://t.me/${bot}?start=${row.connect_token}`;

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "telegram.title")}</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "telegram.lede")}</p>
        <a href={deepLink} className="btn mt-8 inline-block">{t(locale, "telegram.button")}</a>
        <form action={createConnectToken} className="mt-4">
          <button type="submit" className="text-sm underline" style={{ color: "var(--muted)" }}>
            {t(locale, "telegram.regen")}
          </button>
        </form>
        <p className="mt-8 text-sm">
          <Link href="/dashboard" className="underline" style={{ color: "var(--muted)" }}>
            {t(locale, "telegram.skip")}
          </Link>
        </p>
      </main>
    </>
  );
}
