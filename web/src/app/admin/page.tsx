import { redirect } from "next/navigation";
import Nav from "../nav";
import { detectLocale } from "../actions";
import { addCompany, reviveSource, saveSourceKey } from "./actions";
import { currentUser } from "@/lib/auth";
import { all, one } from "@/lib/db";

// Ключі зберігаються, але жодне з цих джерел ще не написане в сканері:
// getSourceKey існує й нікого не викликає. Поки так — кажемо про це прямо,
// а не вдаємо, що вставлений токен щось вмикає.
const KEYED = [
  { id: "adzuna",   opens: "16 країн, значна частина інвентарю Indeed", where: "developer.adzuna.com" },
  { id: "reed",     opens: "британський ринок",                          where: "reed.co.uk/developers" },
  { id: "jooble",   opens: "70+ країн",                                  where: "jooble.org/api/about — ключ дають листом" },
  { id: "usajobs",  opens: "держсектор США",                             where: "developer.usajobs.gov" },
  { id: "findwork", opens: "IT-специфічний",                             where: "findwork.dev/developers" },
];

const STATE = {
  ok:         { tag: "tag-ok",   c: "var(--ok)",   text: "працює" },
  degraded:   { tag: "tag-warn", c: "var(--warn)", text: "збоїть" },
  deprecated: { tag: "tag-bad",  c: "var(--bad)",  text: "мертве" },
} as const;

function Tile({ n, label, accent = false }: { n: number | string; label: string; accent?: boolean }) {
  return (
    <div className="card px-5 py-4">
      <div className="mono text-2xl leading-none" style={{ color: accent ? "var(--bad)" : "var(--ember)" }}>
        {typeof n === "number" ? n.toLocaleString("uk-UA") : n}
      </div>
      <div className="eyebrow mt-2">{label}</div>
    </div>
  );
}

export default async function Admin() {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const s = await one<{ jobs: number; companies: number; sources: number; withAts: number;
    users: number; paused: number; broken: number; sent: number }>(`
    SELECT (SELECT COUNT(*) FROM jobs_cache) jobs,
           (SELECT COUNT(DISTINCT company_key) FROM jobs_cache) companies,
           (SELECT COUNT(*) FROM companies) sources,
           (SELECT COUNT(*) FROM companies WHERE ats_provider IS NOT NULL) withAts,
           (SELECT COUNT(*) FROM users WHERE status='active') users,
           (SELECT COUNT(*) FROM users WHERE status='paused') paused,
           (SELECT COUNT(*) FROM sources_state WHERE status!='ok') broken,
           (SELECT COUNT(*) FROM sent WHERE status='sent') sent`);

  const sources = await all<{ source_name: string; status: string; last_ok_at: string | null;
    consecutive_fail_days: number; last_error: string | null; jobs_last_run: number }>(
    `SELECT * FROM sources_state
     ORDER BY CASE status WHEN 'deprecated' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
              jobs_last_run DESC LIMIT 120`);

  const runs = await all<{ id: string; started_at: string; distinct_companies: number; jobs_found: number;
    ladder_reached: string | null; status: string; notes: string | null }>(
    "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 10");

  const keys = new Set((await all<{ source_name: string }>("SELECT source_name FROM source_keys"))
    .map((k) => k.source_name));

  const feedback = await all<{ id: string; user_id: string | null; contact: string | null;
    locale: string; page: string | null; message: string; created_at: string }>(
    "SELECT * FROM site_feedback WHERE handled_at IS NULL ORDER BY created_at DESC LIMIT 30");

  const peak = Math.max(1, ...sources.map((x) => x.jobs_last_run));
  const broken = sources.filter((x) => x.status !== "ok");

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <p className="eyebrow">Панель власника</p>
        <h1 className="display mt-2 text-3xl">Стан системи</h1>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Tile n={s?.jobs ?? 0} label="вакансій" />
          <Tile n={s?.companies ?? 0} label="компаній" />
          <Tile n={s?.sources ?? 0} label="джерел" />
          <Tile n={s?.withAts ?? 0} label="з ATS" />
          <Tile n={s?.users ?? 0} label="активних" />
          <Tile n={s?.sent ?? 0} label="надіслано" />
          <Tile n={s?.broken ?? 0} label="зламано" accent={(s?.broken ?? 0) > 0} />
        </div>

        {feedback.length > 0 && (
          <section className="mt-12">
            <h2 className="display text-xl">Відгуки людей</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Написане своїми словами. Кожен уже прилетів у Telegram — тут він лежить, щоб не загубитись.
            </p>
            <div className="ruled card mt-4">
              {feedback.map((f) => (
                <article key={f.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="mono text-xs" style={{ color: "var(--ember)" }}>
                      {f.created_at.slice(0, 16).replace("T", " ")}
                    </span>
                    <span className="eyebrow">{f.locale}</span>
                    <span className="eyebrow">{f.user_id ? f.user_id.slice(0, 8) : "без акаунту"}</span>
                    {f.contact && <span className="mono text-xs">{f.contact}</span>}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm" style={{ color: "var(--ink)" }}>
                    {f.message}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        {broken.length > 0 && (
          <section className="mt-12">
            <h2 className="display text-xl">Потребує уваги</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Джерело, недоступне два дні поспіль, помирає само. Якщо воно живе — воскреси.
            </p>
            <div className="card mt-4 overflow-x-auto">
              <table className="board">
                <thead>
                  <tr><th>джерело</th><th>стан</th><th>днів</th><th>остання помилка</th><th /></tr>
                </thead>
                <tbody>
                  {broken.map((x) => {
                    const st = STATE[x.status as keyof typeof STATE] ?? STATE.degraded;
                    return (
                      <tr key={x.source_name} className="stripe" style={{ "--c": st.c } as React.CSSProperties}>
                        <td className="mono text-xs">{x.source_name}</td>
                        <td><span className={`tag ${st.tag}`}>{st.text}</span></td>
                        <td className="num text-xs">{x.consecutive_fail_days}</td>
                        <td className="text-xs" style={{ color: "var(--muted)" }}>
                          {x.last_error?.slice(0, 80) ?? "—"}
                        </td>
                        <td className="text-right">
                          <form action={reviveSource}>
                            <input type="hidden" name="source" value={x.source_name} />
                            <button className="mono text-xs hover:underline" style={{ color: "var(--ember)" }}>
                              воскресити
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-12">
          <h2 className="display text-xl">Усі джерела</h2>
          <div className="card mt-4 overflow-x-auto">
            <table className="board">
              <thead>
                <tr><th>джерело</th><th>стан</th><th className="num">дало</th><th>обсяг</th><th>остання вдала</th></tr>
              </thead>
              <tbody>
                {sources.map((x) => {
                  const st = STATE[x.status as keyof typeof STATE] ?? STATE.ok;
                  return (
                    <tr key={x.source_name} className="stripe" style={{ "--c": st.c } as React.CSSProperties}>
                      <td className="mono text-xs">{x.source_name}</td>
                      <td><span className={`tag ${st.tag}`}>{st.text}</span></td>
                      <td className="num text-xs">{x.jobs_last_run}</td>
                      <td style={{ width: "34%" }}>
                        {/* Смужка обсягу: видно внесок джерела, не читаючи цифру */}
                        <div style={{ height: 6, background: "var(--surface-2)" }}>
                          <div style={{
                            height: 6,
                            width: `${Math.round((x.jobs_last_run / peak) * 100)}%`,
                            background: x.jobs_last_run > 0 ? "var(--ember)" : "transparent",
                          }} />
                        </div>
                      </td>
                      <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                        {x.last_ok_at?.slice(0, 16).replace("T", " ") ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <section>
            <h2 className="display text-xl">Ключі доступу</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Ключ зберігається тут, але жодне з цих джерел ще не під&apos;єднане до сканера.
              Вставлений токен поки нічого не вмикає — під кожне потрібен свій розбирач,
              і писати його наосліп, без справжньої відповіді API, немає сенсу.
            </p>
            <div className="ruled card mt-4">
              {KEYED.map((k) => (
                <form key={k.id} action={saveSourceKey} className="flex items-center gap-3 px-5 py-4">
                  <input type="hidden" name="source" value={k.id} />
                  <div className="w-28 shrink-0">
                    <div className="mono text-xs">{k.id}</div>
                    {keys.has(k.id)
                      ? <span className="tag tag-warn mt-1 inline-block">ключ є, джерела нема</span>
                      : <span className="tag tag-flat mt-1 inline-block">{k.where}</span>}
                  </div>
                  <input name="key" className="field mono flex-1 text-xs"
                    placeholder={keys.has(k.id) ? "замінити" : k.opens} />
                  <button className="btn btn-quiet shrink-0 px-3 py-2 text-xs">ok</button>
                </form>
              ))}
            </div>
          </section>

          <section>
            <h2 className="display text-xl">Додати компанію</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Слаг у її ATS. Провайдера можна не вказувати — скан визначить сам.
            </p>
            <form action={addCompany} className="card mt-4 flex flex-col gap-3 px-5 py-5">
              <input name="slug" className="field mono text-sm" placeholder="slug, напр. deepl" required />
              <input name="name" className="field text-sm" placeholder="Назва компанії" />
              <select name="provider" className="field mono text-sm" defaultValue="">
                <option value="">визначити автоматично</option>
                {["greenhouse","lever","ashby","workable","smartrecruiters","breezy","personio","rippling"]
                  .map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="btn self-start">Додати</button>
            </form>
          </section>
        </div>

        <section className="mt-12">
          <h2 className="display text-xl">Історія прогонів</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Кожен прогін лишає доказ роботи: що пройдено й що було недоступне.
          </p>
          <div className="ruled card mt-4">
            {runs.map((r) => (
              <details key={r.id} className="px-5 py-4">
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 text-sm">
                  <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                    {r.started_at.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="mono">{r.distinct_companies}</span>
                  <span className="eyebrow">компаній</span>
                  <span className="mono">{r.jobs_found}</span>
                  <span className="eyebrow">вакансій</span>
                  <span className="mono text-xs" style={{ color: "var(--ember)" }}>{r.ladder_reached ?? "—"}</span>
                  <span className={`tag ${r.status === "ok" ? "tag-ok" : r.status === "failed" ? "tag-bad" : "tag-warn"}`}>
                    {r.status}
                  </span>
                </summary>
                <pre className="mono mt-4 overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed"
                     style={{ color: "var(--ink-2)" }}>{r.notes ?? "—"}</pre>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
