import { redirect } from "next/navigation";
import Link from "next/link";
import Nav from "@/app/nav";
import { detectLocale } from "@/app/actions";
import { reviveSource, replyToFeedback, dismissFeedback, purgeNeverWorked, recheckSome, applyProposal, dismissProposal, applyAllProposals, addBoard, toggleBoard, toggleBoardGroup, addSources, forgetIntake, retryIntake, recountCountries, refreshTelegramNames } from "./actions";
import { currentUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { RELEASES } from "@/lib/releases";
import { INTAKE_LIMIT } from "@/lib/source-link";
import { SubmitButton } from "./submit";

/**
 * Панель власника.
 *
 * Правило сторінки: усе живе в блоках, і кожен блок відповідає на одне
 * питання. Довгі списки згорнуті — вони довідник, а не панель. Те, що горить,
 * піднімається смугою вгору, бо власник відкриває цю сторінку, щоб дізнатись
 * «чи все добре», а не щоб гортати таблиці.
 */

// Блок «Ключі доступу» прибрано 2026-08-29: п'ять полів зберігали токени до
// джерел, під які в сканері немає жодного розбирача (getSourceKey нікого не
// викликає). Панель показувала важіль, що нічого не вмикає. Повернемо разом
// із першим розбирачем — таблиця source_keys лишається на місці.

const STATE = {
  ok:         { tag: "tag-ok",   c: "var(--ok)",   text: "працює" },
  degraded:   { tag: "tag-warn", c: "var(--warn)", text: "збоїть" },
  deprecated: { tag: "tag-bad",  c: "var(--bad)",  text: "мертве" },
} as const;

/**
 * Роди джерел. Порядок — від того, що дає найбільше нового, до довідника.
 *
 * Агрегатори — єдине джерело НЕВІДОМИХ компаній; ATS — найбільший обсяг, але
 * лише від тих, кого ми вже знаємо; дошка країни — єдине місце, де вакансія
 * взагалі існує.
 */
const FAMILIES = [
  { key: "ats", label: "компанії на ATS", note: "прямо з дошки роботодавця — найточніше, що є" },
  { key: "aggregator", label: "агрегатори", note: "єдине джерело компаній, яких ми ще не знаємо" },
  { key: "board", label: "національні дошки", note: "вакансія, якої більше ніде немає" },
  { key: "getro", label: "колекції Getro", note: "борди екосистем фондів — і найбільше нових компаній" },
] as const;

/** Рід джерела одним словом — для щільної таблиці, де довгий підпис не влазить. */
const FAMILY_WORD: Record<string, string> = {
  board: "дошка", aggregator: "агрегатор", getro: "Getro", ats: "ATS",
};

/** Чим скінчилась спроба додати посилання. */
const VERDICT: Record<string, { tag: string; text: string }> = {
  added:       { tag: "tag-ok",   text: "додано" },
  duplicate:   { tag: "tag-flat", text: "вже було" },
  empty:       { tag: "tag-warn", text: "порожньо" },
  unreachable: { tag: "tag-bad",  text: "не відповіло" },
  unknown:     { tag: "tag-bad",  text: "не розпізнано" },
};

/**
 * Вікно графіків зростання.
 *
 * Було сталою на два тижні. Продукт житиме роками, і питання «як ми ростемо»
 * на двох тижнях відповіді не має — за пів року видно тенденцію, за два тижні
 * лише шум. Вибір лишається в адресі, щоб його можна було зберегти.
 */
const RANGES = [
  { id: "14", days: 14, label: "два тижні" },
  { id: "30", days: 30, label: "місяць" },
  { id: "90", days: 90, label: "квартал" },
  { id: "365", days: 365, label: "рік" },
] as const;
const DEFAULT_DAYS = 14;

/**
 * Крок графіка людей.
 *
 * Вікно й крок — різні речі, і плутати їх дорого: рік із денним кроком це
 * 365 однакових стовпчиків, а тиждень із місячним — один. Питання «скільки в
 * нас користувачів» на шести людях узагалі не має графічної відповіді, тому
 * поруч зі стовпчиками стоять числа.
 */
const BUCKETS = [
  { id: "day",   label: "по днях",    sql: "date(created_at)" },
  { id: "week",  label: "по тижнях",  sql: "strftime('%Y-%W', created_at)" },
  { id: "month", label: "по місяцях", sql: "strftime('%Y-%m', created_at)" },
] as const;
type Bucket = (typeof BUCKETS)[number];
/** Скільки змін показуємо в дні одразу; решта — під «ще N». */
const KEY_CHANGES = 6;
const num = (n: number) => n.toLocaleString("uk-UA");
const usd = (n: number): string => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
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

/**
 * Як звати людину.
 *
 * Нік — головне: за ним її можна знайти в Telegram і написати. Ніка може не
 * бути (його вмикають у налаштуваннях, і багато хто цього не робив) — тоді
 * ім'я. Немає й імені — лишається ідентифікатор, але вже як останній засіб,
 * а не як єдиний варіант.
 */
function Person({ nick, name, id }: { nick: string | null; name: string | null; id: string | null }) {
  if (nick) {
    return (
      <a href={`https://t.me/${nick}`} target="_blank" rel="noreferrer"
         className="mono text-xs hover:underline" style={{ color: "var(--ember)" }}>@{nick}</a>
    );
  }
  if (name) return <span className="text-xs" title={id ?? undefined}>{name}</span>;
  return <span className="mono text-xs" style={{ color: "var(--muted)" }} title={id ?? undefined}>
    {id ? id.slice(0, 8) : "без акаунту"}
  </span>;
}

/**
 * Один розділ таблиці джерел.
 *
 * Винесено в компонент, бо розділів два — загальні й регіональні, — і вони
 * мусять виглядати однаково: різниця між ними в тому, КОМУ видно вакансію,
 * а не в тому, як її показувати власникові.
 */
function FeedTable({ rows, title }: {
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
  // Приріст — від першого дня вікна. Раніше базою було перше НЕнульове
  // значення, тож на графіку з порожнім початком «+909 за 14 дн.» описувало
  // не два тижні, а три дні.
  const base = points[0]?.v ?? 0;
  const delta = last - base;
  const low = Math.min(...points.map((p) => p.v));
  const bars = (tall: boolean) => (
    <div className={tall ? "spark spark-tall" : "spark"}>
      {points.map((p) => (
        <div key={p.d} className="spark-bar" title={`${p.d} · ${num(p.v)}`}
             style={{ height: `${Math.max(3, Math.round((p.v / peak) * 100))}%` }} />
      ))}
    </div>
  );

  return (
    <div className="card px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="mono text-2xl leading-none" style={{ color: "var(--ember)" }}>{num(last)}</div>
        <div className="mono text-xs" style={{ color: delta > 0 ? "var(--ok)" : "var(--muted)" }}>
          {delta > 0 ? "+" : ""}{num(delta)} за {points.length} дн.
        </div>
      </div>
      <div className="eyebrow mt-2">{label}</div>

      {/* Стовпчики на три сантиметри показують напрямок, але не величину:
          різниця між 900 і 950 у них не видно взагалі. Тому те саме
          розгортається вище і з підписами — на місці, без окремої сторінки. */}
      <details className="mt-3">
        <summary className="list-none" style={{ cursor: "pointer" }}>{bars(false)}</summary>
        <div className="mt-3">
          {bars(true)}
          <div className="mono mt-2 flex justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>{points[0]?.d.slice(5) ?? ""}</span>
            <span>найменше {num(Number.isFinite(low) ? low : 0)} · найбільше {num(peak)}</span>
            <span>{points.at(-1)?.d.slice(5) ?? ""}</span>
          </div>
        </div>
      </details>
    </div>
  );
}

/**
 * Воронка. Смужка міряється від першого щабля, а не від найбільшого: питання
 * тут «скільки дійшло звідти, де всі», і масштаб від максимуму це б сховав.
 */
function Funnel({ steps }: { steps: Array<{ label: string; n: number; note: string }> }) {
  const top = Math.max(1, steps[0]?.n ?? 1);
  return (
    <div className="ruled card">
      {steps.map((x, i) => (
        <div key={x.label} className="px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{x.label}</span>
            <span className="mono text-sm" style={{ color: "var(--ember)" }}>
              {num(x.n)}
              {i > 0 && (
                <span className="ml-2" style={{ color: "var(--muted)" }}>
                  {Math.round((x.n / top) * 100)}%
                </span>
              )}
            </span>
          </div>
          <div className="mt-2" style={{ height: 6, background: "var(--surface-2)" }}>
            <div style={{ height: 6, width: `${Math.round((x.n / top) * 100)}%`, background: "var(--ember)" }} />
          </div>
          <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{x.note}</div>
        </div>
      ))}
    </div>
  );
}

/** Скільки сфер обрала людина. Порожній JSON — анкети ще немає. */
const sphereCount = (raw: string | null): number => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
};

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

export default async function Admin({ searchParams }: {
  searchParams: Promise<{ range?: string; bucket?: string }>;
}) {
  const { range, bucket } = await searchParams;
  const DAYS = RANGES.find((r) => r.id === range)?.days ?? DEFAULT_DAYS;
  const step: Bucket = BUCKETS.find((b) => b.id === bucket) ?? BUCKETS[0];
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
           -- Зламане — це те, що КОЛИСЬ працювало. Дошки, яких ніколи не
           -- існувало (їх зібрали з посилань у чужих даних), система прибирає
           -- сама; у лічильнику вони давали 153 замість десяти й лякали щодня.
           (SELECT COUNT(*) FROM sources_state WHERE status!='ok' AND last_ok_at IS NOT NULL) broken,
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

  const lastRun = await one<{ started_at: string; status: string; jobs_found: number;
    ladder_reached: string | null; notes: string | null }>(
    "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1");

  const proposals = await all<{ id: string; kind: string; target: string | null; title: string;
    detail: string; evidence: string | null; severity: string; created_at: string }>(
    `SELECT * FROM proposals WHERE status='open'
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at`);
  const bySeverity = (sev: string) => proposals.filter((x) => x.severity === sev);

  // Нік автора приєднуємо тут-таки: відгук «від 06df703e» не давав ні
  // впізнати людину, ні згадати, про що з нею вже говорили.
  const feedback = await all<{ id: string; user_id: string | null; contact: string | null;
    locale: string; page: string | null; message: string; created_at: string;
    nick: string | null; person: string | null }>(
    `SELECT f.*, u.telegram_username nick, u.telegram_name person
       FROM site_feedback f LEFT JOIN users u ON u.id = f.user_id
      WHERE f.handled_at IS NULL ORDER BY f.created_at DESC LIMIT 30`);

  // Витрати в доларах: cost_usd пишеться при кожному виклику за таблицею pricing.ts.
  const spend = await one<{ calls: number; callsWeek: number; usdToday: number; usdWeek: number;
    usdMonth: number; failed: number; boards: number; countries: number; boardJobs: number; localJobs: number }>(`
    SELECT (SELECT COUNT(*) FROM api_usage WHERE date(at)=date('now')) calls,
           (SELECT COUNT(*) FROM api_usage WHERE at >= datetime('now','-7 day')) callsWeek,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE date(at)=date('now')) usdToday,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE at >= datetime('now','-7 day')) usdWeek,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE at >= datetime('now','-30 day')) usdMonth,
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

  /**
   * Країни, де вже є люди, але дошок немає.
   *
   * Дошки ніхто не знаходить сам: discover шукає компанії на ATS, а не
   * національні дошки. Тому єдиний спосіб дізнатися, для якої країни варто
   * пошукати фіди, — побачити, звідки прийшли люди.
   */
  const gaps = await all<{ country: string; people: number }>(
    `SELECT p.country, COUNT(*) people
       FROM profiles p
      WHERE p.country IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM country_boards b
                         WHERE b.country = p.country AND b.enabled = 1)
      GROUP BY p.country ORDER BY people DESC`);

  // Рубрики однієї дошки — це не окремі дошки. «DOU · Python» належить
  // до «DOU», тому в таблиці показуємо дошку, а рубрики ховаємо всередину.
  const boardGroups = [...boards.reduce((acc, b) => {
    const name = b.label.split(" · ")[0]!;
    const key = `${b.country}|${name}`;
    const g = acc.get(key) ?? { country: b.country, name, rows: [] as typeof boards };
    g.rows.push(b);
    acc.set(key, g);
    return acc;
  }, new Map<string, { country: string; name: string; rows: typeof boards }>()).values()];

  /**
   * Звідки насправді приїхали вакансії.
   *
   * Досі «джерела» в панелі означали три різні речі в трьох різних місцях:
   * компанії — в одному блоці, національні дошки — в іншому, а агрегатори й
   * колекції Getro не показувались ніде, бо живуть у коді сканера. На питання
   * «звідки ми беремо інфу» відповіді не було взагалі.
   *
   * Рахуємо за `jobs_cache.source` — за тим, що справді доїхало, а не за тим,
   * що налаштоване. Джерело, налаштоване й мовчазне, тут не з'явиться, і це
   * правильна відповідь: воно нічого нам не дає.
   */
  const families = await all<{ family: string; feeds: number; jobs: number;
    companies: number; fresh: number }>(`
    SELECT CASE WHEN source LIKE 'aggregator:%' THEN 'aggregator'
                WHEN source LIKE 'getro:%'      THEN 'getro'
                WHEN source LIKE 'board:%'      THEN 'board'
                ELSE 'ats' END family,
           COUNT(DISTINCT source) feeds, COUNT(*) jobs,
           COUNT(DISTINCT company_key) companies,
           SUM(CASE WHEN fetched_at >= datetime('now','-3 day') THEN 1 ELSE 0 END) fresh
      FROM jobs_cache GROUP BY family ORDER BY jobs DESC`);

  /**
   * Повний перелік того, звідки ми тягнемо дані, — одним списком.
   *
   * Попередній варіант рахував лише за `jobs_cache`, тобто показував тільки
   * джерела, які щось привезли. Дошка, налаштована й мовчазна, не з'являлась
   * ніде — а саме вона й потребує втручання: `board:global-web3career` стояв
   * увімкненим зі стрічкою, що ніколи не віддавала жодного рядка, і побачити
   * це в панелі було неможливо.
   *
   * Тому дошки беруться з `country_boards` (усі, і мовчазні теж), а решта —
   * з кеша. ATS-компаній понад дві тисячі: поіменно вони тут не поміщаються
   * і не потрібні, тож згортаються в один рядок на провайдера.
   */
  const feeds = await all<{ source: string; label: string; family: string;
    country: string | null; jobs: number; fresh: number; status: string | null }>(`
    SELECT b.name source, b.label, 'board' family,
           b.country,
           COALESCE(j.jobs, 0) jobs, COALESCE(j.fresh, 0) fresh,
           CASE WHEN b.enabled = 0 THEN 'off' ELSE s.status END status
      FROM country_boards b
      LEFT JOIN sources_state s ON s.source_name = b.name
      LEFT JOIN (SELECT source, COUNT(*) jobs,
                        SUM(CASE WHEN fetched_at >= datetime('now','-3 day') THEN 1 ELSE 0 END) fresh
                   FROM jobs_cache GROUP BY source) j ON j.source = b.name

     UNION ALL
    SELECT j.source, REPLACE(j.source, 'aggregator:', ''), 'aggregator', NULL,
           COUNT(*), SUM(CASE WHEN j.fetched_at >= datetime('now','-3 day') THEN 1 ELSE 0 END),
           s.status
      FROM jobs_cache j LEFT JOIN sources_state s ON s.source_name = j.source
     WHERE j.source LIKE 'aggregator:%' GROUP BY j.source

     UNION ALL
    SELECT j.source, 'колекція ' || REPLACE(j.source, 'getro:', ''), 'getro', NULL,
           COUNT(*), SUM(CASE WHEN j.fetched_at >= datetime('now','-3 day') THEN 1 ELSE 0 END),
           s.status
      FROM jobs_cache j LEFT JOIN sources_state s ON s.source_name = j.source
     WHERE j.source LIKE 'getro:%' GROUP BY j.source

     UNION ALL
    SELECT 'ats:' || provider, provider || ' · ' || COUNT(DISTINCT company) || ' компаній',
           'ats', NULL, SUM(n), SUM(fresh_n), NULL
      FROM (SELECT SUBSTR(source, 1, INSTR(source, ':') - 1) provider,
                   SUBSTR(source, INSTR(source, ':') + 1) company,
                   COUNT(*) n,
                   SUM(CASE WHEN fetched_at >= datetime('now','-3 day') THEN 1 ELSE 0 END) fresh_n
              FROM jobs_cache
             WHERE source LIKE '%:%'
               AND source NOT LIKE 'aggregator:%' AND source NOT LIKE 'board:%'
               AND source NOT LIKE 'getro:%'
             GROUP BY source)
     GROUP BY provider

     ORDER BY jobs DESC`);

  /**
   * Рубрики однієї дошки — це одна дошка.
   *
   * DOU займав двадцять чотири рядки з двадцяти дев'яти: «DOU · Java»,
   * «DOU · DevOps», «DOU · HR». За фактом це одне джерело з рубриками, і в
   * такому вигляді таблиця відповідала на питання «скільки в нас стрічок»,
   * а не «звідки ми беремо дані». Групуємо за тим самим правилом, що й блок
   * «Національні дошки» нижче: усе до « · » — назва дошки.
   */
  const grouped = [...feeds.reduce((acc, f) => {
    const brand = f.family === "board" ? f.label.split(" · ")[0]! : f.label;
    const key = `${f.family}|${f.country ?? ""}|${brand}`;
    const g = acc.get(key);
    if (g) {
      g.jobs += f.jobs;
      g.fresh += f.fresh;
      g.parts += 1;
      // Дошка жива, якщо жива хоч одна рубрика: «вимкнено» на одній із
      // двадцяти чотирьох не робить мовчазним усе джерело.
      if (f.status === "ok") g.status = "ok";
      else g.status ??= f.status;
    } else {
      acc.set(key, { ...f, label: brand, parts: 1 });
    }
    return acc;
  }, new Map<string, typeof feeds[number] & { parts: number }>()).values()]
    .sort((a, b) => b.jobs - a.jobs);

  /**
   * Регіональне окремо від загального.
   *
   * Це не косметика: від країни залежить, кому вакансія взагалі покажеться
   * (digest.ts: `country IS NULL OR country = ?`). Одним списком німецька
   * дошка стоїть поряд із глобальним агрегатором, хоча її 582 вакансії
   * бачить лише людина з Німеччини, а не всі.
   */
  const regional = grouped.filter((f) => f.country && f.country !== "*");
  const general = grouped.filter((f) => !f.country || f.country === "*");

  const intake = await all<{ id: string; url: string; at: string; verdict: string;
    kind: string | null; target: string | null; note: string | null; found: number;
    fix: string | null }>(
    // Лише невдалі. Вдалий рядок нічого не пояснює — з ним уже все гаразд, —
    // а займав більшу частину блоку: вісім посилань поспіль зі словом
    // «додано» ховали два, з якими треба щось робити.
    `SELECT * FROM source_intake
      WHERE verdict <> 'added' AND verdict <> 'duplicate'
      ORDER BY at DESC LIMIT 12`);

  // Скільки прийнялось — числом, бо сам список не потрібен.
  const intakeOk = (await one<{ n: number }>(
    `SELECT COUNT(*) n FROM source_intake
      WHERE verdict = 'added' AND at >= datetime('now','-7 day')`))?.n ?? 0;

  // Колекції Getro — борди екосистем фондів. Головний постачальник компаній,
  // яких ми ще не знаємо, і досі його не було видно в панелі взагалі.
  const getro = await all<{ collection_id: number; label: string; url: string | null;
    enabled: number; jobs: number }>(
    // Лише ті, що читаються. Вимкнених буде кілька сотень: розвідка щонеділі
    // знаходить живі колекції по всьому діапазону й записує їх зупиненими, бо
    // читати всі щодня коштувало б півтори години замість п'яти хвилин. Їхнє
    // місце — число, а не стіна рядків.
    `SELECT g.collection_id, g.label, g.url, g.enabled,
            (SELECT COUNT(*) FROM jobs_cache j WHERE j.source = 'getro:' || g.collection_id) jobs
       FROM getro_collections g WHERE g.enabled = 1
      ORDER BY jobs DESC, g.collection_id`);

  const getroOff = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM getro_collections WHERE enabled = 0"))?.n ?? 0;

  // Кнопку «підтягнути ніки» показуємо лише тоді, коли є кого підтягувати.
  const nameless = (await one<{ n: number }>(
    `SELECT COUNT(*) n FROM users
      WHERE telegram_chat_id IS NOT NULL AND telegram_username IS NULL AND telegram_name IS NULL`))?.n ?? 0;

  // ── Зростання ───────────────────────────────────────────────────────────
  const scanDays = await all<{ d: string; jobs: number; companies: number }>(
    `SELECT date(started_at) d, MAX(jobs_found) jobs, MAX(distinct_companies) companies
       FROM scan_runs WHERE status='ok' AND started_at >= datetime('now', ?)
      GROUP BY d ORDER BY d`, `-${DAYS} day`);
  // Дотики в боті: єдина наша власна міра того, чи людина взагалі користується
  // продуктом. Відвідування САЙТУ сюди не входять — вони живуть у Cloudflare
  // Web Analytics, і дістати їх можна лише через їхній GraphQL із окремим
  // токеном. Це інша задача, і робити вигляд, що графік їх показує, не можна.
  const taps = await all<{ d: string; n: number }>(
    `SELECT date(at) d, COUNT(*) n FROM bot_activity
      WHERE at >= datetime('now', ?) GROUP BY d ORDER BY d`, `-${DAYS} day`);

  // Приріст людей кроком, який обрали. Накопичення рахуємо в JS, бо віконні
  // функції D1 підтримує, але читати їх тут нікому не легше.
  const byStep = await all<{ d: string; n: number }>(
    `SELECT ${step.sql} d, COUNT(*) n FROM users
      WHERE created_at >= datetime('now', ?) GROUP BY d ORDER BY d`, `-${DAYS} day`);
  const beforeStep = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM users WHERE created_at < datetime('now', ?)", `-${DAYS} day`))?.n ?? 0;
  const peopleSteps = byStep.reduce<Array<{ d: string; nowTotal: number; added: number }>>(
    (acc, x) => {
      const prev = acc.at(-1)?.nowTotal ?? beforeStep;
      acc.push({ d: x.d, nowTotal: prev + x.n, added: x.n });
      return acc;
    }, []);

  const signups = await all<{ d: string; n: number }>(
    "SELECT date(created_at) d, COUNT(*) n FROM users GROUP BY d ORDER BY d");
  // Скільки людей було до початку вікна — щоб лінія росла з реального рівня,
  // а не з нуля.
  const before = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM users WHERE date(created_at) < date('now', ?)",
    `-${DAYS - 1} day`))?.n ?? 0;

  // ── Люди ────────────────────────────────────────────────────────────────
  // Панель знала про людей два числа: скільки всього й скільки за тиждень.
  // На шести користувачах питання не «скільки», а «де вони застрягли»:
  // зареєструвався — заповнив анкету — прив'язав Telegram — отримав добірку —
  // відповів на неї. Кожен щабель, який не пройшли, це наша недоробка.
  const funnel = await one<{ registered: number; profiled: number; connected: number;
    delivered: number; reacted: number }>(`
    SELECT (SELECT COUNT(*) FROM users) registered,
           (SELECT COUNT(*) FROM profiles) profiled,
           (SELECT COUNT(*) FROM users WHERE telegram_chat_id IS NOT NULL) connected,
           (SELECT COUNT(DISTINCT user_id) FROM sent WHERE status='sent') delivered,
           (SELECT COUNT(DISTINCT user_id) FROM feedback) reacted`);

  // Пошти тут навмисно немає: панель відкривають на людях і показують з
  // екрана. А от нік є: за «06df703e» неможливо ні впізнати людину, ні
  // написати їй, і саме це власник хоче зробити, дивлячись на цей список.
  const people = await all<{ id: string; created_at: string | null; locale: string; status: string;
    tg: number; country: string | null; spheres: string | null; sent: number;
    more: number; nope: number; last_seen: string | null;
    nick: string | null; person: string | null }>(`
    SELECT u.id, u.created_at, u.locale, u.status,
           u.telegram_username nick, u.telegram_name person,
           CASE WHEN u.telegram_chat_id IS NULL THEN 0 ELSE 1 END tg,
           u.last_interaction_at last_seen,
           p.country, p.spheres,
           (SELECT COUNT(*) FROM sent WHERE user_id=u.id AND status='sent') sent,
           (SELECT COUNT(*) FROM feedback WHERE user_id=u.id AND reaction='more') more,
           (SELECT COUNT(*) FROM feedback WHERE user_id=u.id AND reaction='not_relevant') nope
      FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     ORDER BY u.created_at DESC LIMIT 50`);

  // Останній вимір ДО вікна. Без нього кожен день до першого скану у вікні
  // малювався нулем: «вакансій у кеші» показувало одинадцять порожніх
  // стовпчиків і стрибок наприкінці, хоч кеш весь час був повний. Нуль там
  // означав не «нічого не було», а «ми того дня не міряли».
  const beforeScan = await one<{ jobs: number; companies: number }>(
    `SELECT jobs_found jobs, distinct_companies companies FROM scan_runs
      WHERE status='ok' AND date(started_at) < date('now', ?)
      ORDER BY started_at DESC LIMIT 1`, `-${DAYS - 1} day`);

  // Вісь днів рахує база, а не JS: під час рендера викликати Date.now() не
  // можна — React вимагає, щоб рендер був чистим, і лінтер це ловить.
  //
  // Вісь не починається раніше, ніж з'явились перші дані. Продукт молодший
  // за два тижні, і решта вікна була б не «нулем», а порожнечею до запуску.
  const axis = (await all<{ d: string }>(
    `WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT d FROM (SELECT date('now', '-' || n || ' day') d FROM seq)
      WHERE d >= COALESCE((SELECT MIN(day) FROM (
              SELECT MIN(date(created_at)) day FROM users
              UNION ALL SELECT MIN(date(started_at)) FROM scan_runs WHERE status='ok')), d)
      ORDER BY d`, DAYS - 1)).map((x) => x.d);
  // Порожній день тягне значення попереднього: скан, що не записав рядок, не
  // означає, що кеш спорожнів. Малювати там нуль було б неправдою.
  const carry = (get: (d: string) => number | undefined, start = 0) => {
    let prev = start;
    return axis.map((d) => ({ d, v: (prev = get(d) ?? prev) }));
  };
  const growth = {
    jobs: carry((d) => scanDays.find((x) => x.d === d)?.jobs, beforeScan?.jobs ?? 0),
    companies: carry((d) => scanDays.find((x) => x.d === d)?.companies, beforeScan?.companies ?? 0),
    // Накопичення рахується від рівня на початок вікна: людей не меншає.
    people: axis.map((d) => ({
      d,
      v: before + signups.filter((x) => x.d >= axis[0]! && x.d <= d).reduce((a, x) => a + x.n, 0),
    })),
    // Дотики — за день, а не накопиченням: питання тут «чи користуються нами
    // сьогодні», і зростаюча крива на нього відповідала б «так» навіть у
    // місяць повної тиші. День без жодного дотику має бути видно нулем.
    taps: axis.map((d) => ({ d, v: taps.find((x) => x.d === d)?.n ?? 0 })),
  };

  // ── Історія зводок ──────────────────────────────────────────────────────
  const digests = await all<{ d: string; jobs: number; people: number; digests: number }>(
    `SELECT date(created_at) d, COUNT(*) jobs, COUNT(DISTINCT user_id) people,
            COUNT(DISTINCT digest_id) digests
       FROM sent WHERE status='sent'
         AND date(created_at) >= date('now', '-' || ((strftime('%w','now') + 6) % 7) || ' day')
       GROUP BY d ORDER BY d DESC LIMIT 5`);
  const reactions = await all<{ d: string; more: number; nope: number }>(
    `SELECT date(created_at) d,
            SUM(CASE WHEN reaction='more' THEN 1 ELSE 0 END) more,
            SUM(CASE WHEN reaction='not_relevant' THEN 1 ELSE 0 END) nope
       FROM feedback GROUP BY d`);

  // Три групи за тим, що з цим МОЖНА зробити, а не за кодом помилки.
  // Окремий запит без ліміту: список джерел обрізаний до 120, і рахувати
  // групи з нього означало б показувати неправдиві числа.
  const broken = await all<{ source_name: string; status: string; last_ok_at: string | null;
    consecutive_fail_days: number; last_error: string | null; jobs_last_run: number }>(
    // Без `deprecated` — і це не косметика, а причина, чому кнопка «Прибрати
    // зараз» виглядала мертвою. Вона ставила саме `deprecated`, а список брав
    // усе, що не `ok`, тобто ті самі рядки лишались на екрані незмінними.
    // Прибране — це вже вирішене, і в блоці «проблеми» йому не місце.
    `SELECT * FROM sources_state
      WHERE status<>'ok' AND status<>'deprecated' ORDER BY consecutive_fail_days DESC`);
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
          <Block id="people" title={`Люди · ${funnel?.registered ?? 0}`}
                 lede="Де вони застрягли. Кожен щабель, який людина не пройшла, — це наша недоробка, а не її неуважність."
                 right={nameless > 0 ? (
                   <form action={refreshTelegramNames}>
                     <SubmitButton busy="Питаю Telegram…" className="btn btn-quiet px-3 py-2 text-xs">
                       Підтягнути ніки · {nameless}
                     </SubmitButton>
                   </form>
                 ) : undefined}>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <Funnel steps={[
                { label: "Зареєструвались", n: funnel?.registered ?? 0, note: "почали з сайту або з бота" },
                { label: "Заповнили анкету", n: funnel?.profiled ?? 0, note: "є рядок у profiles" },
                { label: "Прив'язали Telegram", n: funnel?.connected ?? 0, note: "без цього добірку нікуди слати" },
                { label: "Отримали добірку", n: funnel?.delivered ?? 0, note: "хоч одна доставлена" },
                { label: "Відповіли на неї", n: funnel?.reacted ?? 0, note: "«ще п'ять» або «не те»" },
              ]} />
              <div className="card overflow-x-auto">
                <table className="board">
                  <thead>
                    <tr><th>людина</th><th>прийшла</th><th>анкета</th><th>TG</th>
                        <th className="num">добірок</th><th>реакції</th><th>остання дія</th></tr>
                  </thead>
                  <tbody>
                    {people.map((x) => (
                      <tr key={x.id} className="stripe"
                          style={{ "--c": x.sent > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                        <td><Person nick={x.nick} name={x.person} id={x.id} /></td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.created_at?.slice(0, 10) ?? "—"}
                        </td>
                        <td className="text-xs">
                          {sphereCount(x.spheres) > 0
                            ? `${sphereCount(x.spheres)} сфер · ${x.country ?? x.locale}`
                            : <span className="tag tag-warn">немає</span>}
                        </td>
                        <td className="text-xs">{x.tg ? "✓" : <span className="tag tag-warn">ні</span>}</td>
                        <td className="num text-xs">{x.sent}</td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.more + x.nope === 0 ? "—" : `+${x.more} / −${x.nope}`}
                        </td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.last_seen?.slice(0, 16).replace("T", " ") ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Block>

          <Block id="users" title={`Користувачі · ${funnel?.registered ?? 0}`}
                 lede="Скільки нас усього і скільки прибуло за крок. На перших десятках людей стовпчики нічого не кажуть, тому поруч стоять числа."
                 right={
                   <div className="flex flex-wrap items-center gap-3">
                     {BUCKETS.map((b) => (
                       <Link key={b.id}
                             href={`/admin?${new URLSearchParams({
                               ...(range ? { range } : {}), ...(b.id === "day" ? {} : { bucket: b.id }),
                             })}#users`}
                             className="mono text-xs"
                             style={{ color: b.id === step.id ? "var(--ember)" : "var(--muted)",
                                      textDecoration: b.id === step.id ? "underline" : "none" }}>
                         {b.label}
                       </Link>
                     ))}
                   </div>
                 }>
            {peopleSteps.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                За обраний період не зареєструвався ніхто.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_1fr]">
                <Spark points={peopleSteps.map((x) => ({ d: x.d, v: x.nowTotal }))}
                       label="людей усього" />
                <div className="card overflow-x-auto">
                  <table className="board">
                    <thead>
                      <tr><th>{step.label.replace("по ", "")}</th>
                          <th className="num">прибуло</th><th className="num">усього</th></tr>
                    </thead>
                    <tbody>
                      {/* Найновіше згори: питання «скільки нас зараз» частіше за
                          «скільки було на початку». */}
                      {[...peopleSteps].reverse().map((x) => (
                        <tr key={x.d} className="stripe"
                            style={{ "--c": x.added > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                          <td className="mono text-xs">{x.d}</td>
                          <td className="num text-xs"
                              style={{ color: x.added > 0 ? "var(--ok)" : "var(--muted)" }}>
                            {x.added > 0 ? `+${x.added}` : "—"}
                          </td>
                          <td className="num text-xs">{num(x.nowTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Block>

          <Block id="growth" title="Як ми ростемо"
                 lede={`Останні ${DAYS} днів. Наведи на стовпчик — покаже день і число.`}
                 right={
                   <div className="flex flex-wrap items-center gap-3">
                     {RANGES.map((r) => (
                       <Link key={r.id}
                             href={r.days === DEFAULT_DAYS ? "/admin#growth" : `/admin?range=${r.id}#growth`}
                             className="mono text-xs"
                             style={{ color: r.days === DAYS ? "var(--ember)" : "var(--muted)",
                                      textDecoration: r.days === DAYS ? "underline" : "none" }}>
                         {r.label}
                       </Link>
                     ))}
                   </div>
                 }>
            <div className="grid gap-3 sm:grid-cols-3">
              <Spark points={growth.jobs} label="вакансій у кеші" />
              <Spark points={growth.companies} label="компаній у скані" />
              <Spark points={growth.people} label="людей усього" />
              <Spark points={growth.taps} label="дотиків у боті за день" />
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
                                {r.kind === "add_source" && <span className="tag tag-ok">нове джерело</span>}
                              </div>
                              <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{r.detail}</p>
                              {r.evidence && (
                                <p className="mono mt-2 text-xs" style={{ color: "var(--muted)" }}>{r.evidence}</p>
                              )}
                              {/* Рішення «брати чи ні» приймається очима, а не
                                  за числом. Без посилання власник мусив би
                                  копіювати адресу з тексту в браузер. */}
                              {r.kind === "add_source" && r.target && (
                                <a href={r.target} target="_blank" rel="noopener noreferrer"
                                   className="mono mt-2 inline-block text-xs hover:underline"
                                   style={{ color: "var(--ember)" }}>
                                  подивитись стрічку ↗
                                </a>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {r.kind !== "notice" && (
                                <form action={applyProposal}>
                                  <input type="hidden" name="id" value={r.id} />
                                  <button className="btn px-3 py-2 text-xs">
                                    {r.kind === "add_source" ? "Додати" : "Застосувати"}
                                  </button>
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

          {/* Тиждень, а не весь час: список ріс без кінця й ставав журналом
              замість панелі. Понеділок цього тижня рахуємо явно через `%w`:
              `datetime('now','weekday 1','-7 day')` виглядає коротше, але в
              САМ понеділок дає попередній тиждень, і таблиця тихо показувала б
              на сім днів більше. */}
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
                      <Person nick={f.nick} name={f.person} id={f.user_id} />
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

          <Block id="sources" title="Джерела"
                 lede="Звідки взялись вакансії, що лежать у кеші. Рахується за тим, що справді доїхало, а не за тим, що налаштоване: джерело, яке мовчить, тут не з'явиться — і це про нього чесна відповідь.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FAMILIES.map((f) => {
                const row = families.find((x) => x.family === f.key);
                return (
                  <div key={f.key} className="card px-5 py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="mono text-2xl leading-none" style={{ color: "var(--ember)" }}>
                        {num(row?.jobs ?? 0)}
                      </div>
                      <div className="mono text-xs" style={{ color: "var(--muted)" }}>
                        {num(row?.feeds ?? 0)} шт.
                      </div>
                    </div>
                    <div className="eyebrow mt-2">{f.label}</div>
                    <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>{f.note}</p>
                    <p className="mono mt-2 text-xs"
                       style={{ color: (row?.fresh ?? 0) > 0 ? "var(--ok)" : "var(--muted)" }}>
                      {num(row?.fresh ?? 0)} за 3 дні
                    </p>
                  </div>
                );
              })}
            </div>

            {grouped.length > 0 && (
              <div className="card mt-3 px-6 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-medium">Поіменно · {grouped.length}</h3>
                  <span className="mono text-xs"
                        style={{ color: grouped.some((f) => f.jobs === 0) ? "var(--bad)" : "var(--muted)" }}>
                    мовчазних: {grouped.filter((f) => f.jobs === 0).length}
                  </span>
                </div>
                <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                  Усе, звідки ми тягнемо дані. Рубрики однієї дошки згорнуті в неї саму —
                  «DOU · Java» і «DOU · HR» це один DOU. Компанії на ATS згорнуті по
                  провайдеру. Джерело, що не дало жодного рядка, лишається у списку: мовчазну
                  дошку не видно більше ніде.
                </p>

                <FeedTable rows={general} title="Загальні — бачать усі" />
                <FeedTable rows={regional} title="Регіональні — бачить лише своя країна" />
              </div>
            )}

            <form action={addSources} className="card mt-3 flex flex-col gap-3 px-5 py-5">
              <div>
                <h3 className="font-medium">Додати джерело посиланням</h3>
                <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                  Вставляй те, що бачив у браузері: сторінку вакансій компанії, стрічку дошки,
                  просто «Careers». Рід джерела, назву й країну визначаємо самі. Можна кілька
                  посилань — по одному на рядок.
                </p>
              </div>
              <textarea name="links" rows={3} required
                        className="field mono w-full text-xs"
                        placeholder={"https://boards.greenhouse.io/deepl\nhttps://dou.ua/vacancies/feeds/?category=Python"} />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton busy="Перевіряю…">Додати</SubmitButton>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Не більше {INTAKE_LIMIT} за раз. Кожне перевіряємо до запису: адреса, що не
                  віддає жодної вакансії, у базу не потрапляє — але внизу буде видно чому.
                </p>
              </div>
            </form>

            {getro.length > 0 && (
              <details className="card mt-3 px-6 py-5">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">
                    Колекції Getro · {getro.length}
                    {getroOff > 0 && (
                      <span className="ml-2 font-normal" style={{ color: "var(--muted)" }}>
                        і ще {getroOff} знайдених, але зупинених
                      </span>
                    )}
                  </span>
                  <span className="mono text-xs" style={{ color: "var(--ember)" }}>показати</span>
                </summary>
                <p className="mt-2 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                  Борди екосистем фондів: jobs.solana.com, jobs.avax.network і подібні. Це
                  головне джерело компаній, яких ми ще не знаємо — 80% посилань там ведуть
                  просто в ATS роботодавця. Новий борд додається сюди звичайним посиланням.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="board">
                    <thead>
                      <tr><th>колекція</th><th>№</th><th className="num">вакансій у кеші</th></tr>
                    </thead>
                    <tbody>
                      {getro.map((x) => (
                        <tr key={x.collection_id} className="stripe"
                            style={{ "--c": x.jobs > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                          <td className="text-xs">
                            {x.url
                              ? <a href={x.url} target="_blank" rel="noreferrer"
                                   className="hover:underline" style={{ color: "var(--ember)" }}>{x.label}</a>
                              : x.label}
                          </td>
                          <td className="mono text-xs" style={{ color: "var(--muted)" }}>{x.collection_id}</td>
                          <td className="num text-xs">{x.jobs || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {intakeOk > 0 && intake.length === 0 && (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                За тиждень прийнято джерел: {intakeOk}. Нерозібраних немає.
              </p>
            )}

            {intake.length > 0 && (
              <div className="ruled card mt-3">
                <div className="px-6 pb-1 pt-5">
                  <h3 className="font-medium">
                    Посилання, які не прийнялись · {intake.length}
                    {intakeOk > 0 && (
                      <span className="ml-2 font-normal" style={{ color: "var(--muted)" }}>
                        і ще {intakeOk} прийнятих за тиждень
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                    Тільки те, з чим треба щось зробити: вдалі рядки нічого не пояснюють, бо
                    з ними вже все гаразд, — а займали більшу частину блоку. Тут видно, ЧОМУ
                    посилання не прийнялось, і що з цим робити. Половина відмов тимчасова
                    (дошка віддала 403 під навантаженням, стрічка була порожня між
                    публікаціями), тож рядок можна перевірити ще раз. Розібрався — прибери.
                  </p>
                </div>
                {intake.map((x) => {
                  const v = VERDICT[x.verdict] ?? { tag: "tag-flat", text: x.verdict };
                  return (
                    <div key={x.id} className="px-6 py-4">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.at.slice(5, 16).replace("T", " ")}
                        </span>
                        <span className={`tag ${v.tag}`}>{v.text}</span>
                        <span className="mono min-w-0 flex-1 truncate text-xs" title={x.url}>{x.url}</span>
                        {/* Повторювати вдалу спробу нема сенсу: джерело вже
                            в базі, і друга спроба дасть лише «вже було». */}
                        {x.verdict !== "added" && (
                          <form action={retryIntake}>
                            <button className="mono text-xs hover:underline" style={{ color: "var(--ember)" }}>
                              спробувати ще
                            </button>
                            <input type="hidden" name="id" value={x.id} />
                          </form>
                        )}
                        <form action={forgetIntake}>
                          <button className="mono text-xs hover:underline" style={{ color: "var(--muted)" }}>
                            прибрати
                          </button>
                          <input type="hidden" name="id" value={x.id} />
                        </form>
                      </div>
                      {x.note && (
                        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{x.note}</p>
                      )}
                      {/* Причина без наступного кроку — це та сама відмова,
                          лише довшими словами. */}
                      {x.fix && (
                        <p className="mt-1 text-sm" style={{ color: "var(--ink)" }}>
                          <span className="eyebrow mr-2">що робити</span>{x.fix}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Block>

          {/* Заголовок каже «країни», а сім дошок мають країну «*» — вони
              глобальні, тобто рівно навпаки: їх бачать усі. Через це Remote3,
              Remotech і Remote Backend Jobs читались як національні. Назва
              блоку тепер описує обидва види, а країна кожної дошки стоїть у
              таблиці окремою колонкою. */}
          <Block id="boards" title="Дошки"
                 lede="Дошка — не агрегатор: вакансія з неї ніде більше не існує. Національну бачать лише люди з тієї ж країни, глобальну — усі.">
            <div className="grid gap-3 sm:grid-cols-4">
              <Tile n={spend?.boards ?? 0} label="дошок увімкнено" />
              <Tile n={spend?.countries ?? 0} label="країн" />
              <Tile n={spend?.boardJobs ?? 0} label="вакансій із дошок" />
              <Tile n={spend?.localJobs ?? 0} label="з країною в кеші" />
            </div>

            <div className="card mt-3 px-5 py-4">
              <p className="eyebrow">країни, де є люди, а дошок немає</p>
              {gaps.length > 0 ? (
                <>
                  <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
                    {gaps.map((g) => `${g.country} · ${g.people}`).join("   ")}
                  </p>
                  <p className="mt-2 max-w-prose text-xs" style={{ color: "var(--muted)" }}>
                    Три перші з цього списку стають запитами до твіттера щонеділі: розвідка
                    шукає дошку саме для них і приносить її сюди пропозицією з високою вагою.
                    Чекати не обов’язково — стрічку можна додати посиланням будь-коли.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  Порожньо. Кожна країна, з якої в нас є людина, має свою дошку.
                </p>
              )}
              {/* Країна виводиться з написаного міста один раз, при збереженні
                  профілю. Словник місць росте — і кожен, хто написав місто
                  раніше, лишається без країни, поки його не перерахують. */}
              <form action={recountCountries} className="mt-3">
                <button className="btn btn-quiet px-3 py-2 text-xs">
                  Перерахувати країни з написаних міст
                </button>
              </form>
            </div>

            {boardGroups.length > 0 && (
              <div className="card mt-3 overflow-x-auto">
                <table className="board">
                  <thead>
                    <tr><th>країна</th><th>дошка</th><th>стан</th><th className="num">рубрик</th>
                        <th className="num">вакансій</th><th /></tr>
                  </thead>
                  <tbody>
                    {boardGroups.map((g) => {
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
                 lede="Долари за таблицею цін Anthropic; прогноз — середнє за тиждень × 30.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Tile n={usd(spend?.usdToday ?? 0)} label="сьогодні" />
              <Tile n={usd(spend?.usdWeek ?? 0)} label="за 7 днів" />
              <Tile n={usd(spend?.usdMonth ?? 0)} label="за 30 днів" />
              <Tile n={usd(((spend?.usdWeek ?? 0) / 7) * 30)} label="прогноз на місяць" />
              <Tile n={spend?.failed ?? 0} label="невдалих звернень" accent={(spend?.failed ?? 0) > 0} />
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              {(spend?.callsWeek ?? 0) === 0
                ? "За тиждень модель не викликалась."
                : `${num(spend?.calls ?? 0)} звернень сьогодні, ${num(spend?.callsWeek ?? 0)} за тиждень.`}
            </p>
          </Block>

          
          <Block id="releases" title="Історія версій"
                 lede="Що змінилося для людей. Збирається з комітів, службові — мерджі, документація, перегенерації — відсіяні.">
            <div className="ruled card">
              {RELEASES.slice(0, 7).map((r, i) => (
                <details key={r.date} className="px-6 py-4" open={i === 0}>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4">
                    <span className="mono text-sm" style={{ color: "var(--ember)" }}>{r.date}</span>
                    <span className="text-sm">{r.changes.length} змін</span>
                    <span className="text-sm" style={{ color: "var(--muted)" }}>{r.changes[0].subject}</span>
                  </summary>
                  {/* Довгий день згортаємо до шести рядків: історія версій —
                      це «що змінилось для людей», а не журнал роботи. Решта
                      лишається на відстані одного кліку. */}
                  <ul className="mt-3 flex flex-col gap-1">
                    {r.changes.slice(0, KEY_CHANGES).map((c) => (
                      <li key={c.hash} className="flex gap-3 text-sm">
                        <span className="mono text-xs" style={{ color: "var(--muted)" }}>{c.hash}</span>
                        <span style={{ color: "var(--ink-2)" }}>{c.subject}</span>
                      </li>
                    ))}
                  </ul>
                  {r.changes.length > KEY_CHANGES && (
                    <details className="mt-3">
                      <summary className="mono cursor-pointer text-xs" style={{ color: "var(--ember)" }}>
                        ще {r.changes.length - KEY_CHANGES}
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {r.changes.slice(KEY_CHANGES).map((c) => (
                          <li key={c.hash} className="flex gap-3 text-sm">
                            <span className="mono text-xs" style={{ color: "var(--muted)" }}>{c.hash}</span>
                            <span style={{ color: "var(--ink-2)" }}>{c.subject}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {r.chores > 0 && (
                    <p className="mono mt-3 text-xs" style={{ color: "var(--faint)" }}>
                      і ще {r.chores} службових: мерджі, документація, перегенерація цього списку
                    </p>
                  )}
                </details>
              ))}
            </div>
          </Block>

        </div>
      </main>
    </>
  );
}
