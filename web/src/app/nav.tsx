import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";
import { logout, switchLocale } from "./actions";
import { LOCALES } from "@/lib/i18n";

/** `onNight` — навігація поверх темної смуги на головній. */
export default async function Nav({ locale, onNight = false }: { locale: Locale; onNight?: boolean }) {
  const user = await currentUser();
  const line = onNight ? "var(--night-rule)" : "var(--rule)";
  const dim = onNight ? "var(--night-2)" : "var(--muted)";

  return (
    <header style={{ borderBottom: `1px solid ${line}` }}>
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="display text-lg tracking-tight">NextRole</span>
          <span className="eyebrow hidden sm:inline" style={{ color: dim }}>
            {t(locale, "nav.strap")}
          </span>
        </Link>

        <div className="flex items-center gap-5 text-sm" style={{ color: dim }}>
          <form action={switchLocale} className="flex gap-2">
            {LOCALES.map((l) => (
              <button key={l.id} name="locale" value={l.id} type="submit"
                className="mono text-xs uppercase hover:opacity-100"
                style={{ opacity: l.id === locale ? 1 : 0.45,
                         color: l.id === locale ? "var(--ember)" : "inherit" }}>
                {l.id}
              </button>
            ))}
          </form>
          {user ? (
            <>
              <Link href="/dashboard" className="hover:opacity-70">{t(locale, "dash.title")}</Link>
              <Link href="/settings" className="hover:opacity-70">{t(locale, "dash.settings")}</Link>
              {user.isAdmin && (
                <Link href="/admin" className="mono text-xs hover:opacity-70" style={{ color: "var(--ember)" }}>
                  {t(locale, "nav.admin")}
                </Link>
              )}
              <form action={logout}>
                <button type="submit" className="hover:opacity-70">{t(locale, "auth.logout")}</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="hover:opacity-70">{t(locale, "auth.login")}</Link>
          )}
        </div>
      </nav>
    </header>
  );
}
