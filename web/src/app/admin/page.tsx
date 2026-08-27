import { redirect } from "next/navigation";
import Nav from "../nav";
import { detectLocale } from "../actions";
import { addCompany, checkSource, reviveSource, saveSourceKey } from "./actions";
import { currentUser } from "@/lib/auth";
import { all, one } from "@/lib/db";

const KEYED_SOURCES = ["adzuna", "reed", "jooble", "usajobs", "findwork"];

const chip = (status: string): { text: string; color: string } =>
  status === "ok" ? { text: "працює", color: "var(--ok)" }
  : status === "degraded" ? { text: "збоїть", color: "var(--warn)" }
  : { text: "мертве", color: "var(--bad)" };

export default async function Admin() {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const stats = await one<{ jobs: number; companies: number; sources: number; users: number; degraded: number }>(`
    SELECT (SELECT COUNT(*) FROM jobs_cache) jobs,
           (SELECT COUNT(DISTINCT company_key) FROM jobs_cache) companies,
           (SELECT COUNT(*) FROM companies) sources,
           (SELECT COUNT(*) FROM users WHERE status='active') users,
           (SELECT COUNT(*) FROM sources_state WHERE status!='ok') degraded`);

  const sources = await all<{ source_name: string; status: string; last_ok_at: string | null;
    consecutive_fail_days: number; last_error: string | null; jobs_last_run: number }>(
    `SELECT * FROM sources_state ORDER BY CASE status WHEN 'deprecated' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
       jobs_last_run DESC LIMIT 80`);

  const runs = await all<{ id: string; started_at: string; distinct_companies: number;
    jobs_found: number; ladder_reached: string | null; status: string; notes: string | null }>(
    "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 8");

  const keys = await all<{ source_name: string }>("SELECT source_name FROM source_keys");
  const hasKey = new Set(keys.map((k) => k.source_name));

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Панель власника</h1>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[["вакансій", stats?.jobs], ["компаній", stats?.companies], ["джерел", stats?.sources],
            ["людей", stats?.users], ["зламано", stats?.degraded]].map(([l, v]) => (
            <div key={String(l)} className="card px-4 py-3">
              <div className="text-xl font-semibold tabular-nums">{String(v ?? 0)}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>{String(l)}</div>
            </div>
          ))}
        </div>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Стан джерел</h2>
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="px-4 py-2 text-left font-normal">джерело</th>
                  <th className="px-4 py-2 text-left font-normal">стан</th>
                  <th className="px-4 py-2 text-right font-normal">дало</th>
                  <th className="px-4 py-2 text-left font-normal">остання помилка</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const c = chip(s.status);
                  return (
                    <tr key={s.source_name} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-4 py-2 font-mono text-xs">{s.source_name}</td>
                      <td className="px-4 py-2" style={{ color: c.color }}>
                        {c.text}{s.consecutive_fail_days > 0 && ` (${s.consecutive_fail_days} дн.)`}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.jobs_last_run}</td>
                      <td className="px-4 py-2 text-xs" style={{ color: "var(--muted)" }}>
                        {s.last_error?.slice(0, 70) ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {s.status !== "ok" && (
                          <form action={reviveSource}>
                            <input type="hidden" name="source" value={s.source_name} />
                            <button className="text-xs underline" style={{ color: "var(--muted)" }}>воскресити</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">Ключі доступу</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Вставив токен — джерело оживає без деплою.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {KEYED_SOURCES.map((s) => (
                <form key={s} action={saveSourceKey} className="flex items-center gap-2">
                  <input type="hidden" name="source" value={s} />
                  <span className="w-24 font-mono text-xs">{s}</span>
                  <input name="key" className="field flex-1 text-xs"
                    placeholder={hasKey.has(s) ? "•••••• збережено" : "вставити ключ"} />
                  <button className="btn btn-ghost text-xs">ok</button>
                </form>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold">Додати компанію</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Слаг у її ATS. Провайдер можна лишити порожнім — скан визначить сам.
            </p>
            <form action={addCompany} className="mt-4 flex flex-col gap-2">
              <input name="slug" className="field text-sm" placeholder="slug у ATS, напр. deepl" required />
              <input name="name" className="field text-sm" placeholder="Назва компанії" />
              <select name="provider" className="field text-sm" defaultValue="">
                <option value="">визначити автоматично</option>
                {["greenhouse","lever","ashby","workable","smartrecruiters","breezy","personio","rippling"].map((p) =>
                  <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="btn self-start text-sm">Додати</button>
            </form>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Історія прогонів</h2>
          <div className="mt-4 flex flex-col gap-3">
            {runs.map((r) => (
              <details key={r.id} className="card px-4 py-3 text-sm">
                <summary className="cursor-pointer">
                  <span className="font-mono text-xs">{r.started_at.slice(0, 16).replace("T", " ")}</span>
                  {" — "}{r.distinct_companies} компаній, {r.jobs_found} вакансій, до {r.ladder_reached ?? "—"}
                  <span style={{ color: r.status === "ok" ? "var(--ok)" : "var(--warn)" }}> · {r.status}</span>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap text-xs" style={{ color: "var(--ink-2)" }}>
                  {r.notes ?? "—"}
                </pre>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
