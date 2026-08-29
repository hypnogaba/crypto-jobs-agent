import { getCloudflareContext } from "@opennextjs/cloudflare";
import Nav from "./nav";
import Footer from "./footer";
import { detectLocale, startOnboarding } from "./actions";
import { all, one } from "@/lib/db";
import { t } from "@/lib/i18n";

type FeedRow = {
  company: string;
  title: string;
  location: string | null;
  remote: number;
  salary_min: number | null;
  salary_currency: string | null;
  url: string;
};

/**
 * Найсвіжіше з кешу.
 *
 * Два вкладені проходи, а не один. Якщо ранжувати по компанії до того, як
 * схлопнуто геоклони, компанія, у якої двоє найновіших рядків — клони одного
 * оголошення, вилітає зі списку цілком.
 *
 * Вікно «-3 доби» — усталене визначення живої вакансії в цьому проєкті:
 * так само рахує /admin і так само добирає кандидатів сканер. Кеш нічого не
 * видаляє, тож свіжість — це вікно, а не DELETE. Індекс idx_jobs_fetched є.
 */
const FEED_SQL = `
  SELECT company, title, location, remote, salary_min, salary_currency, url
  FROM (
    SELECT company, title, location, remote, salary_min, salary_currency, url,
           posted_at, fetched_at,
           ROW_NUMBER() OVER (PARTITION BY company_key
                              ORDER BY posted_at DESC, fetched_at DESC) per_company
    FROM (
      SELECT company, company_key, title, location, remote, salary_min,
             salary_currency, url, posted_at, fetched_at,
             ROW_NUMBER() OVER (PARTITION BY dedupe_key
                                ORDER BY posted_at DESC, fetched_at DESC) dup
      FROM jobs_cache
      WHERE fetched_at >= datetime('now', '-3 day')
    )
    WHERE dup = 1
  )
  WHERE per_company <= 2
  ORDER BY posted_at DESC, fetched_at DESC
  LIMIT 10`;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;
  const intl = locale === "en" ? "en-GB" : locale;
  const num = (n: number) => Number(n).toLocaleString(intl);

  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  const bot = env.TELEGRAM_BOT_USERNAME ?? "mynextrole_bot";

  // Живі числа — доказ, що система працює просто зараз
  const stats = await one<{ jobs: number; companies: number; sources: number }>(`
    SELECT (SELECT COUNT(*) FROM jobs_cache) jobs,
           (SELECT COUNT(DISTINCT company_key) FROM jobs_cache) companies,
           -- Рахуємо лише ті джерела, які справді опитуються. Мертві
           -- лишаються в таблиці як історія, але обіцяти їх людині нечесно.
           (SELECT COUNT(*) FROM companies c
              WHERE NOT EXISTS (
                SELECT 1 FROM sources_state s
                 WHERE s.source_name = c.ats_provider || ':' || c.ats_slug
                   AND s.status = 'deprecated')) sources`).catch(() => null);

  const feed = await all<FeedRow>(FEED_SQL).catch(() => [] as FeedRow[]);

  const place = (j: FeedRow) =>
    j.location ?? (j.remote ? t(locale, "feed.remote") : t(locale, "tg.noLocation"));
  const money = (j: FeedRow) =>
    j.salary_min ? `${num(j.salary_min)} ${j.salary_currency ?? ""}`.trim() : t(locale, "tg.noSalary");

  const steps = [1, 2, 3, 4].map((n) => ({
    n, title: t(locale, `home.step${n}`), body: t(locale, `home.step${n}d`),
  }));

  // Порядок — за годинником, і остання клітинка та, яку людина справді бачить.
  // Сторож стоїть перед доставкою навмисно: його робота — дібрати вакансій,
  // якщо день вийшов пісним, а після 09:00 добирати вже нема сенсу.
  const clock = [
    { hour: "05:00", title: t(locale, "home.scan"),    body: t(locale, "home.scand") },
    { hour: "06:00", title: t(locale, "home.match"),   body: t(locale, "home.matchd") },
    { hour: "08:00", title: t(locale, "home.check"),   body: t(locale, "home.checkd") },
    { hour: "09:00", title: t(locale, "home.deliver"), body: t(locale, "home.deliverd") },
  ];

  // Макет цитує справжні відкриті ролі з того самого запиту — жодних вигаданих.
  const mock = feed.slice(0, 2);

  return (
    <>
      <Nav locale={locale} />

      {/* ══ ГЕРОЙ ══ Ліворуч — єдина дія. Праворуч — доказ, що є з чого обирати. */}
      <section className="scanfield">
        <div className="mx-auto grid w-full max-w-5xl gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1fr_380px] lg:gap-12 sm:pt-24">
          {/* min-w-0 на обох колонках обов'язковий: у стрічці рядки з nowrap,
              і без нього grid-колонка росте до найдовшого з них — на телефоні
              вся сторінка ставала ширшою за екран. */}
          <div className="min-w-0">
            <p className="eyebrow rise rise-1">{t(locale, "tagline")}</p>

            <h1 className="display display-xl rise rise-2 mt-6 text-4xl sm:text-6xl lg:text-7xl">
              {t(locale, "home.h1a")}
              <br />
              <span style={{ color: "var(--ember)" }}>{t(locale, "home.h1b")}</span>
            </h1>

            <p className="lede rise rise-3 mt-7">{t(locale, "home.lede")}</p>

            {/* Єдина дія на сторінці — написати одне речення. Тому це рядок,
                а не анкета: скріпка і стрілка всередині, решта нижче й тихо. */}
            <form action={startOnboarding} className="rise rise-4 mt-10 max-w-2xl">
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
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
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
            </form>
          </div>

          {/* ── Жива стрічка ──────────────────────────────────────────────
              Не хвалько-лічильник, а вітрина: людина бачить, що саме лежить
              у кеші, ще до того, як щось про себе розповість. */}
          <aside className="rise rise-5 card min-w-0 self-start px-5 py-5">
            {stats && (
              <>
                <p className="mono text-3xl" style={{ color: "var(--ink)" }}>{num(stats.jobs)}</p>
                <p className="eyebrow mt-1">{t(locale, "home.nJobs")}</p>
              </>
            )}

            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--rule)" }}>
              <p className="eyebrow flex items-center gap-2">
                <span className={feed.length ? "live-dot" : "live-dot live-dot-still"} aria-hidden="true" />
                {t(locale, "feed.eyebrow")}
              </p>

              {feed.length > 0 ? (
                <div className="feed-window mt-3">
                  <div className="feed-scroll">
                    {/* Список двічі: друга копія — це те, що видно на стику,
                        коли перша доповзає догори. Прихована від читалок,
                        щоб вони не зачитували все двічі. */}
                    {[0, 1].map((pass) => (
                      <ol className="feed" key={pass} aria-hidden={pass === 1 || undefined}>
                        {feed.map((j, i) => (
                          <li key={`${pass}-${j.company}-${j.title}-${i}`}
                              style={{ "--i": pass === 0 ? i : 0 } as React.CSSProperties}>
                            <span className="row">
                              <span className="co">{j.company}</span>
                              <span className="sep" aria-hidden="true"> · </span>
                              {j.title}
                            </span>
                            <span className="loc">{place(j)}</span>
                          </li>
                        ))}
                      </ol>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mono mt-4 px-1 pb-3 text-[13px]" style={{ color: "var(--faint)" }}>
                  {t(locale, "feed.quiet")}
                </p>
              )}

              <p className="eyebrow mt-2" style={{ color: "var(--faint)" }}>
                {t(locale, "feed.note")}
              </p>
            </div>

            {stats && (
              <dl className="mt-4 flex gap-8 border-t pt-4" style={{ borderColor: "var(--rule)" }}>
                {[
                  [stats.companies, t(locale, "home.nCompanies")],
                  [stats.sources, t(locale, "home.nSources")],
                ].map(([n, l]) => (
                  <div key={String(l)}>
                    <dt className="mono text-lg" style={{ color: "var(--ember)" }}>{num(Number(n))}</dt>
                    <dd className="eyebrow mt-0.5">{String(l)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </aside>
        </div>
      </section>

      {/* ══ ЯК ЦЕ ПРАЦЮЄ ══ */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <p className="eyebrow">{t(locale, "home.how")}</p>
        <div className="ruled card steplist mt-6">
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

      {/* ══ У TELEGRAM ══ Сайт обіцяє доставку в месенджер — тут він її показує.
          Верстка, а не скріншот: перекладається, чітка на retina, живе в обох
          темах. Формат дослівно з formatDigest() у сканері. */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <p className="eyebrow">{t(locale, "tg.eyebrow")}</p>
        <h2 className="display mt-4 text-3xl sm:text-4xl">{t(locale, "tg.h2")}</h2>
        <p className="lede mt-5">{t(locale, "tg.lede")}</p>

        <div className="mt-12 grid items-start gap-12 lg:grid-cols-[380px_1fr]">
          <div className="min-w-0">
            <div className="tgmock">
              <div className="tgmock-screen">
                <div className="tgmock-bar">
                  <span className="tgmock-avatar" aria-hidden="true">NR</span>
                  <span>
                    <span className="tgmock-name block">{t(locale, "brand")}</span>
                    <span className="tgmock-handle">@{bot}</span>
                  </span>
                </div>

                <div className="tgmock-body">
                  <div className="tgmock-bubble">
                    <p>{t(locale, "tg.greeting")}</p>

                    {mock.length > 0 ? mock.map((j, i) => (
                      <div key={`${j.company}-${i}`}>
                        <hr className="tgmock-rule" />
                        <p className="tgmock-jobline">
                          <b>{i + 1}</b> · <b>{j.company}</b> — {j.title}
                        </p>
                        <p className="tgmock-meta">{place(j)} · {money(j)}</p>
                        <p className="tgmock-why">
                          {t(locale, "dash.why")}: <i>{t(locale, `tg.why${(i % 5) + 1}`)}</i>
                        </p>
                        {/* У справжній добірці це посилання /go/<id>: без сирої адреси. */}
                        <p className="tgmock-url">{t(locale, "dash.apply")}</p>
                      </div>
                    )) : (
                      <>
                        <hr className="tgmock-rule" />
                        <p className="tgmock-meta">{t(locale, "feed.quiet")}</p>
                      </>
                    )}

                    <hr className="tgmock-rule" />
                    <p className="tgmock-more">{t(locale, "tg.more")}</p>
                    <p className="tgmock-stamp">
                      {t(locale, "tg.stamp")}
                      <svg width="14" height="9" viewBox="0 0 16 10" fill="none" stroke="currentColor"
                           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 5.4L4 8.5 9.6 1.5M7.4 8.2L8 8.8 15 1.5" />
                      </svg>
                    </p>
                  </div>

                  {/* Це справжня inline-клавіатура під кожною добіркою */}
                  <div className="tgmock-keys">
                    <span>{t(locale, "tg.refine")}</span>
                    <span>{t(locale, "dash.more")}</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-5 text-sm" style={{ color: "var(--faint)" }}>
              {t(locale, "tg.caption")}
            </p>
            <p className="mt-3 text-sm">
              <a href="https://t.me/nextroleinfo" target="_blank" rel="noreferrer" className="link">
                {t(locale, "channel.cta")}
              </a>
            </p>
          </div>

          <div className="ruled card steplist min-w-0">
            {[1, 2, 3].map((n) => (
              <div key={n} className="px-7 py-7">
                <h3 className="font-medium">{t(locale, `tg.p${n}`)}</h3>
                <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
                  {t(locale, `tg.p${n}d`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ ПОКИ ВИ СПИТЕ ══ */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
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
        <div className="grid gap-px sm:grid-cols-3" style={{ background: "var(--rule)", border: "1px solid var(--rule)",
                      borderRadius: "var(--r-card)", overflow: "hidden" }}>
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
