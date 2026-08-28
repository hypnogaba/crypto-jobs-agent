import { redirect } from "next/navigation";
import Nav from "../nav";
import { detectLocale } from "../actions";
import { addCompany, reviveSource, saveSourceKey, replyToFeedback, dismissFeedback, purgeNeverWorked, recheckSome, applyProposal, dismissProposal, applyAllProposals, addBoard, toggleBoard } from "./actions";
import { currentUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { RELEASES } from "@/lib/releases";

/**
 * Панель власника.
 *
 * Правило сторінки: усе живе в блоках, і кожен блок відповідає на одне
 * питання. Довгі списки згорнуті — вони довідник, а не панель. Те, що горить,
 * піднімається смугою вгору, бо власник відкриває цю сторінку, щоб дізнатись
 * «чи все добре», а не щоб гортати таблиці.
 */

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

const DAYS = 14;
const num = (n: number) => n.toLocaleString("uk-UA");
const day = (iso: string) => iso.slice(5).replace("-", ".");

/** Блок. Одна відповідь на одне питання, з підписом, навіщо він тут. */
function Block({ id, title, lede, right, children }: {
  id?: string; title: string; lede?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="display text-xl">{title}</h2>
        {right}
      </div>
      {lede && <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{lede}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tile({ n, label, accent = false }: { n: number | string; label: string; accent?: boolean }) {
  return (
    <div className="card px-5 py-4">
      <div className="mono text-2xl leading-none" style={{ color: accent ? "var(--bad)" : "var(--ember)" }}>
        {typeof n === "number" ? num(n) : n}
      </div>
      <div className="eyebrow mt-2">{label}</div>
    </div>
  );
}

/**
 * Стовпчики зростання. Одна величина на картку й один колір — питання тут
 * «більшає чи ні», а не «як три ряди співвідносяться». Порожній день не
 * малюється нулем: кеш не зникає від того, що скан не записав рядок, тому
 * значення тягнеться з попереднього дня.
 */
function Spark({ points, label }: { points: Array<{ d: string; v: number }>; label: string }) {
  const peak = Math.max(1, ...points.map((p) => p.v));
  const last = points.at(-1)?.v ?? 0;
  const base = points.find((p) => p.v > 0)?.v ?? 0;
  const delta = last - base;
  return (
    <div className="card px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="mono text-2xl leading-none" style={{ color: "var(--ember)" }}>{num(last)}</div>
        <div className="mono text-xs" style={{ color: delta > 0 ? "var(--ok)" : "var(--muted)" }}>
          {delta > 0 ? "+" : ""}{num(delta)} за {points.length} дн.
        </div>
      </div>
      <div className="eyebrow mt-2">{label}</div>
      <div className="spark mt-3">
        {points.map((p) => (
          <div key={p.d} className="spark-bar" title={`${p.d} · ${num(p.v)}`}
               style={{ height: `${Math.max(3, Math.round((p.v / peak) * 100))}%` }} />
        ))}
      </div>
    </div>
  );
}

function SourceTable({ rows, total }: {
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

export default async function Admin() {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const s = await one<{ jobs: number; companies: number; sources: number;
    users: number; paused: number; broken: number; sent: number;
    allUsers: number; connected: number; newToday: number; newWeek: number;
    sentToday: number; openFeedback: number; thumbsDown: number; wantedMore: number;
    liveJobs: number; liveSources: number }>(`
    SELECT (SELECT COUNT(*) FROM jobs_cache) jobs,
           (SELECT COUNT(DISTINCT company_key) FROM jobs_cache) companies,
           (SELECT COUNT(*) FROM companies) sources,
           (SELECT COUNT(*) FROM users WHERE status='active') users,
           (SELECT COUNT(*) FROM users WHERE status='paused') paused,
           (SELECT COUNT(*) FROM sources_state WHERE status!='ok') broken,
           (SELECT COUNT(*) FROM sources_state WHERE status='ok') liveSources,
           (SELECT COUNT(*) FROM sent WHERE status='sent') sent,
           (SELECT COUNT(*) FROM users) allUsers,
           (SELECT COUNT(*) FROM users WHERE telegram_chat_id IS NOT NULL) connected,
           (SELECT COUNT(*) FROM users WHERE date(created_at) = date('now')) newToday,
           (SELECT COUNT(*) FROM users WHERE date(created_at) >= date('now','-7 day')) newWeek,
           (SELECT COUNT(*) FROM sent WHERE date(created_at) = date('now')) sentToday,
           (SELECT COUNT(*) FROM site_feedback WHERE handled_at IS NULL) openFeedback,
           (SELECT COUNT(*) FROM feedback WHERE reaction='not_relevant') thumbsDown,
           (SELECT COUNT(*) FROM feedback WHERE reaction='more') wantedMore,
           (SELECT COUNT(*) FROM jobs_cache WHERE fetched_at >= datetime('now','-3 day')) liveJobs`);

  const sources = await all<{ source_name: string; status: string; last_ok_at: string | null;
    consecutive_fail_days: number; last_error: string | null; jobs_last_run: number }>(
    `SELECT * FROM sources_state
     ORDER BY CASE status WHEN 'deprecated' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
              jobs_last_run DESC LIMIT 120`);

  const lastRun = await one<{ started_at: string; status: string; jobs_found: number;
    ladder_reached: string | null; notes: string | null }>(
    "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1");

  const keys = new Set((await all<{ source_name: string }>("SELECT source_name FROM source_keys"))
    .map((k) => k.source_name));

  const proposals = await all<{ id: string; kind: string; target: string | null; title: string;
    detail: string; evidence: string | null; severity: string; created_at: string }>(
    `SELECT * FROM proposals WHERE status='open'
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at`);
  const bySeverity = (sev: string) => proposals.filter((x) => x.severity === sev);

  const feedback = await all<{ id: string; user_id: string | null; contact: string | null;
    locale: string; page: string | null; message: string; created_at: string }>(
    "SELECT * FROM site_feedback WHERE handled_at IS NULL ORDER BY created_at DESC LIMIT 30");

  // Витрати. Зараз Anthropic коштує нуль: ключа в проді немає, і обидва
  // місця виклику мовчки переходять на розбір за ключовими словами.
  const spend = await one<{ calls: number; callsWeek: number; inTok: number; outTok: number;
    failed: number; boards: number; countries: number; boardJobs: number; localJobs: number }>(`
    SELECT (SELECT COUNT(*) FROM api_usage WHERE date(at)=date('now')) calls,
           (SELECT COUNT(*) FROM api_usage WHERE at >= datetime('now','-7 day')) callsWeek,
           (SELECT COALESCE(SUM(input_tokens),0) FROM api_usage WHERE at >= datetime('now','-7 day')) inTok,
           (SELECT COALESCE(SUM(output_tokens),0) FROM api_usage WHERE at >= datetime('now','-7 day')) outTok,
           (SELECT COUNT(*) FROM api_usage WHERE ok=0 AND at >= datetime('now','-7 day')) failed,
           (SELECT COUNT(*) FROM country_boards WHERE enabled=1) boards,
           (SELECT COUNT(DISTINCT country) FROM country_boards WHERE enabled=1) countries,
           (SELECT COUNT(*) FROM jobs_cache WHERE source LIKE 'board:%') boardJobs,
           (SELECT COUNT(*) FROM jobs_cache WHERE country IS NOT NULL) localJobs`);

  const boards = await all<{ id: string; country: string; name: string; label: string;
    feed_url: string; kind: string; enabled: number; jobs_last_run: number | null; status: string | null }>(
    `SELECT b.*, s.jobs_last_run, s.status
       FROM country_boards b LEFT JOIN sources_state s ON s.source_name = b.name
      ORDER BY b.country, b.label`);

  // ── Зростання ───────────────────────────────────────────────────────────
  const scanDays = await all<{ d: string; jobs: number; companies: number }>(
    `SELECT date(started_at) d, MAX(jobs_found) jobs, MAX(distinct_companies) companies
       FROM scan_runs WHERE status='ok' AND started_at >= datetime('now', ?)
      GROUP BY d ORDER BY d`, `-${DAYS} day`);
  const signups = await all<{ d: string; n: number }>(
    "SELECT date(created_at) d, COUNT(*) n FROM users GROUP BY d ORDER BY d");
  // Скільки людей було до початку вікна — щоб лінія росла з реального рівня,
  // а не з нуля.
  const before = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM users WHERE date(created_at) < date('now', ?)",
    `-${DAYS - 1} day`))?.n ?? 0;

  // Вісь днів рахує база, а не JS: під час рендера викликати Date.now() не
  // можна — React вимагає, щоб рендер був чистим, і лінтер це ловить.
  const axis = (await all<{ d: string }>(
    `WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT date('now', '-' || n || ' day') d FROM seq ORDER BY d`, DAYS - 1)).map((x) => x.d);
  // Порожній день тягне значення попереднього: скан, що не записав рядок, не
  // означає, що кеш спорожнів. Малювати там нуль було б неправдою.
  const carry = (get: (d: string) => number | undefined) => {
    let prev = 0;
    return axis.map((d) => ({ d, v: (prev = get(d) ?? prev) }));
  };
  const growth = {
    jobs: carry((d) => scanDays.find((x) => x.d === d)?.jobs),
    companies: carry((d) => scanDays.find((x) => x.d === d)?.companies),
    // Накопичення рахується від рівня на початок вікна: людей не меншає.
    people: axis.map((d) => ({
      d,
      v: before + signups.filter((x) => x.d >= axis[0] && x.d <= d).reduce((a, x) => a + x.n, 0),
    })),
  };

  // ── Історія зводок ──────────────────────────────────────────────────────
  const digests = await all<{ d: string; jobs: number; people: number; digests: number }>(
    `SELECT date(created_at) d, COUNT(*) jobs, COUNT(DISTINCT user_id) people,
            COUNT(DISTINCT digest_id) digests
       FROM sent WHERE status='sent' GROUP BY d ORDER BY d DESC LIMIT ?`, DAYS);
  const reactions = await all<{ d: string; more: number; nope: number }>(
    `SELECT date(created_at) d,
            SUM(CASE WHEN reaction='more' THEN 1 ELSE 0 END) more,
            SUM(CASE WHEN reaction='not_relevant' THEN 1 ELSE 0 END) nope
       FROM feedback GROUP BY d`);

  const peak = Math.max(1, ...sources.map((x) => x.jobs_last_run));
  // Три групи за тим, що з цим МОЖНА зробити, а не за кодом помилки.
  // Окремий запит без ліміту: список джерел обрізаний до 120, і рахувати
  // групи з нього означало б показувати неправдиві числа.
  const broken = await all<{ source_name: string; status: string; last_ok_at: string | null;
    consecutive_fail_days: number; last_error: string | null; jobs_last_run: number }>(
    "SELECT * FROM sources_state WHERE status<>'ok' ORDER BY consecutive_fail_days DESC");
  const isBlocked = (x: { last_error: string | null }) => /40[13]|429/.test(x.last_error ?? "");
  const blocked = broken.filter(isBlocked);
  const lost = broken.filter((x) => !isBlocked(x) && x.last_ok_at !== null);
  const neverWorked = broken.filter((x) => !isBlocked(x) && x.last_ok_at === null);

  // ── Що горить ───────────────────────────────────────────────────────────
  // Одна смуга вгорі замість того, щоб власник шукав погане по всій сторінці.
  const high = bySeverity("high").length;
  const alerts: Array<{ text: string; href: string }> = [];
  if (lastRun && lastRun.status === "failed")
    alerts.push({ text: `Останній скан упав о ${lastRun.started_at.slice(11, 16)}`, href: "#growth" });
  if ((s?.connected ?? 0) > 0 && (s?.sentToday ?? 0) === 0)
    alerts.push({ text: "Сьогодні добірка ще нікому не пішла", href: "#digests" });
  if (high > 0)
    alerts.push({ text: `${high} пропозиц${high === 1 ? "ія" : "ії"} високої ваги`, href: "#proposals" });
  if ((s?.openFeedback ?? 0) > 0)
    alerts.push({ text: `${s?.openFeedback} відгук${(s?.openFeedback ?? 0) === 1 ? "" : "ів"} без відповіді`, href: "#feedback" });
  if (blocked.length > 0)
    alerts.push({ text: `${blocked.length} джерел заблоковано`, href: "#problems" });

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <p className="eyebrow">Панель власника</p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="display mt-2 text-3xl">Стан системи</h1>
          <p className="mono text-xs" style={{ color: "var(--muted)" }}>
            останній скан {lastRun ? `${lastRun.started_at.slice(5, 16).replace("T", " ")} · ${lastRun.status}` : "—"}
          </p>
        </div>

        {alerts.length > 0 ? (
          <div className="alert mt-6">
            <p className="font-medium">Потребує рішення · {alerts.length}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {alerts.map((a) => (
                <li key={a.href + a.text} className="text-sm">
                  <a href={a.href} className="link">{a.text}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
            Нічого не горить: скан пройшов, добірка пішла, пропозицій високої ваги немає.
          </p>
        )}

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile n={s?.allUsers ?? 0} label="людей" />
          <Tile n={s?.newWeek ?? 0} label="нових за тиждень" />
          <Tile n={s?.sentToday ?? 0} label="надіслано сьогодні" />
          <Tile n={s?.liveJobs ?? 0} label="вакансій до добірки" />
          <Tile n={s?.liveSources ?? 0} label="джерел живих" />
          <Tile n={s?.broken ?? 0} label="зламано" accent={(s?.broken ?? 0) > 0} />
        </div>

        <div className="mt-12 flex flex-col gap-12">
          <Block id="growth" title="Як ми ростемо"
                 lede={`Останні ${DAYS} днів. Наведи на стовпчик — покаже день і число.`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Spark points={growth.jobs} label="вакансій у кеші" />
              <Spark points={growth.companies} label="компаній у скані" />
              <Spark points={growth.people} label="людей усього" />
            </div>
          </Block>

          {proposals.length > 0 && (
            <Block id="proposals" title="Що пропоную змінити"
                   lede="Раз на тиждень система дивиться на власні дані. Кожна пропозиція, крім позначених «до відома», виконується одним дотиком.">
              <div className="flex flex-col gap-4">
                {(["high", "medium", "low"] as const).map((sev) => {
                  const rows = bySeverity(sev);
                  if (rows.length === 0) return null;
                  const doable = rows.filter((r) => r.kind !== "notice").length;
                  const head = sev === "high" ? "Варте уваги зараз"
                    : sev === "medium" ? "Не терміново" : "Прибирання";
                  return (
                    <div key={sev}>
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h3 className="font-medium">{head} · {rows.length}</h3>
                        {doable > 1 && (
                          <form action={applyAllProposals}>
                            <input type="hidden" name="severity" value={sev} />
                            <button className="btn px-3 py-2 text-xs">Застосувати все ({doable})</button>
                          </form>
                        )}
                      </div>
                      <div className="ruled card mt-3">
                        {rows.map((r) => (
                          <article key={r.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 px-6 py-5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <h4 className="font-medium">{r.title}</h4>
                                {r.kind === "notice" && <span className="tag tag-flat">до відома</span>}
                              </div>
                              <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{r.detail}</p>
                              {r.evidence && (
                                <p className="mono mt-2 text-xs" style={{ color: "var(--muted)" }}>{r.evidence}</p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {r.kind !== "notice" && (
                                <form action={applyProposal}>
                                  <input type="hidden" name="id" value={r.id} />
                                  <button className="btn px-3 py-2 text-xs">Застосувати</button>
                                </form>
                              )}
                              <form action={dismissProposal}>
                                <input type="hidden" name="id" value={r.id} />
                                <button className="btn btn-quiet px-3 py-2 text-xs">
                                  {r.kind === "notice" ? "Прочитав" : "Не треба"}
                                </button>
                              </form>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Block>
          )}

          {broken.length > 0 && (
            <Block id="problems" title={`Проблеми джерел · ${broken.length}`}
                   lede="Згруповано за тим, що з цим можна зробити. Найбільша група не потребує нічого.">
              <div className="flex flex-col gap-3">
                {blocked.length > 0 && (
                  <details className="card px-6 py-5">
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                      <span className="font-medium">Нас заблокували або обмежили · {blocked.length}</span>
                      <span className="mono text-xs" style={{ color: "var(--ember)" }}>показати</span>
                    </summary>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
                      403 і 429 часто минають самі: інший заголовок, менша частота. Варте одного дотику.
                    </p>
                    <form action={recheckSome} className="mt-3">
                      <input type="hidden" name="kind" value="blocked" />
                      <button className="btn btn-quiet px-3 py-2 text-xs">Перевірити всі</button>
                    </form>
                    <div className="mt-3"><SourceTable rows={blocked.slice(0, 25)} total={blocked.length} /></div>
                  </details>
                )}

                {lost.length > 0 && (
                  <details className="card px-6 py-5">
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                      <span className="font-medium">Колись працювали, тепер ні · {lost.length}</span>
                      <span className="mono text-xs" style={{ color: "var(--ember)" }}>показати</span>
                    </summary>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
                      Це справжня втрата: компанія давала вакансії й перестала. Можливо, переїхала на іншу дошку.
                    </p>
                    <form action={recheckSome} className="mt-3">
                      <input type="hidden" name="kind" value="lost" />
                      <button className="btn btn-quiet px-3 py-2 text-xs">Перевірити всі</button>
                    </form>
                    <div className="mt-3"><SourceTable rows={lost.slice(0, 25)} total={lost.length} /></div>
                  </details>
                )}

                {neverWorked.length > 0 && (
                  <div className="card flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                    <div>
                      <h3 className="font-medium">Дошки, яких не існує · {neverWorked.length}</h3>
                      <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                        Жодна не дала жодної вакансії за весь час: їх зібрали з посилань у чужих
                        даних, не перевіривши. Система прибере їх сама після наступного прогону.
                      </p>
                    </div>
                    <form action={purgeNeverWorked}>
                      <button className="btn px-4 py-2 text-sm whitespace-nowrap">Прибрати зараз</button>
                    </form>
                  </div>
                )}
              </div>
            </Block>
          )}

          <Block id="digests" title="Історія зводок"
                 lede="Що пішло людям щоранку й що вони на це відповіли.">
            <div className="card overflow-x-auto">
              <table className="board">
                <thead>
                  <tr><th>день</th><th className="num">людей</th><th className="num">вакансій</th>
                      <th className="num">просили ще</th><th className="num">«не те»</th></tr>
                </thead>
                <tbody>
                  {digests.length === 0 && (
                    <tr><td colSpan={5} className="text-sm" style={{ color: "var(--muted)" }}>
                      Жодної зводки ще не надіслано.
                    </td></tr>
                  )}
                  {digests.map((x) => {
                    const r = reactions.find((y) => y.d === x.d);
                    return (
                      <tr key={x.d}>
                        <td className="mono text-xs">{day(x.d)}</td>
                        <td className="num text-xs">{x.people}</td>
                        <td className="num text-xs">{x.jobs}</td>
                        <td className="num text-xs" style={{ color: (r?.more ?? 0) > 0 ? "var(--ok)" : undefined }}>
                          {r?.more ?? 0}
                        </td>
                        <td className="num text-xs" style={{ color: (r?.nope ?? 0) > 0 ? "var(--bad)" : undefined }}>
                          {r?.nope ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Block>

          {feedback.length > 0 && (
            <Block id="feedback" title={`Відгуки людей · ${feedback.length}`}
                   lede="Написане своїми словами. Кожен уже прилетів у Telegram — тут він лежить, щоб не загубитись.">
              <div className="ruled card">
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
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={replyToFeedback} className="flex flex-1 items-center gap-2">
                        <input type="hidden" name="id" value={f.id} />
                        <input name="reply" className="field flex-1 text-sm"
                               placeholder={f.contact?.startsWith("tg:")
                                 ? "Відповісти в Telegram…"
                                 : "Контакту немає — можна лише позначити розібраним"}
                               disabled={!f.contact?.startsWith("tg:")} />
                        <button type="submit" className="btn px-3 py-2 text-xs"
                                disabled={!f.contact?.startsWith("tg:")}>Надіслати</button>
                      </form>
                      <form action={dismissFeedback}>
                        <input type="hidden" name="id" value={f.id} />
                        <button type="submit" className="btn btn-quiet px-3 py-2 text-xs">Розібрано</button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            </Block>
          )}

          <Block id="boards" title="Національні дошки"
                 lede="Дошка країни — не агрегатор: вакансія з неї ніде більше не існує. Показується лише людям із тієї ж країни.">
            <div className="grid gap-3 sm:grid-cols-4">
              <Tile n={spend?.boards ?? 0} label="дошок увімкнено" />
              <Tile n={spend?.countries ?? 0} label="країн" />
              <Tile n={spend?.boardJobs ?? 0} label="вакансій із дошок" />
              <Tile n={spend?.localJobs ?? 0} label="з країною в кеші" />
            </div>

            {boards.length > 0 && (
              <div className="card mt-3 overflow-x-auto">
                <table className="board">
                  <thead>
                    <tr><th>країна</th><th>дошка</th><th>стан</th><th className="num">вакансій</th><th /></tr>
                  </thead>
                  <tbody>
                    {boards.map((b) => (
                      <tr key={b.id}>
                        <td className="mono text-xs">{b.country}</td>
                        <td className="text-xs">{b.label}</td>
                        <td>
                          <span className={`tag ${b.enabled === 0 ? "tag-flat" : b.status === "deprecated" ? "tag-bad"
                            : b.status === "degraded" ? "tag-warn" : "tag-ok"}`}>
                            {b.enabled === 0 ? "вимкнено" : b.status === "deprecated" ? "мертве"
                              : b.status === "degraded" ? "збоїть" : b.status === "ok" ? "працює" : "ще не читали"}
                          </span>
                        </td>
                        <td className="num text-xs">{b.jobs_last_run ?? "—"}</td>
                        <td className="text-right">
                          <form action={toggleBoard}>
                            <input type="hidden" name="id" value={b.id} />
                            <button className="mono text-xs hover:underline" style={{ color: "var(--ember)" }}>
                              {b.enabled === 0 ? "увімкнути" : "вимкнути"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form action={addBoard} className="card mt-3 flex flex-wrap items-end gap-3 px-5 py-4">
              <label className="flex flex-col gap-1">
                <span className="eyebrow">країна</span>
                <input name="country" placeholder="PL" maxLength={2} required
                       className="field mono w-20 uppercase" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">назва</span>
                <input name="label" placeholder="JustJoin.IT" required className="field w-44" />
              </label>
              <label className="flex min-w-60 flex-1 flex-col gap-1">
                <span className="eyebrow">адреса RSS</span>
                <input name="url" type="url" placeholder="https://…/feed" required className="field mono w-full text-xs" />
              </label>
              <button className="btn px-4 py-2 text-sm">Додати</button>
              <p className="w-full text-xs" style={{ color: "var(--muted)" }}>
                Стрічку перевіряємо до запису: адреса, що не віддає жодної вакансії, у базу не потрапляє.
              </p>
            </form>
          </Block>

          <Block id="spend" title="Витрати"
                 lede="Рахуємо токени, а не гроші: ставка за токен залежить від моделі й змінюється.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Tile n={spend?.calls ?? 0} label="звернень сьогодні" />
              <Tile n={spend?.callsWeek ?? 0} label="за тиждень" />
              <Tile n={spend?.inTok ?? 0} label="токенів на вхід, тиждень" />
              <Tile n={spend?.outTok ?? 0} label="токенів на вихід, тиждень" />
              <Tile n={spend?.failed ?? 0} label="невдалих звернень" accent={(spend?.failed ?? 0) > 0} />
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              {(spend?.callsWeek ?? 0) === 0
                ? "Модель зараз не викликається взагалі: ключа ANTHROPIC_API_KEY у проді немає, і розбір профілю та пояснення «чому підходить» працюють на ключових словах."
                : "Долари дивись у консолі Anthropic."}
              {" "}Запити до Workers і D1 живуть у панелі Cloudflare — щоб показати їх тут, довелося б
              покласти в воркер токен, який уміє значно більше, ніж читати лічильник.
            </p>
          </Block>

          <div className="grid gap-12 lg:grid-cols-2">
            <Block id="keys" title="Ключі доступу"
                   lede="Ключ зберігається, але жодне з цих джерел ще не під'єднане до сканера: під кожне потрібен свій розбирач.">
              <div className="ruled card">
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
            </Block>

            <Block id="company" title="Додати компанію"
                   lede="Слаг у її ATS. Провайдера можна не вказувати — скан визначить сам.">
              <form action={addCompany} className="card flex flex-col gap-3 px-5 py-5">
                <input name="slug" className="field mono text-sm" placeholder="slug, напр. deepl" required />
                <input name="name" className="field text-sm" placeholder="Назва компанії" />
                <select name="provider" className="field mono text-sm" defaultValue="">
                  <option value="">визначити автоматично</option>
                  {["greenhouse","lever","ashby","workable","smartrecruiters","breezy","personio","rippling"]
                    .map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="btn self-start">Додати</button>
              </form>
            </Block>
          </div>

          <Block id="releases" title="Історія версій"
                 lede="Що змінилося в продукті й коли. Збирається з комітів — окремого списку, який можна забути оновити, тут немає.">
            <div className="ruled card">
              {RELEASES.slice(0, 7).map((r, i) => (
                <details key={r.date} className="px-6 py-4" open={i === 0}>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4">
                    <span className="mono text-sm" style={{ color: "var(--ember)" }}>{r.date}</span>
                    <span className="text-sm">{r.changes.length} змін</span>
                    <span className="text-sm" style={{ color: "var(--muted)" }}>{r.changes[0].subject}</span>
                  </summary>
                  <ul className="mt-3 flex flex-col gap-1">
                    {r.changes.map((c) => (
                      <li key={c.hash} className="flex gap-3 text-sm">
                        <span className="mono text-xs" style={{ color: "var(--muted)" }}>{c.hash}</span>
                        <span style={{ color: "var(--ink-2)" }}>{c.subject}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </Block>

          <Block id="sources" title={`Усі джерела · ${sources.length}`}
                 lede="Довідник, а не панель: сюди заглядають, коли треба знайти конкретне джерело.">
            <details className="card px-6 py-5">
              <summary className="flex cursor-pointer items-baseline justify-between gap-3">
                <span className="font-medium">Показати таблицю</span>
                <span className="mono text-xs" style={{ color: "var(--ember)" }}>
                  {s?.liveSources ?? 0} живих · {s?.broken ?? 0} зламаних
                </span>
              </summary>
              <div className="mt-4 overflow-x-auto">
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
            </details>
          </Block>
        </div>
      </main>
    </>
  );
}
