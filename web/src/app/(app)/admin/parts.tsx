import Link from "next/link";
import { num } from "./vocab";

/**
 * Складники панелі: блок, ім'я людини, плитка, іскра, лійка.
 *
 * Усе тут малює те, що йому передали, і нічого не питає в бази. Саме тому
 * воно й винесено: у сторінці лишились запити й розкладка, а не пікселі.
 */

/** Блок. Одна відповідь на одне питання, з підписом, навіщо він тут. */
export function Block({ id, title, lede, right, children }: {
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
export function Person({ nick, name, id }: { nick: string | null; name: string | null; id: string | null }) {
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
 * Плитка. З `href` — посилання на свій блок, і тоді вона поводиться як
 * посилання: рамка теплішає, з'являється стрілка, під числом сказано КУДИ
 * веде клік.
 *
 * Числа вгорі сторінки і були питаннями до блоків нижче — «дев'ять зламано»
 * має сенс лише разом зі списком, які саме. Досі це були мертві плашки, і
 * дорогу до відповіді доводилось шукати гортанням.
 */
export function Tile({ n, label, accent = false, href, to }:
  { n: number | string; label: string; accent?: boolean; href?: string; to?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="mono text-2xl leading-none" style={{ color: accent ? "var(--bad)" : "var(--ember)" }}>
          {typeof n === "number" ? num(n) : n}
        </div>
        {href && (
          <svg className="tile-go" width="16" height="16" viewBox="0 0 16 16" fill="none"
               stroke={accent ? "var(--bad)" : "var(--ember)"} strokeWidth="1.5"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        )}
      </div>
      <div className="eyebrow mt-2" style={accent ? { color: "var(--bad)" } : undefined}>{label}</div>
      {to && <div className="mt-1 text-xs" style={{ color: "var(--faint)" }}>{to}</div>}
    </>
  );
  if (!href) return <div className="card px-5 py-4">{body}</div>;
  return (
    <Link href={href} className="tile-link card block px-5 py-4"
          style={accent ? { borderColor: "color-mix(in srgb, var(--bad) 35%, transparent)" } : undefined}>
      {body}
    </Link>
  );
}

/**
 * Графік зростання. Форма залежить від того, ЩО це за число.
 *
 * Досі всі чотири картки малювались однаково — стовпчиками, нормованими на
 * пік. Для накопичення це неправда: 13 491 із піку 16 832 давало стовпчик на
 * 80% висоти, хоч «80% чогось» тут не існує. Око читає таку картку як «майже
 * повно», а насправді вона про приріст на чверть.
 *
 * Тому два види марок, і вибір не косметичний:
 *   `total` — накопичення (вакансії, компанії, люди). Лінія з площею: питання
 *     тут про ТРАЄКТОРІЮ, і саме її видно;
 *   `daily` — рахунок за добу (дотики в боті). Стовпчики: кожен день окремий,
 *     і день без жодного дотику мусить читатись нулем, а не пропуском.
 *
 * Шкала більше не таємниця: обидва кінці підписані датою й числом. Раніше
 * єдиним числом на картці був підсумок, тож висота стовпчика ні з чим не
 * порівнювалась.
 */
export function Spark({ points, label, kind = "total" }:
  { points: Array<{ d: string; v: number }>; label: string; kind?: "total" | "daily" }) {
  const vals = points.map((p) => p.v);
  const peak = Math.max(1, ...vals);
  const low = Math.min(...vals);
  const last = points.at(-1)?.v ?? 0;
  // Приріст — від першого дня вікна. Раніше базою було перше НЕнульове
  // значення, тож на графіку з порожнім початком «+909 за 14 дн.» описувало
  // не два тижні, а три дні.
  const base = points[0]?.v ?? 0;
  const delta = last - base;
  const day = (d: string | undefined) => (d ?? "").slice(5).replace("-", ".");

  /**
   * Область значень для лінії — з полем, а не від нуля.
   *
   * Накопичення в 16 832 з початком 13 491 біля нульової осі виглядало б
   * пласкою прямою: уся зміна — чверть верхнього дюйма. Беремо саме той
   * діапазон, у якому величина рухалась, і додаємо 12% поля, щоб лінія не
   * лягала на рамку.
   */
  const pad = Math.max(1, (peak - low) * 0.12);
  const lo = kind === "daily" ? 0 : Math.max(0, low - pad);
  const hi = peak + pad;
  const W = 260, H = 56;
  const at = (i: number) => (points.length === 1 ? W : (i / (points.length - 1)) * W);
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${at(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const gid = `spark-${label.replace(/[^a-zA-Z0-9]/g, "")}`;

  const plot = kind === "daily" ? (
    <div className="spark">
      {points.map((p) => (
        <div key={p.d} className="spark-bar" title={`${p.d} · ${num(p.v)}`}
             style={{ height: p.v === 0 ? "2px" : `${Math.max(6, Math.round((p.v / peak) * 100))}%`,
                      opacity: p.v === 0 ? 0.25 : undefined }} />
      ))}
    </div>
  ) : (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
         style={{ display: "block" }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ember)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--ember)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke="var(--ember)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );

  return (
    <div className="card px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mono text-2xl leading-none" style={{ color: "var(--ember)" }}>{num(last)}</div>
          <div className="eyebrow mt-2">{label}</div>
        </div>
        <span className="tag" style={{ background: delta > 0 ? "var(--ok-soft)" : "var(--surface-2)",
                                       color: delta > 0 ? "var(--ok)" : "var(--muted)" }}>
          {delta > 0 ? "+" : ""}{num(delta)}
        </span>
      </div>

      <div className="mt-3" style={{ borderBottom: "1px solid var(--rule-2)" }}>{plot}</div>
      {/* Обидва кінці підписані. Це і є шкала: без неї висота лінії ні з чим
          не порівнюється, і картка повідомляє лише підсумок, який і так
          написано вище великим кеглем. */}
      <div className="mono mt-1 flex justify-between text-xs" style={{ color: "var(--faint)" }}>
        <span>{day(points[0]?.d)} · {num(base)}</span>
        <span>{day(points.at(-1)?.d)} · {num(last)}</span>
      </div>

      {/* Числа по днях — текстом, а не підказкою.
          `title` спрацьовує лише при НАВЕДЕННІ, а на телефоні наведення не
          існує: там число за день не діставалось узагалі. */}
      <details className="mt-3">
        <summary className="mono list-none text-xs" style={{ cursor: "pointer", color: "var(--muted)" }}>
          числа по днях
        </summary>
        <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--ink-2)" }}>
          {points
            .filter((_, i) => points.length <= 32
              || i % Math.ceil(points.length / 32) === 0
              || i === points.length - 1)
            .map((pt) => <span key={pt.d}>{day(pt.d)} · {num(pt.v)}</span>)}
        </div>
      </details>
    </div>
  );
}

/**
 * Воронка. Смужка міряється від першого щабля, а не від найбільшого: питання
 * тут «скільки дійшло звідти, де всі», і масштаб від максимуму це б сховав.
 */
export function Funnel({ steps }: { steps: Array<{ label: string; n: number; note: string }> }) {
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
