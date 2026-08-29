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

/**
 * Знак: три пройдені сходинки і четверта клітинка попереду, ще не зайнята.
 * Геометрія та сама, що в brand/logo/logo.svg — міняти обидва разом.
 * Кольори з токенів, а не зашиті: ember у темній темі світлішає, і білі
 * сходинки на ньому втратили б контраст. --ember-ink саме для цього і є.
 */
function Logomark() {
  return (
    <svg viewBox="0 0 512 512" width="22" height="22" aria-hidden="true" className="shrink-0">
      <rect width="512" height="512" rx="96" fill="var(--ember)" />
      <path d="M118 386V302h84v-84h84v-84" fill="none" stroke="var(--ember-ink)"
            strokeWidth="48" strokeLinecap="square" />
      <rect x="328" y="92" width="84" height="84" fill="var(--ember-ink)" />
    </svg>
  );
}

export default async function Nav({ locale }: { locale: Locale }) {
  const user = await currentUser();
  const theme = (await cookies()).get("nr_theme")?.value ?? "system";
  const dim = "var(--muted)";

  return (
    <header className="topbar">
      {/* Переноситься на два рядки, коли не вміщається. Виміряно: без цього
          шапці потрібно 590px, а на iPhone є 390 — переповнення 200px, і це
          ще для незалогіненого. Меню-гамбургер тут зайвий: посилань мало,
          два рядки чесніші за приховану кнопку. */}
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 sm:flex-nowrap sm:px-6 sm:py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logomark />
          <span className="flex items-baseline gap-2.5">
            <span className="display text-lg">NextRole</span>
            <span className="eyebrow hidden sm:inline" style={{ color: dim }}>
              {t(locale, "nav.strap")}
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm sm:gap-5" style={{ color: dim }}>
          <form action={switchLocale} className="flex gap-2">
            {LOCALES.map((l) => (
              <button key={l.id} name="locale" value={l.id} type="submit"
                className="pick mono text-xs uppercase"
                data-on={l.id === locale}
                aria-pressed={l.id === locale}
                title={l.name} aria-label={l.name}>
                {l.id}
              </button>
            ))}
          </form>

          <form action={switchTheme} className="flex items-center gap-1">
            {THEMES.map((th) => (
              <button key={th.id} name="theme" value={th.id === "system" ? "" : th.id}
                type="submit" title={t(locale, th.key)} aria-label={t(locale, th.key)}
                className="pick flex h-6 w-6 items-center justify-center"
                data-on={th.id === theme}
                aria-pressed={th.id === theme}>
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
              <Link href="/profile" className="hover:opacity-70">{t(locale, "nav.profile")}</Link>
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
