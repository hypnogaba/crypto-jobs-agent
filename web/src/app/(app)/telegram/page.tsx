import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Shell from "@/app/shell";
import { createConnectToken, detectLocale } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { t } from "@/lib/i18n";
import { formatWhen, nextDelivery } from "@/lib/digest-time";


export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "telegram.title") };
}

export default async function Telegram() {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");

  if (user.telegramChatId) {
    const me = await one<{ timezone: string; delivery_hour: number }>(
      "SELECT timezone,delivery_hour FROM users WHERE id=?", user.id);
    const tz = me?.timezone ?? "UTC";
    const when = formatWhen(nextDelivery(tz, me?.delivery_hour ?? 9, new Date()), tz, locale);
    return (
      <Shell locale={locale} title={t(locale, "telegram.done")} lede={t(locale, "telegram.doneLede").replace("{when}", when)}>
        <Link href="/dashboard" className="btn">{t(locale, "dash.title")}</Link>
      </Shell>
    );
  }

  let row = await one<{ connect_token: string | null; connect_expires_at: string | null }>(
    "SELECT connect_token,connect_expires_at FROM users WHERE id=?", user.id);
  // Правило чистоти React стосується клієнтських компонентів, які можуть
  // перемальовуватись. Це серверний компонент: він виконується один раз на
  // запит, і поточний час тут — саме те, що потрібно.
  /* eslint-disable react-hooks/purity */
  const now = Date.now();
  const expired = !row?.connect_expires_at || new Date(row.connect_expires_at).getTime() < now;
  if (!row?.connect_token || expired) {
    const token = crypto.randomUUID().replace(/-/g, "");
    await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?",
      token, new Date(now + 15 * 60_000).toISOString(), user.id);
    row = { connect_token: token, connect_expires_at: null };
  }
  /* eslint-enable react-hooks/purity */

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
      {/* Кнопки «пропустити» тут немає навмисно.
          Доставка і є продукт: людина, яка пропустить цей крок, зробить усю
          роботу й не отримає нічого, а дізнається про це лише тим, що зранку
          нічого не прийде. Єдиний вихід звідси — підключити Telegram. */}
      <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
        {t(locale, "telegram.why")}
      </p>
    </Shell>
  );
}
