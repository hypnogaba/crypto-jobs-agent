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
import { affected, notifyOwner } from "./notify.js";
import { retireUnreachable } from "./orphans.js";
import { mapLimit } from "./http.js";
import { countriesOf, hasSearchSignal, meaningfulRoleWords, pickTop, pitchWithClaude, roleText, roleWords,
         type CandidateJob, type Profile } from "./match.js";
import { asLocale, formatWhen, nextDelivery, salaryLine, say, thin, type Locale } from "./digest-copy.js";
import { summarize } from "./summary.js";
import { costUsd } from "./pricing.js";
import { extractSalary, type Salary } from "./salary.js";
import { plausibleSalary } from "./money.js";
import { cachedRoleLines, d1Store, saveRoleLines } from "./roleline.js";

const DIGEST_SIZE = 5;

/** Стеля вакансій на одну людину за її локальну добу: планова + «ще п'ять». */
export const DAILY_CAP = 20;

/** Куди веде «Податися»: маршрут сайту без входу, який лишає слід і редіректить. */
const APPLY_BASE = "https://nextrole.info/go/";

export interface UserRow {
  id: string; telegram_chat_id: string | null; locale: string;
  timezone: string; delivery_hour: number; status: string; last_interaction_at: string | null;
  spheres: string; industries: string;
  remote_mode: string; location: string | null; salary_min: number | null;
  salary_max: number | null;
  level_max: number | null;
  salary_currency: string | null;
  country: string | null;
  custom_role: string | null;
  custom_industry: string | null;
  custom_role_en: string | null;
  custom_industry_en: string | null;
  wishes_en: string | null;
  location_en: string | null;
  cv_highlights: string | null;
  wishes: string | null;
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
 * Лист про збої прогону, або нічого, якщо збоїв не було.
 *
 * `lost` — люди, які чекали добірку саме зараз і не отримали її. `idle` —
 * ті, на кому обробка спіткнулась, хоча прогін і так збирався їх пропустити:
 * їхня година не настала, або вже минула з доставленою добіркою.
 *
 * Розділення не косметичне. 03.09 Cloudflare дві з половиною хвилини віддавав
 * 429 при порожній базі, і лист сказав «добірка впала в 16 з 17 людей».
 * Насправді всі сімнадцять мають годину доставки 9:00, усі шістнадцять уже
 * отримали своє того ранку, а збій стався о 17:05 — тобто не постраждав НІХТО.
 * Лист, який називає аварією день без втрат, привчає не вірити наступному.
 */
export function failureReport(lost: string[], idle: string[], total: number): string | null {
  if (lost.length === 0 && idle.length === 0) return null;
  const head = lost.length > 0
    ? `NextRole: добірка не дійшла до ${affected(lost.length, total)} людей, у кого зараз їхня година.`
    : `NextRole: прогін спіткнувся на ${idle.length} профіл(ях), але жоден із них `
      + `не чекав добірки цієї години. Втрат немає.`;
  // Показуємо ті збої, що коштували добірки; решта — числом.
  const shown = (lost.length > 0 ? lost : idle).slice(0, 8);
  const rest = lost.length + idle.length - shown.length;
  return `${head}\n\n${shown.join("\n")}` + (rest > 0 ? `\n…та ще ${rest}` : "");
}

/**
 * Чи ця людина справді чогось позбулась, коли обробка на ній впала.
 *
 * Точну відповідь дав би запит `recent` (він відрізняє «година минула, але
 * добірка вже була» від «година минула, а добірки не було»), але саме він і
 * падає в такому разі. Тож беремо те, що видно без бази: відкритий запит
 * «ще п'ять» або її власна година прямо зараз.
 */
export function lostDelivery(
  u: { id: string; timezone: string; delivery_hour: number }, now: Date, requested: Set<string>
): boolean {
  return requested.has(u.id) || hourIn(u.timezone, now) === u.delivery_hour;
}

/**
 * Лист про те, що модель мовчала, або нічого.
 *
 * Статус тут не прикраса. 03.09 виклик за картками впав, усі п'ять карток
 * дістали шаблонний рядок, і власник отримав «модель не відповіла 1 раз(и)»
 * без жодної підказки, що робити: 401 означає ключ, 429 — ліміт, 529 —
 * перевантаження на їхньому боці, і дії в цих трьох випадках різні.
 */
export function modelFailReport(statuses: Array<number | undefined>): string | null {
  if (statuses.length === 0) return null;
  const named = statuses.filter((s): s is number => typeof s === "number");
  const seen = [...new Set(named)].sort((a, b) => a - b);
  const what = seen.length > 0 ? ` Статуси: ${seen.join(", ")}.` : "";
  const hint = seen.includes(401) || seen.includes(403)
    ? "Схоже на ключ Anthropic."
    : seen.includes(429)
      ? "Схоже на ліміт запитів."
      : seen.some((s) => s >= 500)
        ? "Збій на боці моделі; повтор уже був і теж не вдався."
        : "Найчастіша причина — ключ Anthropic або ліміт витрат.";
  return `NextRole: модель не відповіла ${statuses.length} раз(и) за прогін.${what}\n\n`
    + `Добірки пішли, але замість пояснень у картках стоїть витяг з оголошення.\n${hint}`;
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

/**
 * Скільки символів на рядок про роль.
 *
 * Промпт просить до 90, але просити — не гарантувати, а два речення тут
 * зайві: далі йде «чому тобі», і разом вони мають читатись за десять секунд.
 */
export const ROLE_LINE_MAX = 160;

/**
 * Витяг перед показом: прибрати маркер, яким він почався в оголошенні.
 *
 * Живий приклад із добірки ffd2deb6: «*Open to hiring remote across the US».
 * Зірочка чи дефіс на початку — це слід списку з оголошення, а в картці вона
 * читається як друкарська помилка.
 */
export const tidySummary = (s: string | null | undefined): string | null =>
  s ? s.replace(/^[\s*•\-–—]+/, "").trim() || null : null;

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
  /**
   * Одне речення про суть роботи мовою людини — те, що модель написала
   * разом із «чому ти». Порожньо — картка починається одразу з «чому тобі».
   */
  roleLine?: string | null;
  /** id рядка sent — саме він стоїть у посиланні «Податися». */
  sentId: string;
  /**
   * Бал збігу. Необов'язковий: відкладені добірки з бази його не мають, і
   * тоді рядок «Збіг …%» просто не друкується — краще без числа, ніж із
   * вигаданим.
   */
  score?: number;
};

export interface FormatOptions {
  summaries?: boolean;
  /**
   * Добірка коротша за п'ять через денну стелю, а не через брак вакансій.
   * Тоді замість «менше ніж зазвичай» іде чесне «це останні на сьогодні».
   */
  capped?: boolean;
  /** Перша доставлена добірка взагалі: дописуємо, коли прийде планова. */
  trialWhen?: string;
  /**
   * Котра година В ЛЮДИНИ, 0–23. Без неї вітаємось по-ранковому — так було
   * завжди, і для планової добірки це правда.
   */
  hour?: number;
}

/**
 * Локація, якою її можна показати.
 *
 * Дошки на кшталт JobStash віддають у полі location весь текст оголошення:
 * «REMOTE (US/Canada/Brazil/Poland/UK/India) Full-time AI Risk Decisioning™
 * platform that helps organizations manage onboarding, fraud, credit…» —
 * і це йшло в картку цілим абзацом англійською, під українським заголовком.
 * У кеші таких рядків близько півтори сотні.
 *
 * Правило просте: локація — це кілька слів. Довше — беремо перше речення, а
 * як і воно завелике, то краще без локації взагалі: поруч є ознака
 * «віддалено», і вона не бреше.
 */
export function tidyLocation(raw: string | null | undefined): string | null {
  // Хвіст пунктуації йде разом із довжиною: Greenhouse віддає «Belgrade,
  // Serbia;» зі списку, і крапка з комою в картці виглядає як обрив рядка.
  const s = (raw ?? "").replace(/\s+/g, " ").trim().replace(/[;,·|\-\s]+$/, "");
  if (!s) return null;
  if (s.length <= LOCATION_MAX) return s;
  const head = s.split(/(?<=[.;!?])\s/)[0]!.trim().replace(/[;,]$/, "");
  return head.length > 0 && head.length <= LOCATION_MAX ? head : null;
}

/** Скільки символів локації ще схожі на локацію, а не на абзац. */
const LOCATION_MAX = 60;

/**
 * Назва компанії без доменного хвоста: «Oscilar.com» → «Oscilar».
 *
 * Джерела з твіттера й агрегаторів кладуть у поле компанії домен. Telegram
 * бачить у ньому адресу і сам робить із назви компанії посилання — на сайт,
 * якого ми не перевіряли й не мали наміру рекомендувати. Посилання в картці
 * рівно одне, і веде воно через наш «Податися».
 */
export function tidyCompany(name: string): string {
  const raw = name.trim();
  const m = /^([\p{L}\d][\p{L}\d&'-]{1,30})\.(?:com|io|net|org|xyz|ai|co|app|info|dev|finance|tech)$/iu.exec(raw);
  const stem = m ? m[1]! : raw;
  // Частина джерел віддає назву ключем з адреси: «jetbrains», «hellofresh».
  // Велика літера не поверне справжнє написання (HelloFresh), але рядок
  // перестає читатись як технічний ідентифікатор.
  return /\p{Lu}/u.test(stem) ? stem : stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * Яке привітання пасує годині.
 *
 * Межі навмисно широкі: «ранок» до одинадцятої накриває планову добірку в
 * будь-якому поясі, а все після сімнадцятої — вечір. Проміжок нейтральний,
 * бо о другій дня «доброго дня» звучить штучно майже всіма мовами, а
 * «привіт» — ні.
 */
export function greetingFor(hour: number | undefined): "greeting" | "greetingDay" | "greetingEvening" {
  if (hour === undefined || !Number.isFinite(hour)) return "greeting";
  if (hour < 11) return "greeting";
  return hour >= 17 ? "greetingEvening" : "greetingDay";
}

export function formatDigest(
  jobs: DigestJob[], locale: Locale, opts: FormatOptions = {}
): string {
  const withSummaries = opts.summaries ?? true;
  const lines = [escapeHtml(say(locale, greetingFor(opts.hour))), ""];
  /**
   * Той самий «Чому тобі» не друкується двічі в одній добірці.
   *
   * Скарга 03.09: «прийшло 5 вакансій і опис усюди однаковий». Так і було, і
   * не через помилку: коли модель не відповідає, рядок збирається локально з
   * фактів ЗБІГУ З ПРОФІЛЕМ, а вони в усіх п'яти однакові за побудовою —
   * усі п'ять збіглися з тією самою людиною тим самим способом.
   *
   * Повторений рядок не несе інформації, він лише займає екран і виглядає як
   * зламаний продукт. Сказане один раз лишається правдою для решти.
   */
  const saidWhy = new Set<string>();
  jobs.forEach((j, i) => {
    if (i > 0) { lines.push("─────────────"); lines.push(""); }

    // Компанія окремим рядком: очі шукають саме її, а не назву посади.
    lines.push(`${i + 1}. <b>${escapeHtml(tidyCompany(j.company))}</b>`);
    lines.push(escapeHtml(j.title));

    // Другий рядок збираємо лише з того, що справді відоме. «Вилку не вказано»
    // п'ять разів поспіль — це не інформація, а шум: у першій справжній
    // добірці так було в усіх п'яти вакансіях.
    const where = tidyLocation(j.location);
    const facts = [
      where ?? (j.remote ? say(locale, "remote") : null),
      j.remote && where ? say(locale, "remote") : null,
      // Відсотка збігу тут більше немає.
      //
      // Він відповідав на питання, якого людина не ставила. Їй потрібно
      // вирішити, подаватись чи ні, а «Збіг 28%» на це не відповідає —
      // лише підриває довіру до вакансії, яку ми самі ж і надіслали. Порядок
      // у добірці вже за спаданням, і цього досить: перша — найкраща з того,
      // що ми знайшли сьогодні. Число ж міряло відстань до нашої власної
      // шкали, а не придатність роботи, і пояснити його в одному рядку
      // неможливо.
      // Неправдоподібну вилку не показуємо взагалі: «від 1 000 USD» під
      // вакансією senior-рівня виглядає як зламаний продукт, і воно ним і є —
      // це або місячна сума, або уламок тексту, який розбір узяв за вилку.
      plausibleSalary(j.salaryMin, j.salaryMax, j.salaryCurrency)
        ? salaryLine(locale, j.salaryMin, j.salaryMax, j.salaryCurrency) : null,
    ].filter(Boolean) as string[];
    if (facts.length) lines.push(escapeHtml(facts.join(" · ")));

    lines.push("");
    // Спершу одне речення про саму роботу, потім — чому вона цій людині.
    //
    // Досі тут стояв або витяг з оголошення, або рядок «чому ти», але
    // ніколи обидва. Виходило дві різні картки в одній добірці: у трьох
    // абзац переказу вакансії, у двох — фраза про профіль. Гірше, витяг
    // жив мовою оголошення, тож українська добірка мала англійські абзаци.
    //
    // Тепер обидва рядки пише модель мовою людини: перший каже, що це за
    // робота, другий — навіщо вона саме їй. Опису бракує (стара добірка,
    // модель без ключа) — лишається сам «чому тобі», і картка все ще ціла.
    /**
     * Рядок про роботу: слова моделі, а без них — витяг із самого оголошення.
     *
     * Витяг лежить у `jobs_cache.summary` і різний у кожної вакансії. У
     * добірці ffd2deb6 він був у трьох вакансіях із п'яти й не показався
     * жодного разу: рядок брався ТІЛЬКИ з моделі, а вона того разу впала.
     * Тобто картка мовчала про роботу, маючи про неї готове речення.
     *
     * Він мовою оголошення, а не людини, і це свідома поступка: англійське
     * речення про цю саму роботу корисніше за порожнє місце під назвою.
     */
    const role = withSummaries
      ? clampSummary(tidySummary(j.roleLine ?? j.summary), ROLE_LINE_MAX) : null;
    if (role) { lines.push(escapeHtml(role)); lines.push(""); }
    const why = j.why?.trim();
    /**
     * Повтор прибираємо, бо він не несе інформації. Але картка, у якої
     * немає НІ витягу, НІ рядка умов, лишилась би самою назвою з посиланням —
     * і тоді повторена причина краща за порожнечу.
     *
     * Рядок умов (локація, віддаленість, вилка) і є тим «що там за умови»,
     * заради чого все це робилось: він різний у кожної вакансії, на відміну
     * від причини збігу з профілем.
     */
    if (why && (!saidWhy.has(why) || (!role && facts.length === 0))) {
      saidWhy.add(why);
      lines.push(`${escapeHtml(say(locale, "why"))}: ${escapeHtml(why)}`);
      lines.push("");
    }
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
  if (opts.trialWhen) {
    lines.push("─────────────");
    lines.push("");
    lines.push(escapeHtml(say(locale, "trialFooter").replace("{when}", opts.trialWhen)));
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
 * Рядок про роль мовою людини, зі спільного кеша.
 *
 * Потрібен там, де моделі не питали: відкладена добірка з бази знає лише
 * `why_fits`, а речення про роль лежить у job_i18n, куди його поклала та
 * добірка, для якої його й написали. Кеш порожній — картка йде без нього.
 */
export async function withRoleLines(jobs: DigestJob[], locale: Locale, ctx: RunContext): Promise<DigestJob[]> {
  const need = jobs.filter((j) => !j.roleLine && j.id).map((j) => j.id);
  if (need.length === 0) return jobs;
  const cached = await cachedRoleLines(need, locale, d1Store(ctx.d1));
  if (cached.size === 0) return jobs;
  return jobs.map((j) => (j.roleLine ? j : { ...j, roleLine: cached.get(j.id) ?? null }));
}

/** Облік викликів моделі. Не має права зламати доставку: впав запис — добірка все одно йде. */
async function logUsage(
  d1: D1Client, operation: string, u: { model: string; inputTokens: number; outputTokens: number; ok: boolean },
): Promise<void> {
  try {
    await d1.execute(
      `INSERT OR IGNORE INTO api_usage (id,service,operation,model,input_tokens,output_tokens,cost_usd,ok)
       VALUES (?,'anthropic',?,?,?,?,?,?)`,
      [crypto.randomUUID(), operation, u.model, u.inputTokens, u.outputTokens,
       costUsd(u.model, u.inputTokens, u.outputTokens), u.ok ? 1 : 0]);
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

/**
 * Рядка «не цікавить · 1 2 3 4 5» більше немає.
 *
 * Задум був добрий: «не те» стосується всіх п'яти вакансій одразу, а дотик по
 * номеру каже, яка саме зайва. На екрані вийшло інше. Підпис у першій комірці
 * обрізається до «Не ц…», і поруч лишається рівний ряд «1 2 3 4 5» — читається
 * як оцінка від одного до п'яти, тобто просять поставити бал добірці. Власник
 * прочитав його саме так, і це не його неуважність: у ряду немає нічого, що
 * підказувало б інше.
 *
 * Приховати окрему вакансію можна в кабінеті, де поруч видно, ЩО саме ховаєш.
 * Під добіркою лишаються дві однозначні кнопки: «не те» і «ще п'ять».
 */
export function hideRow(_sentIds: string[], _locale: Locale): Array<Array<{ text: string; callback_data: string }>> {
  return [];
}

export async function sendTelegram(
  token: string, chatId: string, text: string, digestId: string, locale: Locale,
  fetchImpl: typeof fetch = fetch, sentIds: string[] = []
): Promise<SendResult> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        chat_id: chatId, text: fitTelegram(text), disable_web_page_preview: true,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: hideRow(sentIds, locale).concat([[
          { text: say(locale, "notRelevant"), callback_data: `fb:${digestId}:not_relevant` },
          { text: say(locale, "more"), callback_data: `fb:${digestId}:more` },
        ]]) },
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
  /** Скільки викликів моделі впало за прогін. Ключ скінчився — це видно тут. */
  /**
   * Статуси, з якими модель не відповіла за прогін.
   *
   * Було просто число. 03.09 власник отримав «модель не відповіла 1 раз(и)»
   * і не міг дізнатись причину: ліміт, протермінований ключ і скінчені гроші
   * виглядали однаково, а статус довелось діставати з живої бази вручну.
   */
  modelFails: Array<number | undefined>;
}

/** Закрити всі відкриті запити «ще» цієї людини. */
async function closeRequests(d1: D1Client, userId: string): Promise<void> {
  await d1.execute(
    "UPDATE delivery_requests SET handled_at=datetime('now') WHERE user_id=? AND handled_at IS NULL",
    [userId]);
}

/** Скільки слів своєї ролі беремо в запит. Довша назва — це вже речення. */
const ROLE_WORDS_IN_SQL = 5;

/**
 * Умова «цей рядок узагалі про цю людину», якою вікно кандидатів
 * упорядковується перед зрізом.
 *
 * Беремо рівно ті дві осі, що вирішують у scoreJob: сферу (±6, а без жодного
 * збігу −8) і свою роль (+6). Індустрії сюди не йдуть навмисно — вони важать
 * 2 бали й лишаються справою оцінювача, а тут лише роздули б «своє» до
 * половини кеша й повернули б ту саму втрату вузьких сфер.
 *
 * Порожньо, коли шукати нема за чим: тоді вікно поводиться точно як раніше.
 */
export function onTopicSql(p: Pick<Profile, "spheres" | "customRole" | "customRoleEn">): {
  sql: string; params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const s of p.spheres) {
    // Теги лежать JSON-масивом, тож шукаємо з лапками: інакше «qa» збігалось
    // би зі «security» всередині іншого слова.
    clauses.push("j.tags LIKE ?");
    params.push(`%"${s}"%`);
  }

  const role = roleClauses(p);
  clauses.push(...role.clauses);
  params.push(...role.params);

  if (clauses.length === 0) return { sql: "0", params: [] };
  return { sql: `(CASE WHEN ${clauses.join(" OR ")} THEN 1 ELSE 0 END)`, params };
}

/**
 * Та сама умова, але лише про РОЛЬ, яку людина назвала сама.
 *
 * Винесена окремо, бо вікно кандидатів має ставити ці рядки першими. Причина
 * виміряна 02.09 на живому профілі: людина написала «комуніті менеджер», а в
 * анкеті стоїть ще й сфера «інженерія». Умові вікна відповідало 8 129 свіжих
 * рядків, з них справді community лише 86 — і у вікно з 1 200 найновіших за
 * датою входило ДЕСЯТЬ із них. Тобто 88% єдиних доречних вакансій відпадало
 * ще до оцінювання, хоча в балі роль (12) удвічі важча за сферу (6). У
 * добірку людині йшли Game Designer, QA Engineer і Engineering Manager.
 *
 * Широка сфера завжди дає тисячі рядків, вузька роль — десятки. Сортування
 * за датою між ними не розрізняє, тож роль програвала завжди.
 */
export function roleSql(p: Pick<Profile, "customRole" | "customRoleEn">): {
  sql: string; params: unknown[];
} {
  const { clauses, params } = roleClauses(p);
  if (clauses.length === 0) return { sql: "0", params: [] };
  return { sql: `(CASE WHEN ${clauses.join(" OR ")} THEN 1 ELSE 0 END)`, params };
}

function roleClauses(p: Pick<Profile, "customRole" | "customRoleEn">): {
  clauses: string[]; params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  // Ті самі слова й те саме правило «всі разом», що в matchesCustomRole.
  // Одне джерело правди: roleWords.
  const words = roleWords(roleText(p)).slice(0, ROLE_WORDS_IN_SQL);
  if (words.length > 0) {
    clauses.push(`(${words.map(() => "LOWER(j.title) LIKE ?").join(" AND ")})`);
    params.push(...words.map((w) => `%${w}%`));
  }

  // І окремо — значуще слово ролі саме по собі, щоб у вікно заходили часткові
  // збіги: «Community Growth Coordinator» для «комуніті менеджера».
  //
  // Слова беруться вже без загальних («manager», «senior»): інакше один
  // «менеджер» затягнув би у вікно половину кеша.
  for (const w of meaningfulRoleWords(roleText(p)).slice(0, ROLE_WORDS_IN_SQL)) {
    clauses.push("LOWER(j.title) LIKE ?");
    params.push(`%${w}%`);
  }

  return { clauses, params };
}

/**
 * Що людина сказала про компанії власними діями.
 *
 * «Не цікавить» — мінус, «Податися» — плюс. Обидва сигнали однозначні: це
 * дотик по конкретній вакансії, а не здогад про настрій. Реакцію на добірку
 * цілком («не те») сюди НЕ беремо: вона стосується п'ятьох вакансій одразу й
 * не каже, яка саме була зайвою.
 *
 * Рахуємо за company_key — тим самим, за яким схлопуються геоклони.
 */
export async function companySignals(d1: D1Client, userId: string): Promise<Record<string, number>> {
  const rows = await d1.query<{ company_key: string; signal: number }>(
    `SELECT j.company_key,
            SUM(CASE WHEN s.applied_at IS NOT NULL THEN 1 ELSE 0 END)
          - SUM(CASE WHEN s.hidden_at  IS NOT NULL THEN 1 ELSE 0 END) signal
       FROM sent s JOIN jobs_cache j ON j.id = s.job_id
      WHERE s.user_id = ? AND (s.applied_at IS NOT NULL OR s.hidden_at IS NOT NULL)
      GROUP BY j.company_key HAVING signal <> 0`, [userId]);
  return Object.fromEntries(rows.map((r) => [r.company_key, r.signal]));
}

/** Рядок бази -> профіль для оцінювання. Спільний з прогоном (replay.ts). */
export function profileOf(u: UserRow): Profile {
  return {
    userId: u.id, spheres: list(u.spheres), industries: list(u.industries),
    customRole: u.custom_role,
    customRoleEn: u.custom_role_en,
    customIndustry: u.custom_industry,
    customIndustryEn: u.custom_industry_en,
    cvHighlights: u.cv_highlights,
    wishes: u.wishes,
    salaryMax: u.salary_max,
    levelMax: u.level_max,
    wishesEn: u.wishes_en,
    // Вивчене зі скарг. Немає рядка — усі ваги одиничні, поведінка як була.
    tuning: {
      location: u.location_weight ?? 1,
      salary: u.salary_weight ?? 1,
    },
    remoteMode: u.remote_mode, location: u.location, salaryMin: u.salary_min,
    salaryCurrency: u.salary_currency,
    locationEn: u.location_en,
    country: u.country,
  };
}

/** Стовпці профілю, які читає підбір. Один список на digest і replay. */
export const PROFILE_COLUMNS =
  `u.*, p.spheres,p.industries,p.remote_mode,p.location,p.salary_min,p.salary_max,p.level_max,p.salary_currency,p.custom_role,p.country,
        p.wishes,p.custom_industry,p.cv_highlights,
        p.custom_role_en,p.custom_industry_en,p.wishes_en,p.location_en,
        t.location_weight,t.salary_weight
   FROM users u JOIN profiles p ON p.user_id = u.id
   LEFT JOIN user_tuning t ON t.user_id = u.id`;

/** Рядок вікна кандидатів. dedupe_key живе тільки тут: у CandidateJob його немає. */
export interface CandidateRow {
  id: string; company: string; company_key: string; title: string; location: string | null;
  remote: number; url: string; tags: string; posted_at: string | null;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null; dedupe_key: string | null;
  summary: string | null;
  source: string; country: string | null;
}

/** Скільки рядків заходить у вікно. Причини розміру — у коментарі нижче. */
export const CANDIDATE_WINDOW = 1200;

/**
 * Шортліст: свіже, ще не надіслане цій людині.
 *
 * Винесено з deliverTo, щоб прогін (replay.ts) брав рівно ті самі рядки, що й
 * доставка. Інакше будь-яке «стало краще» вимірювалось би на іншому вікні.
 */
export async function fetchCandidateRows(
  d1: D1Client, profile: Profile, userId: string, limit = CANDIDATE_WINDOW,
): Promise<CandidateRow[]> {
  const topic = onTopicSql(profile);
  /**
   * Країни людини як СПИСОК, а не як рядок.
   *
   * Тут стояло `j.country = ?` з `profile.country` як параметром, а в
   * профілі лежить кома-список: «CZ,AT,HU,SK». Рівність не спрацьовувала
   * жодного разу, тобто людина, яка назвала чотири країни, не бачила
   * НІЧОГО з національних дощок — рівно та сама вада, яку вже виправили в
   * `pickTop`, тільки в іншому місці й на день пізніше.
   *
   * Порожній список лишає поведінку як була: проходять тільки вакансії без
   * країни, тобто глобальні.
   */
  /**
   * Роль людини набирає вікно ПЕРШОЮ, і лише потім його добиває свіжість.
   *
   * Без цього широка сфера з тисячами рядків витісняла вузьку роль з
   * десятками: у живого профілю з ролі «комуніті менеджер» і сфери
   * «інженерія» у вікно заходило 10 із 86 доречних рядків.
   *
   * Той самий пріоритет стоїть і всередині стелі «три вакансії на компанію»:
   * інакше компанія з пʼятьма інженерними оголошеннями витісняла б власну
   * community-вакансію ще до того, як та побачить вікно.
   */
  const role = roleSql(profile);
  const mine = countriesOf(profile);
  const countrySql = mine.length > 0
    ? `AND (j.country IS NULL OR j.country IN (${mine.map(() => "?").join(",")}))`
    : "AND j.country IS NULL";
  return d1.query<CandidateRow>(
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
    //
    //    Межа рахується `strftime`, а не `datetime`, і це не стиль. Дати в
    //    цьому стовпці пише JS через `toISOString()`, тобто «2026-09-03T
    //    03:00:09.128Z», а `datetime('now','-3 day')` віддає «2026-08-31
    //    11:20:02» — з пробілом замість «T». SQLite порівнює їх як РЯДКИ, а
    //    «T» більша за пробіл, тож усе, зібране на межовій добі, проходило
    //    незалежно від години. Виміряно 03.09: 3 047 рядків із 32 952 у вікні
    //    були старші за правило, тобто кожна одинадцята вакансія могла піти
    //    людині вже знятою з дошки.
    // 5. Чужу країну відсікаємо ТУТ, а не після відбору. Національні дошки
    //    дають близько шестисот свіжих вакансій на день; відсортовані за
    //    posted_at, вони заповнили б вікно з 1200 і випали б аж на підборі,
    //    лишивши людину з іншої країни майже без кандидатів. Це та сама
    //    пастка, що колись із lever:jobgether, тільки з іншого боку.
    // 6. СПЕРШУ те, що про цю людину, і лише потім найсвіжіше. Без цього
    //    вікно було зрізом «останні 1200 за датою» з 5032 придатних — тобто
    //    76% кеша не доходило навіть до оцінювання, і зникали саме вузькі
    //    сфери: devrel 6 рядків у пулі → 0 у вікні, design 96 → 18,
    //    web3 180 → 35, junior 142 → 39. Людина, що обрала «DevRel і
    //    спільнота», не могла отримати жодної DevRel-вакансії в принципі.
    //    Тепер свої рядки заходять у вікно всі, а рештою місць його добиває
    //    та сама свіжість, що й раніше.
    // Доречність — умова, а не порядок сортування.
    //
    // Досі вікно бралося з УСЬОГО свіжого кеша, а «своє» лише спливало
    // нагору сортуванням. Але pickTop потім викидає все, що не збіглося за
    // сферою чи роллю, тож решта рядків не могла бути обрана в принципі — ми
    // їх читали й одразу викидали. onTopicSql — надмножина того, що приймає
    // onTopic (він ще й ловить часткові збіги ролі), тож жодного кандидата
    // умова не втрачає.
    //
    // Одну річ вона таки змінює, і на краще. Стеля «три вакансії на компанію»
    // рахувалася серед УСІХ вакансій фірми, тож власні недоречні оголошення
    // витісняли її ж доречні: у компанії з пʼятьма вакансіями дві потрібні
    // могли отримати rn=4 і rn=5 і не пройти. Тепер стеля рахує саме
    // кандидатів. Правило лишилось те саме — одна фірма не забирає вікно, —
    // але тепер воно обмежує те, що справді розглядається. Перевірено на
    // всіх живих профілях: перші місця ті самі, змінюється хвіст, і замість
    // «Group Product Manager, Financials» приходить «Product Manager — HER».
    // Обидві доречні, це не погіршення.
    //
    // NOT EXISTS замість NOT IN з тієї ж причини: NOT IN змушував SQLite
    // перечитувати sent на кожен рядок-кандидат, а NOT EXISTS іде по
    // UNIQUE(user_id, job_id), який у таблиці вже є.
    //
    // Разом на живих профілях: 799 472 прочитаних рядки D1 на шість добірок
    // → 174 041, тобто −78%. На одну добірку це близько 160 000 → 35 000.
    `SELECT * FROM (
       SELECT j.*, ${role.sql} AS by_role, ROW_NUMBER() OVER (
         PARTITION BY j.company_key
         ORDER BY ${role.sql} DESC, j.posted_at DESC, j.fetched_at DESC
       ) AS rn
       FROM jobs_cache j
       WHERE ${topic.sql} = 1
         AND j.fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
         ${countrySql}
         AND NOT EXISTS (SELECT 1 FROM sent s WHERE s.user_id = ? AND s.job_id = j.id)
         AND NOT EXISTS (
           SELECT 1 FROM sent s WHERE s.user_id = ? AND s.dedupe_key = j.dedupe_key)
     )
     WHERE rn <= 3
     ORDER BY by_role DESC, posted_at DESC, fetched_at DESC
     LIMIT ${limit}`,
    [...role.params, ...role.params, ...topic.params, ...mine, userId, userId]);
}

/** Рядок бази → кандидат для оцінювання. */
export const toCandidates = (rows: CandidateRow[]): CandidateJob[] => rows.map((r) => ({
  id: r.id, company: r.company, companyKey: r.company_key, title: r.title,
  location: r.location, remote: r.remote === 1, url: r.url, tags: list(r.tags),
  postedAt: r.posted_at, salaryMin: r.salary_min, salaryMax: r.salary_max, salaryCurrency: r.salary_currency,
  summary: r.summary,
  source: r.source, country: r.country,
}));

export async function deliverTo(u: UserRow, ctx: RunContext): Promise<void> {
  const { d1, cfg, now, botToken, force } = ctx;
  const onRequest = ctx.requested.has(u.id);
  const locale = asLocale(u.locale);
  const canSend = Boolean(botToken && u.telegram_chat_id);
  /**
   * Людина без жодного каналу доставки: зареєструвалась на сайті й Telegram
   * не підключила. Для неї кабінет І Є каналом, тому «доставлено» означає
   * «записано в sent».
   *
   * Це не те саме, що `!canSend`: без токена бота в сканера канал у людини
   * все одно є, просто ми зараз ним не володіємо — і тоді добірка чесно
   * лишається pending до наступного прогону.
   */
  const cabinetOnly = !u.telegram_chat_id;
  // Людина заблокувала бота: слати нікуди, підбирати нове — марно палити вакансії.
  const pauseBlocked = async () => {
    await d1.execute("UPDATE users SET status='paused', paused_reason='blocked' WHERE id=?", [u.id]);
    console.log(`  ${u.id.slice(0, 8)}: бот заблокований (403), пауза`);
  };

  /**
   * Спадок: добірки, записані як pending людині, якій нікуди слати.
   *
   * Досі такий рядок лишався pending назавжди — його ніщо не переводило в
   * sent, а гілка «відкладена вже лежить у кабінеті» щогодини виходила з
   * функції. Тобто людина з сайту отримувала добірку РІВНО ОДИН РАЗ, а
   * обіцянка «п'ять вакансій щоранку» для неї не працювала взагалі.
   *
   * Позначаємо доставленими часом їхнього створення: у кабінеті вони саме
   * тоді й з'явились. Іде до запиту `recent`, щоб розклад і денна стеля
   * рахувались уже за виправленими даними.
   */
  if (cabinetOnly) {
    const stuck = await d1.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sent WHERE user_id=? AND status='pending'", [u.id]);
    if ((stuck[0]?.n ?? 0) > 0) {
      await d1.execute(
        `UPDATE sent SET status='sent', sent_at=created_at
          WHERE user_id=? AND status='pending'`, [u.id]);
      console.log(`  ${u.id.slice(0, 8)}: ${stuck[0]!.n} рядків у кабінеті позначено доставленими`);
    }
  }

  /**
   * Профіль без жодної осі пошуку. Підбирати нема за чим — і мовчки
   * пропустити не можна: людина чекає добірку.
   *
   * Раз на добу, і лише в її годину. Спиратись на звичайний розклад тут не
   * можна: він рахує «сьогодні вже було» по рядках у sent, а їх у цієї
   * людини не з'явиться жодного — тож нагадування пішло б щогодини.
   */
  if (!hasSearchSignal({ spheres: list(u.spheres), customRole: u.custom_role })) {
    const itsTime = hourIn(u.timezone, now) === u.delivery_hour && isWeekdayIn(u.timezone, now);
    if (onRequest) await closeRequests(d1, u.id);
    if (canSend && (onRequest || force || itsTime)) {
      await sendTelegram(botToken!, u.telegram_chat_id!,
        escapeHtml(say(locale, "noProfileYet")), "noprofile", locale);
    }
    console.log(`  ${u.id.slice(0, 8)}: профіль без сфери й без своєї ролі, підбирати нема за чим`);
    return;
  }

  // Що вже було за останні дві доби: і для розкладу, і для денної стелі.
  const recent = await d1.query<{ created_at: string; sent_at: string | null; status: string }>(
    "SELECT created_at, sent_at, status FROM sent WHERE user_id=? AND created_at >= datetime('now','-2 day')", [u.id]);
  const deliveredToday = sentToday(u.timezone, now, recent).length;
  // Перша доставлена добірка взагалі — людина натиснула «Прислати 5 зараз»
  // одразу після анкети. Дописуємо, коли прийде справжня планова.
  const everSent = await d1.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sent WHERE user_id=? AND status='sent'", [u.id]);
  const trialWhen = onRequest && (everSent[0]?.n ?? 0) === 0
    ? formatWhen(nextDelivery(u.timezone, u.delivery_hour, now), u.timezone, locale)
    : undefined;

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
      botToken!, u.telegram_chat_id!,
      fitDigest(await withRoleLines(retry, locale, ctx), locale, DIGEST_MAX,
        { hour: hourIn(u.timezone, now) }),
      digestId, locale, fetch, retry.map((j) => j.sentId).filter((x): x is string => Boolean(x)));
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
  if (pending.length > 0 && !canSend && !cabinetOnly && !onRequest) {
    // Канал у людини є (Telegram прив'язаний), але сканер зараз без токена
    // бота. Добірка справді не доставлена — чекаємо на прогін із токеном і
    // нової не підбираємо, щоб не палити вакансії наосліп.
    //
    // Людини без Telegram ця гілка більше не стосується: її добірка вже
    // позначена доставленою вище, тож далі до неї застосовується звичайний
    // розклад — одна планова на робочий день, як і всім.
    console.log(`  ${u.id.slice(0, 8)}: відкладена добірка чекає на токен бота, нової не підбираю`);
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

  const profile = profileOf(u);
  // Пам'ять про власні дії людини — окремим запитом, бо profileOf працює з
  // рядком, а не з базою (його ж використовує прогін replay.ts).
  profile.companySignal = await companySignals(d1, u.id);

  // Вікно кандидатів. Спільне з прогоном (replay.ts): міряти треба рівно те,
  // що доставляємо, інакше «було/стало» нічого не доводить.
  const rows = await fetchCandidateRows(d1, profile, u.id);

  // Ключ змісту не входить у CandidateJob — тримаємо збоку до запису в sent.
  const dedupeById = new Map(rows.map((r) => [r.id, r.dedupe_key ?? null]));

  const candidates: CandidateJob[] = toCandidates(rows);

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

  // Текст картки — ПІСЛЯ витягу з оголошення, не до нього.
  //
  // Раніше модель писала «чому ти» першою дією, тобто бачила лише назву,
  // локацію й теги. Витяг з тексту оголошення діставався за кілька рядків
  // нижче й ішов у картку окремим абзацом, повз модель. Тепер він — сировина
  // для обох рядків: саме з нього береться те одне речення про суть роботи.
  const pitch = await pitchWithClaude(top, profile, cfg.anthropicApiKey, undefined,
    (u) => { if (!u.ok) ctx.modelFails.push(u.status); return logUsage(d1, "match_reason", u); }, locale, summaries);

  // id рядка sent народжується тут, до форматування: він стоїть у посиланні
  // «Податися», тож має бути відомий раніше, ніж текст піде в Telegram.
  const withWhy = top.map((j, i) => {
    const sal = j.salaryMin == null && j.salaryMax == null ? salaries.get(j.id) : undefined;
    return {
      ...j, why: pitch[i]!.why, roleLine: pitch[i]!.role,
      summary: summaries.get(j.id) ?? j.summary ?? null,
      salaryMin: sal?.min ?? j.salaryMin, salaryMax: sal?.max ?? j.salaryMax,
      salaryCurrency: sal?.currency ?? j.salaryCurrency,
      sentId: crypto.randomUUID(),
    };
  });

  // Рядок про роль — у спільний кеш: він залежить від вакансії та мови, а не
  // від людини. Наступна людина з тією ж мовою і відкладена добірка цієї
  // самої візьмуть його звідти, без другого запиту до моделі.
  await saveRoleLines(
    withWhy.map((j) => ({ id: j.id, title: j.title, role: j.roleLine })), locale, d1Store(d1));

  // Спершу pending, і лише після 200 OK від Telegram — sent. Раніше рядки
  // писались одразу як sent, і якщо процес падав між записом і відправкою,
  // база казала «доставлено» про добірку, якої людина не бачила.
  //
  // Для того, у кого каналом є сам кабінет, «доставлено» настає рівно тут:
  // запис у sent і Є появою добірки на /dashboard, чекати нема на що. Саме
  // тому такий рядок пишеться одразу як sent — інакше він лишався б pending
  // назавжди й глушив усі наступні добірки цієї людини.
  const bornSent = cabinetOnly;
  await d1.batch(withWhy.map((j) => ({
    // OR IGNORE: D1 повторює запити, і таймаут після коміту дав би конфлікт
    // ключа на другій спробі.
    sql: `INSERT OR IGNORE INTO sent (id,user_id,job_id,digest_id,why_fits,match_facts,status,sent_at,dedupe_key,score)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id,job_id) DO NOTHING`,
    params: [j.sentId, u.id, j.id, digestId, j.why, JSON.stringify(j.facts),
             bornSent ? "sent" : "pending", bornSent ? now.toISOString() : null,
             dedupeById.get(j.id) ?? null, j.score ?? null],
  })));

  // Менше за п'ять через стелю — не «тонкий день», а «решта завтра».
  const capped = onRequest && allowance < DIGEST_SIZE;
  // Година В ЛЮДИНИ, а не в нас: сервер стоїть у Європі, а вітаємось ми з
  // тим, у кого зараз може бути ранок або ніч.
  const text = fitDigest(await withRoleLines(withWhy, locale, ctx), locale, DIGEST_MAX,
    { capped, trialWhen, hour: hourIn(u.timezone, now) });
  if (botToken && u.telegram_chat_id) {
    // Номери кнопок «не цікавить» мусять збігатися з нумерацією в тексті,
    // тож беремо їх у тому самому порядку, у якому вакансії пішли в добірку.
    const sent = await sendTelegram(botToken, u.telegram_chat_id, text, digestId, locale, fetch,
      withWhy.map((j) => j.sentId));
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
    // Запит «ще» треба закрити й тут: інакше він лишався відкритим і
    // щогодини породжував нову добірку — доти, доки не закінчились вакансії.
    if (onRequest) await closeRequests(d1, u.id);
    // Кабінет — теж доставка, тож вона рахується в підсумку прогону нарівні
    // з Telegram. Раніше такий прогін звітував «доставлено 0», хоча людина
    // добірку бачила.
    if (bornSent) ctx.delivered++;
    console.log(`  ${u.id.slice(0, 8)}: підібрано ${withWhy.length}, ${
      bornSent ? "лежить у кабінеті" : "доставка чекає на токен бота"}${onRequest ? " (на запит)" : ""}`);
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

  // Акаунти без Telegram: пауза, а через п'ятнадцять днів — видалення.
  // Стоїть перед вибором адресатів навмисно: поставлені на паузу цим
  // кроком уже не потраплять у розсилку цього ж прогону.
  await retireUnreachable(d1, now);

  const where = ["u.status = 'active'"];
  const params: unknown[] = [];
  if (onlyUser) { where.push("u.id = ?"); params.push(onlyUser); }
  if (requestsOnly) {
    where.push(`u.id IN (${[...requested].map(() => "?").join(",")})`);
    params.push(...requested);
  }
  const users = await d1.query<UserRow>(
    `SELECT ${PROFILE_COLUMNS} WHERE ${where.join(" AND ")}`, params);

  const ctx: RunContext = { d1, cfg, now, botToken, force, requested, delivered: 0, modelFails: [] };
  // Збої, розділені за ціною: див. failureReport.
  const lost: string[] = [];
  const idle: string[] = [];
  /**
   * Скільки людей обслуговуємо водночас.
   *
   * Тут стояв послідовний цикл, і на двадцяти чотирьох профілях це було
   * непомітно. Але одна СПРАВЖНЯ доставка коштує близько трьох секунд:
   * запит кандидатів, виклик моделі за поясненнями, надсилання. Майже всі
   * обирають дев'яту годину, тож двісті людей означали б десять хвилин в
   * одному годинному запуску, а тисяча — п'ятдесят, тобто запуски почали б
   * накладатись один на одного.
   *
   * Чотири, а не двадцять. Стеля тут не наша: Telegram приймає тридцять
   * повідомлень на секунду, D1 не любить довгих паралельних транзакцій, а
   * модель гірше поводиться на сплесках. Чотири дають чотириразовий виграш
   * і лишаються далеко від усіх трьох меж.
   */
  const LANES = 4;
  await mapLimit(users, LANES, async (u) => {
    // Одна людина не має права зупинити решту: збій — у журнал і далі.
    try {
      await deliverTo(u, ctx);
    } catch (e) {
      const why = describeError(e);
      console.log(`  ${u.id.slice(0, 8)}: збій, пропускаю — ${why}`);
      (lostDelivery(u, now, requested) ? lost : idle).push(`${u.id.slice(0, 8)}: ${why}`);
    }
  });

  console.log(`Добірка: оброблено ${users.length} профілів, доставлено ${ctx.delivered}.`);

  // Досі все це лишалось у журналі на сервері. На шести тестових акаунтах
  // цього досить — власник і так дивиться. На ста живих людях мовчазний збій
  // означає сто людей без добірки й нікого, хто про це знає: скаржиться
  // одиниця, решта просто йде.
  const report = failureReport(lost, idle, users.length);
  if (report) await notifyOwner(report);

  // Тихе псування, найгірший рід збою: усе «працює», але рядок «чому ти
  // підходиш» у всіх раптом шаблонний, бо скінчився ключ або гроші.
  const modelReport = modelFailReport(ctx.modelFails);
  if (modelReport) await notifyOwner(modelReport);
}

/**
 * Верхні запити прогону (черга «ще», retireUnreachable, список профілів) досі
 * не мали захисту, тож будь-яка помилка D1 роняла процес із кодом 1. Для
 * `nextrole-requests`, який ходить кожні дві хвилини, це означало юніт у
 * стані failed і стек у журналі замість одного рядка. 03.09 так сталося
 * двічі за три хвилини.
 *
 * Виходимо нулем свідомо: наступний тік таймера — і є повторна спроба.
 */
if (process.argv[1]?.endsWith("digest.js")) {
  try {
    await main();
  } catch (e) {
    console.log(`Добірка: прогін не почався — ${describeError(e)}`);
  }
}
