import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";
import { cookies } from "next/headers";
import { logout, switchLocale, switchTheme } from "./actions";
import { LOCALES } from "@/lib/i18n";

/** Три стани теми: світло, темрява, як у системі. Порожнє значення — системна. */
const THEMES = [
  { id: "light",  key: "theme.light",  icon: <circle cx="12" cy="12" r="4" /> },
  { id: "dark",   key: "theme.dark",   icon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" /> },
  { id: "system", key: "theme.system", icon: <rect x="3" y="5" width="18" height="12" rx="1.5" /> },
] as const;

export default async function Nav({ locale }: { locale: Locale }) {
  const user = await currentUser();
  const theme = (await cookies()).get("nr_theme")?.value ?? "system";
  const dim = "var(--muted)";

  return (
    <header className="topbar">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="display text-lg">NextRole</span>
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

          <form action={switchTheme} className="flex items-center gap-1">
            {THEMES.map((th) => (
              <button key={th.id} name="theme" value={th.id === "system" ? "" : th.id}
                type="submit" title={t(locale, th.key)} aria-label={t(locale, th.key)}
                className="flex h-6 w-6 items-center justify-center hover:opacity-100"
                style={{ opacity: th.id === theme ? 1 : 0.4,
                         color: th.id === theme ? "var(--ember)" : "inherit" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {th.icon}
                </svg>
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
