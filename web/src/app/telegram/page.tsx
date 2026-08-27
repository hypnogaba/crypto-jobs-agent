import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Shell from "../shell";
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
      <Shell locale={locale} title={t(locale, "telegram.done")} lede={t(locale, "telegram.doneLede")}>
        <Link href="/dashboard" className="btn">{t(locale, "dash.title")}</Link>
      </Shell>
    );
  }

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

  return (
    <Shell locale={locale} eyebrow="03 / 03" title={t(locale, "telegram.title")} lede={t(locale, "telegram.lede")}>
      <div className="card px-7 py-8">
        <a href={`https://t.me/${bot}?start=${row.connect_token}`} className="btn">
          {t(locale, "telegram.button")}
        </a>
        <p className="mono mt-5 text-xs" style={{ color: "var(--muted)" }}>
          @{bot} · {t(locale, "telegram.expiry")}
        </p>
        <form action={createConnectToken} className="mt-5 border-t pt-5" style={{ borderColor: "var(--rule)" }}>
          <button type="submit" className="text-sm link" style={{ color: "var(--muted)" }}>
            {t(locale, "telegram.regen")}
          </button>
        </form>
      </div>
      <p className="mt-6 text-sm">
        <Link href="/dashboard" className="link" style={{ color: "var(--muted)" }}>
          {t(locale, "telegram.skip")}
        </Link>
      </p>
    </Shell>
  );
}
