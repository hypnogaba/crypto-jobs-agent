/**
 * Ранкова добірка: підбір, оформлення, доставка.
 * Запускається щогодини — обслуговує тих, у кого настала обрана година,
 * і надолужує тих, кого попередній прогін того ж дня пропустив.
 *
 *   node dist/digest.js [--force] [--user <id>] [--requests-only]
 *
 * --requests-only — швидкий шлях для кнопки «Ще п'ять»: лише відкриті
 * delivery_requests, без прив'язки до години й дня тижня. Таймер ганяє його
 * кожні дві хвилини, тому перший запит — один дешевий SELECT, і без запитів
 * процес одразу виходить.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { explainWithClaude, pickTop, type CandidateJob, type Profile } from "./match.js";
import { asLocale, salaryLine, say, thin, type Locale } from "./digest-copy.js";
import { summarize } from "./summary.js";
import { extractSalary, type Salary } from "./salary.js";
import { applyTranslations, d1Store, translateJobs } from "./translate.js";

const DIGEST_SIZE = 5;

/** Стеля вакансій на одну людину за її локальну добу: планова + «ще п'ять». */
export const DAILY_CAP = 20;

/** Куди веде «Податися»: маршрут сайту без входу, який лишає слід і редіректить. */
const APPLY_BASE = "https://nextrole.info/go/";

export interface UserRow {
  id: string; telegram_chat_id: string | null; locale: string;
  timezone: string; delivery_hour: number; status: string; last_interaction_at: string | null;
  spheres: string; industries: string; seniority: string | null;
  remote_mode: string; location: string | null; salary_min: number | null;
  country: string | null;
  custom_role: string | null;
  wishes: string | null;
  seniority_weight: number | null;
  location_weight: number | null;
  salary_weight: number | null;
}

const list = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Котра зараз година в поясі людини. Без цього «07:00» безглузде для світу. */
export function hourIn(timezone: string, now: Date): number {
  try {
    return Number.parseInt(new Intl.DateTimeFormat("en-GB",
      { timeZone: timezone, hour: "2-digit", hour12: false }).format(now), 10);
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Чи робочий день зараз у поясі людини.
 *
 * Планова добірка йде лише пн–пт: у суботу вранці ніхто не хоче вакансій, а
 * дошки за вихідні майже не оновлюються. День тижня беремо в її поясі — у
 * Сіднеї субота настає, коли в Парижі ще п'ятниця.
 */
export function isWeekdayIn(timezone: string, now: Date): boolean {
  let day: string;
  try {
    day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  } catch {
    day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(now);
  }
  return day !== "Sat" && day !== "Sun";
}

/** Сьогоднішня дата в поясі людини, YYYY-MM-DD. */
export function localDate(timezone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** D1 пише created_at як «YYYY-MM-DD HH:MM:SS» в UTC, без літери Z. */
export const parseDbTime = (raw: string): Date =>
  new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");

/** Чи була в людини добірка (будь-якого статусу) її локального сьогодні. */
export function hadDigestToday(timezone: string, now: Date, createdAts: string[]): boolean {
  const today = localDate(timezone, now);
  return createdAts.some((t) => localDate(timezone, parseDbTime(t)) === today);
}

/**
 * Чи пора слати планову добірку.
 *
 * Рівно в обрану годину — завжди, як і було. Пізніше того самого дня — лише
 * якщо сьогодні добірки ще не було: так упалий прогін о 9:00 надолужується
 * о 10:00, а не через добу. Раніше строге «===» означало, що одна мережева
 * помилка в потрібну годину викреслювала людину на 24 години.
 */
export function isDue(
  u: { timezone: string; delivery_hour: number }, now: Date, alreadyToday: boolean
): boolean {
  const h = hourIn(u.timezone, now);
  if (h === u.delivery_hour) return true;
  return h > u.delivery_hour && !alreadyToday;
}

/**
 * Рядки sent зі статусом sent, доставлені локального сьогодні.
 *
 * Це і лічильник денної стелі, і основа правила «одна планова на день».
 * sent_at пишеться ISO-рядком із Z (див. UPDATE нижче), created_at — форматом
 * D1 без Z; parseDbTime розуміє обидва.
 */
export function sentToday(
  timezone: string, now: Date, rows: Array<{ sent_at: string | null; status: string }>
): Array<{ sent_at: string }> {
  const today = localDate(timezone, now);
  return rows
    .filter((r): r is { sent_at: string; status: string } => r.status === "sent" && !!r.sent_at)
    .filter((r) => localDate(timezone, parseDbTime(r.sent_at)) === today);
}

/** Скільки ще вакансій можна надіслати сьогодні. Не менше нуля. */
export function remainingToday(deliveredToday: number, cap = DAILY_CAP): number {
  return Math.max(0, cap - deliveredToday);
}

/**
 * Чи планова добірка сьогодні вже була.
 *
 * Правило «одна планова на день»: окремої колонки в sent немає, тому
 * виводимо з наявних даних. Доставка на запит «Ще п'ять» закриває
 * delivery_requests тим самим викликом, що ставить sent_at, — тож рядок
 * sent, біля якого (± дві хвилини) є handled_at запиту, вважаємо запитом.
 * Будь-який інший сьогоднішній рядок зі статусом sent — планова добірка
 * (або дотиснута відкладена, що для людини те саме), і другої не буде.
 */
export function scheduledServedToday(
  timezone: string, now: Date,
  rows: Array<{ sent_at: string | null; status: string }>,
  requestHandledAts: string[],
): boolean {
  const handled = requestHandledAts.map((t) => parseDbTime(t).getTime());
  return sentToday(timezone, now, rows).some((r) => {
    const t = parseDbTime(r.sent_at).getTime();
    return !handled.some((h) => Math.abs(h - t) <= 120_000);
  });
}

/** Через скільки діб відкладену добірку перестаємо дотискати. */
const PENDING_MAX_DAYS = 2;

/**
 * Відкладена добірка, яку вже не варто дотискати.
 *
 * Людина заблокувала бота — Telegram відповідає 403 на кожну спробу, і без
 * цієї межі один pending-рядок щодня йшов на повтор і водночас блокував
 * новий підбір назавжди. Окремого лічильника спроб у sent немає; вік рядка
 * при щогодинному прогоні — той самий лічильник, лише чесніший.
 */
export function pendingIsStale(createdAt: string, now: Date): boolean {
  return now.getTime() - parseDbTime(createdAt).getTime() > PENDING_MAX_DAYS * 86_400_000;
}

/**
 * Опис для тих вакансій, у яких його ще немає.
 *
 * Ashby і Lever віддають текст разом зі списком, тому в них summary вже
 * заповнений на скані. Greenhouse віддає його лише за ?content=true, що
 * роздуває масовий скан у 21 раз — тому платимо поштучно і лише за ті
 * ≤5 вакансій, які справді йдуть людині.
 *
 * Джерело впало — лишаємо порожньо. Картка просто буде без опису.
 */
/**
 * Де взяти текст оголошення поштучно.
 *
 * Список джерел, які НЕ віддають опис разом зі списком вакансій. Ashby,
 * Lever і Workable його вже приносять, тому в них summary заповнений ще
 * на скані. Greenhouse віддає лише за ?content=true, що роздуває масовий
 * скан у 21 раз; Rippling і SmartRecruiters у списку опису не мають зовсім.
 *
 * Тому платимо поштучно і лише за ті ≤5 вакансій, що справді йдуть людині.
 */
const LAZY: Array<{
  re: RegExp;
  api: (m: RegExpExecArray) => string;
  pick: (body: unknown) => string | null;
}> = [
  {
    re: /^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/,
    api: (m) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(m[1]!)}/jobs/${m[2]}`,
    pick: (b) => (b as { content?: string }).content ?? null,
  },
  {
    re: /^https?:\/\/ats\.rippling\.com\/([^/]+)\/jobs\/([0-9a-f-]+)/i,
    api: (m) => `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(m[1]!)}/jobs/${m[2]}`,
    // description — це НЕ рядок, а { company, role }. Беремо role і блурб
    // компанії навіть не бачимо.
    pick: (b) => (b as { description?: { role?: string } }).description?.role ?? null,
  },
  {
    // SmartRecruiters сам відділяє опис ролі від блурбу компанії, тож
    // беремо саме jobDescription і не покладаємось на евристику.
    re: /^https?:\/\/jobs\.smartrecruiters\.com\/([^/]+)\/([^/?#]+)/,
    api: (m) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(m[1]!)}/postings/${encodeURIComponent(m[2]!)}`,
    pick: (b) => {
      const secs = (b as { jobAd?: { sections?: Record<string, { text?: string }> } }).jobAd?.sections;
      if (!secs) return null;
      return [secs.jobDescription?.text, secs.qualifications?.text].filter(Boolean).join("\n\n") || null;
    },
  },
];

/**
 * Опис для тих вакансій, у яких його ще немає.
 *
 * Джерело впало або невідоме — лишаємо порожньо. Картка просто буде без
 * опису: заголовок, локація й чіпи на місці.
 */
/** Чи вміємо ми взяти текст цього оголошення поштучно. */
export const hasLazyDescription = (url: string): boolean => LAZY.some((src) => src.re.test(url));

/**
 * Повний текст оголошення поштучно. null — джерело невідоме, впало або
 * тексту не має. Ніколи не кидає.
 */
export async function fetchDescription(url: string): Promise<string | null> {
  for (const src of LAZY) {
    const m = src.re.exec(url);
    if (!m) continue;
    try {
      const res = await fetch(src.api(m), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      return src.pick(await res.json());
    } catch { return null; }
  }
  return null;
}

export async function fillMissingSummaries(
  jobs: Array<{ id: string; url: string; company: string; summary: string | null }>,
  /** Сюди складається вилка, знайдена в повному тексті: другого шансу її побачити не буде. */
  salaries?: Map<string, Salary>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const j of jobs) {
    if (j.summary) { out.set(j.id, j.summary); continue; }
    if (!hasLazyDescription(j.url)) continue;
    const text = await fetchDescription(j.url);
    const s = summarize(text, j.company);
    if (s) out.set(j.id, s);
    const sal = extractSalary(text);
    if (sal && salaries) salaries.set(j.id, sal);
  }
  return out;
}

/** Стеля Telegram на одне повідомлення. Довше — 400 Bad Request, а не обрізка. */
export const TELEGRAM_MAX = 4096;

/**
 * Наша власна стеля, з запасом під HTML-теги й кнопки. Довше — спершу
 * прибираємо описи, потім хвіст. Так добірка ніколи не застрягне як
 * «невідправна» через один довгий опис із Workable.
 */
export const DIGEST_MAX = 3900;

/**
 * Скільки символів опису вміщається на одну вакансію.
 *
 * П'ять карток, кожна із заголовком, фактами й посиланням (≈250 символів
 * службового тексту), плюс привітання й підсумок — на опис лишається
 * приблизно 500. Витяг зазвичай коротший, але Workable інколи віддає
 * абзац на тисячу знаків, і п'ять таких не влазять у 4096.
 */
const SUMMARY_MAX = 500;

export function clampSummary(s: string | null | undefined, max = SUMMARY_MAX): string | null {
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** Останній запобіжник: краще обрізане повідомлення, ніж жодного. */
export function fitTelegram(text: string): string {
  return text.length <= TELEGRAM_MAX ? text : text.slice(0, TELEGRAM_MAX - 1) + "…";
}

/**
 * Екранування для parse_mode=HTML. Telegram знає лише &lt; &gt; &amp; (і
 * &quot; в атрибутах); будь-який неекранований «<» у назві вакансії — це
 * 400 «can't parse entities» на всю добірку.
 */
export function escapeHtml(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Прибрати теги: запасний варіант, коли Telegram не прийняв HTML. */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

export type DigestJob = CandidateJob & {
  why: string; summary?: string | null;
  /** id рядка sent — саме він стоїть у посиланні «Податися». */
  sentId: string;
};

export interface FormatOptions {
  summaries?: boolean;
  /**
   * Добірка коротша за п'ять через денну стелю, а не через брак вакансій.
   * Тоді замість «менше ніж зазвичай» іде чесне «це останні на сьогодні».
   */
  capped?: boolean;
}

export function formatDigest(
  jobs: DigestJob[], locale: Locale, opts: FormatOptions = {}
): string {
  const withSummaries = opts.summaries ?? true;
  const lines = [escapeHtml(say(locale, "greeting")), ""];
  jobs.forEach((j, i) => {
    if (i > 0) { lines.push("─────────────"); lines.push(""); }

    // Компанія окремим рядком: очі шукають саме її, а не назву посади.
    lines.push(`${i + 1}. <b>${escapeHtml(j.company)}</b>`);
    lines.push(escapeHtml(j.title));

    // Другий рядок збираємо лише з того, що справді відоме. «Вилку не вказано»
    // п'ять разів поспіль — це не інформація, а шум: у першій справжній
    // добірці так було в усіх п'яти вакансіях.
    const facts = [
      j.location ?? (j.remote ? say(locale, "remote") : null),
      j.remote && j.location ? say(locale, "remote") : null,
      salaryLine(locale, j.salaryMin, j.salaryMax, j.salaryCurrency),
    ].filter(Boolean) as string[];
    if (facts.length) lines.push(escapeHtml(facts.join(" · ")));

    lines.push("");
    // Опис самої вакансії. Рядок «чому ти» був однаковий на всі п'ять
    // позицій, бо будувався з профілю, а профіль один. Старі добірки
    // опису не мають — для них лишається попередній рядок.
    const summary = withSummaries ? clampSummary(j.summary) : null;
    if (summary) lines.push(escapeHtml(summary));
    else lines.push(`${escapeHtml(say(locale, "why"))}: ${escapeHtml(j.why)}`);
    lines.push("");
    // Посилання веде через сайт: один клік і відкриває роботодавця, і лишає
    // слід «подався» у кабінеті. Тому в href — id рядка sent, а не URL.
    lines.push(`<a href="${APPLY_BASE}${encodeURIComponent(j.sentId)}">${escapeHtml(say(locale, "apply"))}</a>`);
    lines.push("");
  });
  if (jobs.length < DIGEST_SIZE) {
    lines.push("─────────────");
    lines.push("");
    lines.push(escapeHtml(opts.capped ? say(locale, "capLast") : thin(locale, jobs.length, DIGEST_SIZE)));
  }
  return lines.join("\n").replace(/\n+$/, "");
}

/**
 * Добірка, що гарантовано влазить у DIGEST_MAX.
 *
 * Порядок поступок: спершу описи (їх нема в старих добірках, і без них
 * картка все ще повна), потім останні картки по одній. Рвати текст посеред
 * HTML-тегу не можна — Telegram відповість 400, і добірка застрягне.
 */
export function fitDigest(
  jobs: DigestJob[], locale: Locale, max = DIGEST_MAX, opts: Omit<FormatOptions, "summaries"> = {}
): string {
  const full = formatDigest(jobs, locale, opts);
  if (full.length <= max) return full;
  let rest = jobs;
  while (rest.length > 0) {
    const text = formatDigest(rest, locale, { ...opts, summaries: false });
    if (text.length <= max) return text;
    rest = rest.slice(0, -1);
  }
  return fitTelegram(formatDigest([], locale, { ...opts, summaries: false })).slice(0, max);
}

/**
 * Картки мовою людини: назва й опис — перекладені, компанія — ні.
 *
 * Без ANTHROPIC_API_KEY або для англійської повертає ті самі об'єкти:
 * поведінка байт у байт як до появи перекладу. Збій — оригінал.
 */
export async function localizeJobs(jobs: DigestJob[], locale: Locale, ctx: RunContext): Promise<DigestJob[]> {
  if (locale === "en" || !ctx.cfg.anthropicApiKey) return jobs;
  const tr = await translateJobs(
    jobs.map((j) => ({ id: j.id, title: j.title, summary: j.summary ?? null })),
    locale, ctx.cfg.anthropicApiKey, d1Store(ctx.d1),
    { onUsage: (u) => logUsage(ctx.d1, "translate", u) });
  return applyTranslations(jobs, tr);
}

/** Облік викликів моделі. Не має права зламати доставку: впав запис — добірка все одно йде. */
async function logUsage(
  d1: D1Client, operation: string, u: { model: string; inputTokens: number; outputTokens: number; ok: boolean },
): Promise<void> {
  try {
    await d1.execute(
      `INSERT OR IGNORE INTO api_usage (id,service,operation,model,input_tokens,output_tokens,cost_usd,ok)
       VALUES (?,'anthropic',?,?,?,?,0,?)`,
      [crypto.randomUUID(), operation, u.model, u.inputTokens, u.outputTokens, u.ok ? 1 : 0]);
  } catch { /* журнал не важливіший за доставку */ }
}

/**
 * Надіслати в Telegram. Ніколи не кидає.
 *
 * Без try/catch один обрив мережі на одній людині валив увесь щогодинний
 * прогін: решта користувачів лишалась без добірки, а cron не знав чому.
 * Тепер збій — це просто false і рядок у журналі, разом із причиною з
 * e.cause, бо саме там undici ховає ECONNRESET чи ENOTFOUND.
 */
export interface SendResult { ok: boolean; status: number | null }

/** 403 від Telegram означає «людина заблокувала бота». Слати далі нікуди. */
export const isBlocked = (r: SendResult): boolean => r.status === 403;

export async function sendTelegram(
  token: string, chatId: string, text: string, digestId: string, locale: Locale,
  fetchImpl: typeof fetch = fetch
): Promise<SendResult> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        chat_id: chatId, text: fitTelegram(text), disable_web_page_preview: true,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[
          { text: say(locale, "notRelevant"), callback_data: `fb:${digestId}:not_relevant` },
          { text: say(locale, "more"), callback_data: `fb:${digestId}:more` },
        ]] },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`  telegram ${chatId.slice(0, 6)}…: HTTP ${res.status} ${body.slice(0, 200)}`);
      // HTML не пройшов — шлемо той самий текст без тегів. Гірша картка
      // краща за добірку, що застрягла назавжди.
      if (res.status === 400 && /parse entities/i.test(body)) {
        const plain = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            chat_id: chatId, text: fitTelegram(stripHtml(text)), disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[
              { text: say(locale, "notRelevant"), callback_data: `fb:${digestId}:not_relevant` },
              { text: say(locale, "more"), callback_data: `fb:${digestId}:more` },
            ]] },
          }),
        });
        return { ok: plain.ok, status: plain.status };
      }
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.log(`  telegram ${chatId.slice(0, 6)}…: ${describeError(e)}`);
    return { ok: false, status: null };
  }
}

/** Повідомлення разом із причиною: у fetch вона живе в e.cause. */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? cause.message : cause ? String(cause) : null;
  return causeText ? `${e.message} (${causeText})` : e.message;
}

/**
 * Розбір аргументів.
 *
 * Написане навпростець `argv[argv.indexOf("--user") + 1]` тихо ламало все:
 * без прапорця indexOf дає −1, тож onlyUser ставав argv[0] — шляхом до node.
 * Значення непорожнє, тому кожен плановий прогін звужувався до
 * `u.id = '/usr/local/bin/node'` і не знаходив нікого. Добірки не доходили
 * взагалі, і жодної помилки при цьому не було.
 */
export function parseArgs(argv: string[]): { force: boolean; onlyUser: string | null; requestsOnly: boolean } {
  const i = argv.indexOf("--user");
  return {
    force: argv.includes("--force"),
    onlyUser: i === -1 ? null : argv[i + 1] ?? null,
    requestsOnly: argv.includes("--requests-only"),
  };
}

export interface RunContext {
  d1: D1Client;
  cfg: ReturnType<typeof loadConfig>;
  now: Date;
  botToken: string | null;
  force: boolean;
  requested: Set<string>;
  delivered: number;
}

/** Закрити всі відкриті запити «ще» цієї людини. */
async function closeRequests(d1: D1Client, userId: string): Promise<void> {
  await d1.execute(
    "UPDATE delivery_requests SET handled_at=datetime('now') WHERE user_id=? AND handled_at IS NULL",
    [userId]);
}

export async function deliverTo(u: UserRow, ctx: RunContext): Promise<void> {
  const { d1, cfg, now, botToken, force } = ctx;
  const onRequest = ctx.requested.has(u.id);
  const locale = asLocale(u.locale);
  const canSend = Boolean(botToken && u.telegram_chat_id);
  // Людина заблокувала бота: слати нікуди, підбирати нове — марно палити вакансії.
  const pauseBlocked = async () => {
    await d1.execute("UPDATE users SET status='paused', paused_reason='blocked' WHERE id=?", [u.id]);
    console.log(`  ${u.id.slice(0, 8)}: бот заблокований (403), пауза`);
  };

  // Що вже було за останні дві доби: і для розкладу, і для денної стелі.
  const recent = await d1.query<{ created_at: string; sent_at: string | null; status: string }>(
    "SELECT created_at, sent_at, status FROM sent WHERE user_id=? AND created_at >= datetime('now','-2 day')", [u.id]);
  const deliveredToday = sentToday(u.timezone, now, recent).length;

  // ── Спершу дотиснути непроставлене ──
  // Запис зі статусом pending означає «підібрано, але не доставлено».
  // Без цієї гілки такі рядки блокували б вакансію назавжди: вона вже в sent,
  // тому в шортліст більше не потрапляє, а людина її так і не побачила.
  //
  // Це йде ПЕРЕД перевіркою години навмисно. Людина з сайту отримала
  // pending-добірку об 11:00, о пів на дванадцяту прив'язала Telegram —
  // і за розкладом «сьогодні вже було», тож без цього добірка дійшла б
  // лише завтра.
  //
  // Для людини без Telegram pending — це нормальний кінцевий стан: добірка
  // лежить у кабінеті на сайті, і дотискати її нікуди.
  const pending = await d1.query<{ digest_id: string; created_at: string }>(
    `SELECT digest_id, MIN(created_at) AS created_at FROM sent
     WHERE user_id=? AND status='pending' GROUP BY digest_id ORDER BY created_at LIMIT 1`, [u.id]);
  const stale = pending.length > 0 && pendingIsStale(pending[0]!.created_at, now);

  if (pending.length > 0 && canSend && !stale) {
    const digestId = pending[0]!.digest_id;
    const rows2 = await d1.query<{ sent_id: string; job_id: string; company: string; title: string; location: string | null; remote: number;
      url: string; why_fits: string; salary_min: number | null; salary_max: number | null; salary_currency: string | null;
      summary: string | null }>(
      `SELECT s.id AS sent_id,j.id AS job_id,j.company,j.title,j.location,j.remote,j.url,s.why_fits,j.salary_min,j.salary_max,j.salary_currency,j.summary
       FROM sent s JOIN jobs_cache j ON j.id=s.job_id
       WHERE s.user_id=? AND s.digest_id=?`, [u.id, digestId]);
    const retry: DigestJob[] = rows2.map((r) => ({
      id: r.job_id ?? "", companyKey: "", tags: [], postedAt: null, sentId: r.sent_id,
      company: r.company, title: r.title, location: r.location, remote: r.remote === 1,
      url: r.url, salaryMin: r.salary_min, salaryMax: r.salary_max, salaryCurrency: r.salary_currency,
      why: r.why_fits, summary: r.summary }));
    const sent = await sendTelegram(
      botToken!, u.telegram_chat_id!, fitDigest(await localizeJobs(retry, locale, ctx), locale), digestId, locale);
    if (sent.ok) {
      await d1.execute("UPDATE sent SET status='sent', sent_at=? WHERE digest_id=?", [now.toISOString(), digestId]);
      ctx.delivered++;
      console.log(`  ${u.id.slice(0, 8)}: доставлено відкладену добірку ${digestId.slice(0, 8)}`);
    } else if (isBlocked(sent)) {
      await pauseBlocked();
    }
    // Відкладена добірка і є відповіддю на «ще»: інакше запит лишався б
    // відкритим і на наступному прогоні породив би другу добірку.
    if (onRequest) await closeRequests(d1, u.id);
    return;
  }
  if (pending.length > 0 && !canSend) {
    // Немає куди дотискати (без Telegram або без токена), а добірка вже
    // лежить у кабінеті. Нову щогодини не підбираємо — інакше кабінет
    // заповнювався б відкладеними добірками, доки не скінчаться вакансії.
    if (onRequest) await closeRequests(d1, u.id);
    console.log(`  ${u.id.slice(0, 8)}: відкладена добірка вже лежить у кабінеті, нової не підбираю`);
    return;
  }

  if (!force && !onRequest) {
    // Планова добірка: лише в робочий день, лише раз на день, лише в час.
    if (!isWeekdayIn(u.timezone, now)) return;
    const handled = await d1.query<{ handled_at: string }>(
      "SELECT handled_at FROM delivery_requests WHERE user_id=? AND handled_at >= datetime('now','-2 day')", [u.id]);
    if (scheduledServedToday(u.timezone, now, recent, handled.map((r) => r.handled_at))) return;
    if (!isDue(u, now, hadDigestToday(u.timezone, now, recent.map((r) => r.created_at)))) return;
  }

  // Денна стеля стосується лише «ще п'ять»: планова ранкова добірка — одна
  // й перша, тому їй ліміт не заважає. Запит понад стелю отримує коротке
  // повідомлення замість вакансій і закривається, щоб не висіти.
  const allowance = onRequest ? remainingToday(deliveredToday) : DIGEST_SIZE;
  if (onRequest && allowance === 0) {
    await closeRequests(d1, u.id);
    if (canSend) {
      await sendTelegram(botToken!, u.telegram_chat_id!, escapeHtml(say(locale, "capReached")), "cap", locale);
    }
    console.log(`  ${u.id.slice(0, 8)}: стеля ${DAILY_CAP} на сьогодні вичерпана, запит закрито`);
    return;
  }

  // ── автопауза після 14 днів повної тиші ──
  // Того, хто щойно попросив ще, паузити безглуздо: він якраз активний.
  if (u.last_interaction_at && !onRequest) {
    const silentDays = (now.getTime() - new Date(u.last_interaction_at).getTime()) / 86_400_000;
    if (silentDays > 17) {
      await d1.execute("UPDATE users SET status='paused', paused_reason='inactive' WHERE id=?", [u.id]);
      console.log(`  ${u.id.slice(0, 8)}: пауза після ${Math.round(silentDays)} днів тиші`);
      return;
    }
    if (silentDays > 14 && silentDays <= 15 && canSend) {
      await sendTelegram(botToken!, u.telegram_chat_id!,
        escapeHtml(say(locale, "checkin")), "checkin", locale);
    }
  }

  if (pending.length > 0 && canSend && stale) {
    // Два дні щогодинних спроб — досить. Позначаємо і йдемо підбирати нове.
    await d1.execute("UPDATE sent SET status='failed' WHERE digest_id=? AND status='pending'", [pending[0]!.digest_id]);
    console.log(`  ${u.id.slice(0, 8)}: відкладена добірка ${pending[0]!.digest_id.slice(0, 8)} не доставлена за ${PENDING_MAX_DAYS} дні, позначено failed`);
  }

  const profile: Profile = {
    userId: u.id, spheres: list(u.spheres), industries: list(u.industries),
    customRole: u.custom_role,
    wishes: u.wishes,
    // Вивчене зі скарг. Немає рядка — усі ваги одиничні, поведінка як була.
    tuning: {
      seniority: u.seniority_weight ?? 1,
      location: u.location_weight ?? 1,
      salary: u.salary_weight ?? 1,
    },
    seniority: u.seniority, remoteMode: u.remote_mode, location: u.location, salaryMin: u.salary_min,
    country: u.country,
  };

  // Шортліст: свіже, ще не надіслане цій людині
  const rows = await d1.query<{
    id: string; company: string; company_key: string; title: string; location: string | null;
    remote: number; url: string; tags: string; posted_at: string | null;
    salary_min: number | null; salary_max: number | null; salary_currency: string | null; dedupe_key: string | null;
    summary: string | null;
    source: string; country: string | null;
  }>(
    // Вікно кандидатів. Чотири правила, кожне з реального прогону:
    //
    // 1. Сортуємо за posted_at, а не fetched_at. Скан пише тисячі рядків за
    //    одну хвилину, тож fetched_at у них однаковий — «найсвіжіші 600» це
    //    не свіжість, а довільний зріз.
    // 2. Не більше трьох вакансій на компанію. Без цього одна фірма з великою
    //    дошкою забирає все вікно: lever:jobgether дав 582 рядки з 600, і
    //    правило «одна роль на компанію» лишало від добірки одну вакансію.
    // 3. Не слати те саме за ЗМІСТОМ, а не лише за рядком у базі. Компанія,
    //    що перевиставила вакансію під новим URL, створює новий id — і людина
    //    отримувала б її вдруге. Таких груп у кеші 398.
    // 4. Тільки те, що ми бачили на дошці нещодавно. Кеш нічого не видаляє
    //    (це зламало б каскад sent.job_id і дозволило б повторно надіслати
    //    вакансію), тому мертві просто не потрапляють у вікно. Три доби —
    //    запас на випадок, якщо скан упав на день.
    // 5. Чужу країну відсікаємо ТУТ, а не після відбору. Національні дошки
    //    дають близько шестисот свіжих вакансій на день; відсортовані за
    //    posted_at, вони заповнили б вікно з 1200 і випали б аж на підборі,
    //    лишивши людину з іншої країни майже без кандидатів. Це та сама
    //    пастка, що колись із lever:jobgether, тільки з іншого боку.
    `SELECT * FROM (
       SELECT j.*, ROW_NUMBER() OVER (
         PARTITION BY j.company_key ORDER BY j.posted_at DESC, j.fetched_at DESC
       ) AS rn
       FROM jobs_cache j
       WHERE j.id NOT IN (SELECT job_id FROM sent WHERE user_id = ?)
         AND j.dedupe_key NOT IN (
           SELECT dedupe_key FROM sent WHERE user_id = ? AND dedupe_key IS NOT NULL)
         AND j.fetched_at >= datetime('now', '-3 day')
         AND (j.country IS NULL OR j.country = ?)
     )
     WHERE rn <= 3
     ORDER BY posted_at DESC, fetched_at DESC
     LIMIT 1200`, [u.id, u.id, u.country]);

  // Ключ змісту не входить у CandidateJob — тримаємо збоку до запису в sent.
  const dedupeById = new Map(rows.map((r) => [r.id, r.dedupe_key ?? null]));

  const candidates: CandidateJob[] = rows.map((r) => ({
    id: r.id, company: r.company, companyKey: r.company_key, title: r.title,
    location: r.location, remote: r.remote === 1, url: r.url, tags: list(r.tags),
    postedAt: r.posted_at, salaryMin: r.salary_min, salaryMax: r.salary_max, salaryCurrency: r.salary_currency,
    summary: r.summary,
    source: r.source, country: r.country,
  }));

  // На запит — не більше, ніж лишилось до денної стелі.
  const top = pickTop(candidates, profile, Math.min(DIGEST_SIZE, allowance), now);
  if (top.length === 0) {
    // Запит закриваємо навіть без результату — інакше він висітиме вічно
    if (onRequest) {
      await closeRequests(d1, u.id);
      if (botToken && u.telegram_chat_id) {
        await sendTelegram(botToken, u.telegram_chat_id,
          escapeHtml(say(locale, "nothingNew")), "none", locale);
      }
    }
    console.log(`  ${u.id.slice(0, 8)}: нічого не підійшло`);
    return;
  }

  const why = await explainWithClaude(top, profile, cfg.anthropicApiKey, undefined,
    (u) => logUsage(d1, "match_reason", u), locale);
  const digestId = crypto.randomUUID();

  // Вилка з повного тексту — лише для тих, у кого її ще немає: повний текст
  // ми бачимо тільки тут, поштучно, і в базу він не потрапляє.
  const salaries = new Map<string, Salary>();
  const summaries = await fillMissingSummaries(
    top.map((j) => ({ id: j.id, url: j.url, company: j.company, summary: j.summary ?? null })), salaries);
  const foundSalary = [...salaries.entries()].filter(([id]) => {
    const j = top.find((x) => x.id === id);
    return j && j.salaryMin == null && j.salaryMax == null;
  });
  if (foundSalary.length > 0) {
    await d1.batch(foundSalary.map(([id, s]) => ({
      sql: "UPDATE jobs_cache SET salary_min=?, salary_max=?, salary_currency=? WHERE id=? AND salary_min IS NULL AND salary_max IS NULL",
      params: [s.min, s.max, s.currency, id],
    })));
  }

  // Знайдений опис повертаємо у спільний кеш: наступній людині ця сама
  // вакансія дістанеться вже з описом і без зайвого запиту.
  const fresh = [...summaries.entries()].filter(([id]) => !top.find((j) => j.id === id)?.summary);
  if (fresh.length > 0) {
    await d1.batch(fresh.map(([id, s]) => ({
      sql: "UPDATE jobs_cache SET summary=?, summary_at=datetime('now') WHERE id=? AND summary IS NULL",
      params: [s, id],
    })));
  }

  // id рядка sent народжується тут, до форматування: він стоїть у посиланні
  // «Податися», тож має бути відомий раніше, ніж текст піде в Telegram.
  const withWhy = top.map((j, i) => {
    const sal = j.salaryMin == null && j.salaryMax == null ? salaries.get(j.id) : undefined;
    return {
      ...j, why: why[i]!, summary: summaries.get(j.id) ?? j.summary ?? null,
      salaryMin: sal?.min ?? j.salaryMin, salaryMax: sal?.max ?? j.salaryMax,
      salaryCurrency: sal?.currency ?? j.salaryCurrency,
      sentId: crypto.randomUUID(),
    };
  });

  // Спершу pending, і лише після 200 OK від Telegram — sent. Раніше рядки
  // писались одразу як sent, і якщо процес падав між записом і відправкою,
  // база казала «доставлено» про добірку, якої людина не бачила.
  await d1.batch(withWhy.map((j) => ({
    // OR IGNORE: D1 повторює запити, і таймаут після коміту дав би конфлікт
    // ключа на другій спробі.
    sql: `INSERT OR IGNORE INTO sent (id,user_id,job_id,digest_id,why_fits,match_facts,status,sent_at,dedupe_key)
          VALUES (?,?,?,?,?,?,'pending',NULL,?)
          ON CONFLICT(user_id,job_id) DO NOTHING`,
    params: [j.sentId, u.id, j.id, digestId, j.why, JSON.stringify(j.facts),
             dedupeById.get(j.id) ?? null],
  })));

  // Менше за п'ять через стелю — не «тонкий день», а «решта завтра».
  const capped = onRequest && allowance < DIGEST_SIZE;
  const text = fitDigest(await localizeJobs(withWhy, locale, ctx), locale, DIGEST_MAX, { capped });
  if (botToken && u.telegram_chat_id) {
    const sent = await sendTelegram(botToken, u.telegram_chat_id, text, digestId, locale);
    if (!sent.ok) {
      if (isBlocked(sent)) await pauseBlocked();
      else console.log(`  ${u.id.slice(0, 8)}: доставка не вдалась, спробуємо наступного прогону`);
      return;
    }
    await d1.execute("UPDATE sent SET status='sent', sent_at=? WHERE digest_id=?", [now.toISOString(), digestId]);
    ctx.delivered++;
    if (onRequest) await closeRequests(d1, u.id);
    console.log(`  ${u.id.slice(0, 8)}: надіслано ${withWhy.length}${onRequest ? " (на запит)" : ""}`);
  } else {
    // Немає куди слати — добірка вже в кабінеті як pending. Запит «ще» треба
    // закрити й тут: інакше він лишався відкритим і щогодини породжував нову
    // добірку для людини без Telegram — доти, доки не закінчились вакансії.
    if (onRequest) await closeRequests(d1, u.id);
    console.log(`  ${u.id.slice(0, 8)}: підібрано ${withWhy.length}, ${
      u.telegram_chat_id ? "доставка чекає на токен бота" : "лежить у кабінеті"}${onRequest ? " (на запит)" : ""}`);
    if (process.env.PRINT_DIGEST) console.log("\n" + text + "\n");
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { force, onlyUser, requestsOnly } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? null;

  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  // Хто натиснув «Ще п'ять»: їм добірка йде поза розкладом — будь-якого дня
  // і будь-якої години. Це перший і найдешевший запит: у режимі
  // --requests-only без відкритих запитів далі нічого не робимо.
  const requested = new Set((await d1.query<{ user_id: string }>(
    "SELECT DISTINCT user_id FROM delivery_requests WHERE handled_at IS NULL"
  )).map((r) => r.user_id));
  if (requested.size > 0) console.log(`Запитів «ще»: ${requested.size}`);
  if (requestsOnly && requested.size === 0) return;

  const where = ["u.status = 'active'"];
  const params: unknown[] = [];
  if (onlyUser) { where.push("u.id = ?"); params.push(onlyUser); }
  if (requestsOnly) {
    where.push(`u.id IN (${[...requested].map(() => "?").join(",")})`);
    params.push(...requested);
  }
  const users = await d1.query<UserRow>(
    `SELECT u.*, p.spheres,p.industries,p.seniority,p.remote_mode,p.location,p.salary_min,p.custom_role,p.country,
            p.wishes,
            t.seniority_weight,t.location_weight,t.salary_weight
     FROM users u JOIN profiles p ON p.user_id = u.id
     LEFT JOIN user_tuning t ON t.user_id = u.id
     WHERE ${where.join(" AND ")}`, params);

  const ctx: RunContext = { d1, cfg, now, botToken, force, requested, delivered: 0 };
  for (const u of users) {
    // Одна людина не має права зупинити решту: збій — у журнал і далі.
    try {
      await deliverTo(u, ctx);
    } catch (e) {
      console.log(`  ${u.id.slice(0, 8)}: збій, пропускаю — ${describeError(e)}`);
    }
  }

  console.log(`Добірка: оброблено ${users.length} профілів, доставлено ${ctx.delivered}.`);
}

if (process.argv[1]?.endsWith("digest.js")) await main();
