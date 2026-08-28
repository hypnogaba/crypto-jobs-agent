import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Shell from "../shell";
import { detectLocale } from "../actions";
import { t } from "@/lib/i18n";

/**
 * Вхід без пароля.
 *
 * Особа людини — це її Telegram, тож пароля тут немає й ніколи не було чого
 * забувати. Бот на команду /site видає разове посилання, яке розбирає /enter.
 */
export default async function Login() {
  const locale = await detectLocale();
  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  const bot = env.TELEGRAM_BOT_USERNAME ?? "mynextrole_bot";

  return (
    <Shell locale={locale} night center title={t(locale, "auth.login")} lede={t(locale, "auth.viaBotLede")}>
      <div className="card px-7 py-7">
        <p className="text-sm" style={{ color: "var(--night-2)" }}>{t(locale, "auth.viaBotStep")}</p>
        <a href={`https://t.me/${bot}?start=site`} className="btn mt-6">{t(locale, "auth.openBot")}</a>
        <p className="mono mt-5 text-xs" style={{ color: "var(--night-2)" }}>@{bot} · /site</p>
      </div>
      <p className="mt-6 text-sm" style={{ color: "var(--night-2)" }}>
        {t(locale, "auth.newHere")}{" "}
        <Link href="/" className="link" style={{ color: "var(--night-ink)" }}>
          {t(locale, "auth.startHere")}
        </Link>
      </p>
    </Shell>
  );
}
