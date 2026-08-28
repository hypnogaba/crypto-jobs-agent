import Link from "next/link";
import Nav from "./nav";
import Footer from "./footer";
import { detectLocale, startOnboarding } from "./actions";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";

export const revalidate = 900;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;

  // Живі числа — доказ, що система працює просто зараз
  const stats = await one<{ jobs: number; companies: number; sources: number }>(`
    SELECT (SELECT COUNT(*) FROM jobs_cache) jobs,
           (SELECT COUNT(DISTINCT company_key) FROM jobs_cache) companies,
           (SELECT COUNT(*) FROM companies) sources`).catch(() => null);

  const steps = [1, 2, 3, 4].map((n) => ({
    n, title: t(locale, `home.step${n}`), body: t(locale, `home.step${n}d`),
  }));

  const clock = [
    { hour: "05:00", title: t(locale, "home.scan"),    body: t(locale, "home.scand") },
    { hour: "06:00", title: t(locale, "home.match"),   body: t(locale, "home.matchd") },
    { hour: "07:00", title: t(locale, "home.deliver"), body: t(locale, "home.deliverd") },
    { hour: "08:00", title: t(locale, "home.check"),   body: t(locale, "home.checkd") },
  ];

  return (
    <>
      {/* ══ НІЧ ══ Смуга лишається темною в обох темах: тут працює система */}
      <div className="night">
        <Nav locale={locale} onNight />
        <main className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-24 pt-20 sm:pt-28">
          <p className="eyebrow rise rise-1">{t(locale, "tagline")}</p>

          <h1 className="display rise rise-2 mt-6 text-5xl sm:text-7xl">
            {t(locale, "home.h1a")}
            <br />
            <span style={{ color: "var(--ember)" }}>{t(locale, "home.h1b")}</span>
          </h1>

          <p className="lede rise rise-3 mt-7" style={{ color: "var(--night-2)" }}>
            {t(locale, "home.lede")}
          </p>

          {/* Єдина дія на сторінці — написати одне речення. Тому це рядок,
              а не анкета: скріпка і стрілка всередині, решта нижче й тихо. */}
          <form action={startOnboarding} className="rise rise-4 mt-11 max-w-2xl">
            <div className="composer">
              <label htmlFor="input" className="sr-only">{t(locale, "home.field")}</label>
              <textarea
                id="input" name="input" rows={2}
                placeholder={t(locale, "home.placeholder")}
              />
              <div className="composer-bar">
                <label className="icon-btn" title={t(locale, "home.orCv")}>
                  <span className="sr-only">{t(locale, "home.orCv")}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <input type="file" name="cv" className="sr-only"
                         accept=".pdf,.txt,.md,text/plain,application/pdf" />
                </label>
                <span className="text-xs" style={{ color: "var(--night-2)" }}>
                  {t(locale, "home.cvHint")}
                </span>
                <button type="submit" className="icon-btn icon-send" aria-label={t(locale, "home.cta")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {error && (
              <p className="mt-3 text-sm" style={{ color: "var(--ember)" }}>
                {t(locale, `err.${error}`)}
              </p>
            )}
            <p className="mt-4 text-sm" style={{ color: "var(--night-2)" }}>
              {t(locale, "home.have")}{" "}
              <Link href="/login" className="link" style={{ color: "var(--night-ink)" }}>
                {t(locale, "home.login")}
              </Link>
            </p>
          </form>

          {stats && (
            <dl className="rise rise-5 mt-16 flex flex-wrap gap-x-12 gap-y-6 border-t pt-8"
                style={{ borderColor: "var(--night-rule)" }}>
              {[
                [stats.jobs, t(locale, "home.nJobs")],
                [stats.companies, t(locale, "home.nCompanies")],
                [stats.sources, t(locale, "home.nSources")],
              ].map(([n, l]) => (
                <div key={String(l)}>
                  <dt className="mono text-3xl" style={{ color: "var(--ember)" }}>
                    {Number(n).toLocaleString(locale === "en" ? "en-GB" : locale)}
                  </dt>
                  <dd className="eyebrow mt-1" style={{ color: "var(--night-2)" }}>{String(l)}</dd>
                </div>
              ))}
            </dl>
          )}
        </main>
      </div>

      {/* ══ РАНОК ══ */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <p className="eyebrow">{t(locale, "home.how")}</p>
        <div className="ruled card mt-6">
          {steps.map((s) => (
            <div key={s.n} className="grid grid-cols-[3rem_1fr] gap-5 px-6 py-6 sm:grid-cols-[4rem_1fr]">
              <span className="mono text-sm" style={{ color: "var(--ember)" }}>
                {String(s.n).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <p className="eyebrow">{t(locale, "home.night")}</p>
        <div className="clockstrip mt-6 !grid-cols-2 sm:!grid-cols-4">
          {clock.map((c) => (
            <div key={c.hour}>
              <div className="hour">{c.hour}</div>
              <h3 className="mt-3 text-sm font-medium">{c.title}</h3>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="grid gap-px sm:grid-cols-3" style={{ background: "var(--rule)", border: "1px solid var(--rule)" }}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="px-6 py-7" style={{ background: "var(--surface)" }}>
              <h3 className="display text-xl">{t(locale, `home.trust${n}`)}</h3>
              <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, `home.trust${n}d`)}</p>
            </div>
          ))}
        </div>
      </section>

      <Footer locale={locale} />
    </>
  );
}
