import { reviveSource, toggleBoard, toggleBoardGroup } from "./actions";
import { FAMILY_WORD, STATE, num } from "./vocab";

/**
 * Три таблиці панелі: дошки, стрічка людей, джерела. Кожна довга, кожна про
 * своє, і жодна не потрібна решті сторінки.
 */

/**
 * Один розділ таблиці джерел.
 *
 * Винесено в компонент, бо розділів два — загальні й регіональні, — і вони
 * мусять виглядати однаково: різниця між ними в тому, КОМУ видно вакансію,
 * а не в тому, як її показувати власникові.
 */
export interface BoardRow {
  id: string; country: string; label: string; enabled: number;
  status: string | null; jobs_last_run: number | null;
}
export interface BoardGroup { country: string; name: string; rows: BoardRow[] }

/**
 * Дошки однією таблицею. Викликається двічі — і в цьому вся правка.
 *
 * Раніше глобальні дошки й національні стояли впереміш, відрізняючись лише
 * зірочкою в першому стовпчику. Це два різні питання: «чим ми накриваємо всіх»
 * і «чи є дошка під країну, з якої в нас є людина». Відповідь на друге
 * доводилось видобувати очима зі списку, відсортованого не за тим.
 */
export function BoardTable({ groups, title }: { groups: BoardGroup[]; title: string }) {
  if (groups.length === 0) return null;
  const live = groups.filter((g) => g.rows.some((r) => r.enabled === 1)).length;
  return (
    <div className="card mt-3 overflow-x-auto px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="eyebrow">{title} · {groups.length}</h4>
        <span className="mono text-xs" style={{ color: "var(--muted)" }}>
          увімкнено {live}
        </span>
      </div>
      <table className="board mt-3">
        <thead>
          <tr><th>країна</th><th>дошка</th><th>стан</th><th className="num">рубрик</th>
              <th className="num">вакансій</th><th /></tr>
        </thead>
        <tbody>
{groups.map((g) => {
                      const on = g.rows.filter((r) => r.enabled === 1).length;
                      const jobs = g.rows.reduce((n, r) => n + (r.jobs_last_run ?? 0), 0);
                      const bad = g.rows.filter((r) => r.status === "deprecated").length;
                      const soso = g.rows.filter((r) => r.status === "degraded").length;
                      return (
                        <tr key={`${g.country}|${g.name}`}>
                          <td className="mono text-xs"
                              style={{ color: g.country === "*" ? "var(--muted)" : undefined }}>
                            {g.country === "*" ? "усі" : g.country}
                          </td>
                          <td className="text-xs">
                            {g.rows.length > 1 ? (
                              <details>
                                <summary style={{ cursor: "pointer" }}>{g.name}</summary>
                                <div className="mono mt-2 text-xs" style={{ color: "var(--muted)" }}>
                                  {g.rows.map((r) => (
                                    <div key={r.id} className="flex items-center justify-between gap-4 py-0.5">
                                      <span>{r.label.split(" · ")[1] ?? r.label}</span>
                                      <span>{r.jobs_last_run ?? "—"}</span>
                                      <form action={toggleBoard}>
                                        <input type="hidden" name="id" value={r.id} />
                                        <button className="mono text-xs hover:underline"
                                                style={{ color: "var(--ember)" }}>
                                          {r.enabled === 0 ? "увімкнути" : "вимкнути"}
                                        </button>
                                      </form>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ) : g.name}
                          </td>
                          <td>
                            <span className={`tag ${on === 0 ? "tag-flat" : bad > 0 ? "tag-bad"
                              : soso > 0 ? "tag-warn" : "tag-ok"}`}>
                              {on === 0 ? "вимкнено" : bad > 0 ? `мертвих ${bad}`
                                : soso > 0 ? `збоїть ${soso}` : "працює"}
                            </span>
                          </td>
                          <td className="num text-xs">{on === g.rows.length ? g.rows.length : `${on} / ${g.rows.length}`}</td>
                          <td className="num text-xs">{jobs || "—"}</td>
                          <td className="text-right">
                            <form action={toggleBoardGroup}>
                              <input type="hidden" name="country" value={g.country} />
                              <input type="hidden" name="board" value={g.name} />
                              <button className="mono text-xs hover:underline" style={{ color: "var(--ember)" }}>
                                {on === 0 ? "увімкнути всі" : "вимкнути всі"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
        </tbody>
      </table>
    </div>
  );
}

export function FeedTable({ rows, title }: {
  rows: Array<{ source: string; label: string; family: string; country: string | null;
                jobs: number; fresh: number; status: string | null; parts: number }>;
  title: string;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.jobs, 0);
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="eyebrow">{title} · {rows.length}</h4>
        <span className="mono text-xs" style={{ color: "var(--muted)" }}>
          {num(total)} вакансій
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="board">
          <thead>
            <tr><th>джерело</th><th>рід</th><th>кому</th><th>стан</th>
                <th className="num">у кеші</th><th className="num">за 3 дні</th></tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const st = f.status === "off"
                ? { tag: "tag-flat", text: "вимкнено" }
                : f.status && f.status in STATE
                  ? STATE[f.status as keyof typeof STATE]
                  : null;
              // Порожнє джерело — не «свіжих нуль», а «не дало нічого взагалі».
              // Це різні хвороби, і без окремого кольору такий рядок губиться
              // серед просто несвіжих.
              const colour = f.jobs === 0 ? "var(--bad)"
                           : f.fresh > 0 ? "var(--ok)" : "var(--warn)";
              return (
                <tr key={`${f.family}-${f.country}-${f.label}`} className="stripe"
                    style={{ "--c": colour } as React.CSSProperties}>
                  <td className="mono text-xs" title={f.source}>
                    {f.label}
                    {f.parts > 1 && (
                      <span style={{ color: "var(--muted)" }}> · {f.parts} рубрик</span>
                    )}
                  </td>
                  <td className="text-xs" style={{ color: "var(--muted)" }}>
                    {FAMILY_WORD[f.family] ?? f.family}
                  </td>
                  <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                    {f.country && f.country !== "*" ? f.country : "всім"}
                  </td>
                  <td className="text-xs">
                    {st ? <span className={`tag ${st.tag}`}>{st.text}</span>
                        : <span className="tag tag-flat">не міряли</span>}
                  </td>
                  <td className="num text-xs"
                      style={{ color: f.jobs === 0 ? "var(--bad)" : undefined }}>
                    {f.jobs === 0 ? "нуль" : num(f.jobs)}
                  </td>
                  <td className="num text-xs"
                      style={{ color: f.fresh > 0 ? undefined : "var(--muted)" }}>
                    {f.fresh || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Скільки ролей обрала людина. Порожній JSON — анкети ще немає. */
export const sphereCount = (raw: string | null): number => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
};

export function SourceTable({ rows, total }: {
  rows: Array<{ source_name: string; status: string; consecutive_fail_days: number; last_error: string | null }>;
  total: number;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="board">
        <thead>
          <tr><th>джерело</th><th>стан</th><th>днів</th><th>остання помилка</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const st = STATE[x.status as keyof typeof STATE] ?? STATE.degraded;
            return (
              <tr key={x.source_name} className="stripe" style={{ "--c": st.c } as React.CSSProperties}>
                <td className="mono text-xs">{x.source_name}</td>
                <td><span className={`tag ${st.tag}`}>{st.text}</span></td>
                <td className="num text-xs">{x.consecutive_fail_days}</td>
                <td className="text-xs" style={{ color: "var(--muted)" }}>{x.last_error?.slice(0, 80) ?? "—"}</td>
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
      {total > rows.length && (
        <p className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
          Показано {rows.length} із {total}. Решта така сама.
        </p>
      )}
    </div>
  );
}
