import Shell from "../shell";
import Footer from "../footer";
import { detectLocale } from "../actions";
import { all, one } from "@/lib/db";
import { t } from "@/lib/i18n";

export const revalidate = 3600;

/**
 * Публічна сторінка джерел.
 *
 * Це не маркетинг, а зобов'язання: умови Remote OK і Remotive прямо вимагають
 * згадки назви й посилання, що індексується. Без цього вони ріжуть доступ до API.
 */
const ATTRIBUTED = [
  { name: "Remote OK", url: "https://remoteok.com", note: "remote-вакансії" },
  { name: "Remotive", url: "https://remotive.com", note: "remote-вакансії" },
  { name: "Arbeitnow", url: "https://www.arbeitnow.com", note: "Європа" },
  { name: "Jobicy", url: "https://jobicy.com", note: "remote, фільтри по гео" },
  { name: "Himalayas", url: "https://himalayas.app", note: "remote" },
  { name: "Working Nomads", url: "https://www.workingnomads.com", note: "remote" },
  { name: "Landing.jobs", url: "https://landing.jobs", note: "Європа, IT" },
  { name: "The Muse", url: "https://www.themuse.com", note: "США та світ" },
  { name: "We Work Remotely", url: "https://weworkremotely.com", note: "remote" },
  { name: "Jobspresso", url: "https://jobspresso.co", note: "remote" },
  { name: "NoDesk", url: "https://nodesk.co", note: "remote" },
  { name: "Cryptocurrency Jobs", url: "https://cryptocurrencyjobs.co", note: "web3" },
  { name: "Hacker News «Who is hiring»", url: "https://news.ycombinator.com", note: "щомісячний тред" },
  { name: "Getro", url: "https://getro.com", note: "борди екосистем фондів" },
];

export default async function Sources() {
  const locale = await detectLocale();

  const stats = await one<{ sources: number; withAts: number }>(
    `SELECT COUNT(*) sources, COUNT(ats_provider) withAts FROM companies c
      WHERE NOT EXISTS (
        SELECT 1 FROM sources_state s
         WHERE s.source_name = c.ats_provider || ':' || c.ats_slug
           AND s.status = 'deprecated')`).catch(() => null);

  const providers = await all<{ ats_provider: string; n: number }>(
    "SELECT ats_provider, COUNT(*) n FROM companies WHERE ats_provider IS NOT NULL GROUP BY ats_provider ORDER BY n DESC"
  ).catch(() => []);

  return (
    <>
      <Shell locale={locale} eyebrow={t(locale, "nav.sources")} title={t(locale, "sources.title")}
             lede={t(locale, "sources.lede")} width="wide">
        <section>
          <h2 className="display text-xl">{t(locale, "sources.direct")}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "sources.directLede")}</p>
          {stats && (
            <p className="mono mt-4 text-sm" style={{ color: "var(--ember)" }}>
              {stats.withAts} / {stats.sources}
            </p>
          )}
          <div className="card mt-4 overflow-x-auto">
            <table className="board">
              <thead><tr><th>{t(locale, "sources.provider")}</th><th className="num">{t(locale, "sources.count")}</th></tr></thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.ats_provider}>
                    <td className="mono text-xs">{p.ats_provider}</td>
                    <td className="num">{p.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="display text-xl">{t(locale, "sources.boards")}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "sources.boardsLede")}</p>
          <ul className="ruled card mt-4">
            {ATTRIBUTED.map((s) => (
              <li key={s.name} className="flex flex-wrap items-baseline justify-between gap-3 px-6 py-4">
                {/* rel без nofollow — умови Remote OK вимагають саме посилання, що йде за собою */}
                <a href={s.url} target="_blank" rel="noopener" className="link font-medium">{s.name}</a>
                <span className="text-sm" style={{ color: "var(--muted)" }}>{s.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="display text-xl">{t(locale, "sources.rules")}</h2>
          <ul className="ruled card mt-4">
            {[1, 2, 3, 4].map((n) => (
              <li key={n} className="px-6 py-4 text-sm" style={{ color: "var(--ink-2)" }}>
                {t(locale, `sources.rule${n}`)}
              </li>
            ))}
          </ul>
        </section>
      </Shell>
      <Footer locale={locale} />
    </>
  );
}
