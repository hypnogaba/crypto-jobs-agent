/**
 * Національні дошки.
 *
 * Відмінність від агрегатора не в домені, а в тому, чи існує оригінал деінде.
 * Агрегатор передруковує вакансію, яка й так лежить на Greenhouse компанії, —
 * його ми викидаємо. У вакансії на DOU «оригіналу на Greenhouse» немає: сама
 * дошка і є місцем публікації. Викинути її означає не покривати країну.
 *
 * Дошка описується рядком у таблиці country_boards, а не кодом: адреса, країна
 * й формат. Тому нова країна додається з адмінки, без деплою.
 */
import { fetchXml, mapLimit, type FetchOptions } from "../http.js";
import type { RawJob } from "../types.js";

export interface Board {
  name: string;      // board:dou-ua-python
  label: string;     // DOU
  country: string;   // UA
  feedUrl: string;
  kind: string;      // rss | api | jsonld | nextjs
  /**
   * За який період названа сума в заголовку: 'year' або 'month'.
   *
   * Властивість дошки, а не вакансії: DOU називає місяць, GermanTechJobs —
   * рік, і в заголовку про це не сказано жодним словом. Вгадувати за
   * величиною ми свідомо НЕ беремось — справжня річна зарплата в бідній
   * країні перетворилась би на вигадану.
   */
  salaryPeriod?: string;
}

const iso = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const decode = (v: string): string =>
  v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
   .replace(/&#(\d+);/g, (all: string, n: string) => {
     // fromCodePoint кидає на &#99999999; — одна така сутність у чужій
     // стрічці валила б усю дошку на цей прогін.
     const cp = Number(n);
     return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
   });

/** Заголовок довший за це — не заголовок; ріжемо ДО регулярок. */
const TITLE_MAX = 300;

const items = (xml: string): Array<{ title: string; link: string; date: string }> =>
  [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1]!;
    const get = (t: string): string => {
      const r = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(b);
      return r ? r[1]!.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim() : "";
    };
    return { title: get("title"), link: get("link"), date: get("pubDate") };
  });

/** Позначки віддаленої роботи в хвості заголовка, кількома мовами. */
const REMOTE_TAIL = /^(віддалено|удаленно|remote|télétravail|zdalnie)$/i;

export interface ParsedTitle {
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/**
 * Зарплата в хвості заголовка: «$1000–2000», «$800-1200», «від $1500», «$2000».
 *
 * Без цього відрізка вилка потрапляла б у локацію — перша ж перевірка на
 * живій стрічці дала вакансію з містом «$1000–2000». Тире буває трьох видів,
 * бо його ставлять люди.
 */
// Числа без внутрішніх пробілів у групі — «\d[\d\s]*» перед «\s*[–—-]» був
// двозначним і на довгому невідповідному хвості давав квадратичний перебір.
const SALARY = /^(від|from|до|up\s*to)?\s*\$\s*(\d+(?: \d{3})*)(?:\s*[–—-]\s*\$?\s*(\d+(?: \d{3})*))?\+?$/i;

/** «до» задає стелю, а не підлогу. */
const CEILING = /^(до|up\s*to)$/i;

function parseSalary(part: string): { min: number | null; max: number | null } | null {
  const m = SALARY.exec(part.trim());
  if (!m) return null;
  const num = (v: string): number => Number(v.replace(/\s/g, ""));
  const first = num(m[2]!);
  if (!Number.isFinite(first) || first <= 0) return null;

  // «до $5000» — це максимум. Записати його як мінімум означало б підняти
  // людині поріг замість того, щоб його опустити: у базі вже лежало п'ять
  // таких рядків, і всі вони мали зарплату в локації.
  if (CEILING.test(m[1] ?? "")) return { min: null, max: first };

  const second = m[3] ? num(m[3]) : null;
  return { min: first, max: second && second >= first ? second : null };
}

/**
 * «Роль @ Компанія [60.000 - 85.000 €]» — GermanTechJobs і решта німецьких
 * дошок. Вилка стоїть у самому заголовку, крапка в німецьких числах —
 * роздільник тисяч, а не десяткових: «60.000» це шістдесят тисяч.
 */
const AT_SIGN = /^(.+?)\s+@\s+([^[\]]+?)(?:\s*\[\s*([\d.]+)\s*[–—-]\s*([\d.]+)\s*€\s*\])?$/;

/**
 * «Роль job by Компанія | Місто | Назва дошки» — Remotech і подібні.
 * Хвіст із назвою дошки повторюється в кожному рядку й місцем не є.
 */
const JOB_BY = /^(.+?)\s+job by\s+([^|]+?)\s*(?:\|\s*([^|]+?)\s*)?(?:\|\s*[^|]+)?$/i;

/** Німецька вилка: «60.000» → 60000. Крапка тут — тисячі. */
const deNum = (v: string): number | null => {
  const n = Number(v.replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Заголовок дошки → роль, компанія, місце.
 *
 * Формати, які трапляються насправді:
 *   «Роль в Компанія, Місто, віддалено»       — DOU
 *   «Роль at Компанія»                        — NoDesk, Hireeing, StartupsNorth
 *   «Компанія: Роль»                          — We Work Remotely
 *   «Роль @ Компанія [60.000 - 85.000 €]»     — GermanTechJobs
 *   «Роль job by Компанія | Місто | Дошка»    — Remotech
 *
 * Перший розбирається по ОСТАННЬОМУ « в »: у назвах ролей це слово трапляється
 * («Розробник в команду платежів»), і поділ по першому дав би компанію
 * «команду платежів».
 *
 * Два останні додано після перевірки живих стрічок: обидві дошки давали
 * «розібрано», але компанією ставала половина назви посади. Число розібраних
 * рядків цього не показує — видно лише на прикладах, тому їх і друкує
 * `probe-board.ts`.
 */
export function parseBoardTitle(raw: string): ParsedTitle | null {
  const clean = decode(raw.slice(0, TITLE_MAX)).replace(/\s+/g, " ").trim();
  if (!clean) return null;

  // Раніше за « в »: німецька роль «Consultant (m/w/d) @ Vonovia» містить
  // « в » всередині слів рідко, але «Berater in Teilzeit @ …» — саме так.
  const atSign = AT_SIGN.exec(clean);
  if (atSign && atSign[2]!.trim().length <= 80) {
    const min = atSign[3] ? deNum(atSign[3]) : null;
    const max = atSign[4] ? deNum(atSign[4]) : null;
    return {
      company: atSign[2]!.trim(), title: atSign[1]!.trim(),
      location: null, remote: false,
      salaryMin: min, salaryMax: max && max >= (min ?? 0) ? max : null,
      salaryCurrency: min ? "EUR" : null,
    };
  }

  const jobBy = JOB_BY.exec(clean);
  if (jobBy && jobBy[2]!.trim().length <= 60) {
    const where = jobBy[3]?.trim() ?? "";
    // «Remote: Worldwide», «Spain (Remote)» — позначка режиму, не адреса.
    const remote = /remote/i.test(where);
    const place = where.replace(/^remote:\s*/i, "").replace(/\s*\(remote\)$/i, "").trim();
    return {
      company: jobBy[2]!.trim(), title: jobBy[1]!.trim(),
      location: place && !/^(worldwide|global|anywhere)$/i.test(place) ? place : null,
      remote, salaryMin: null, salaryMax: null, salaryCurrency: null,
    };
  }

  const cut = clean.lastIndexOf(" в ");
  if (cut > 0) {
    const head = clean.slice(0, cut).trim();
    const parts = clean.slice(cut + 3).split(",").map((s) => s.trim()).filter(Boolean);
    const company = parts.shift();
    if (head && company) {
      const remote = parts.some((p) => REMOTE_TAIL.test(p));
      let pay: { min: number | null; max: number | null } | null = null;
      const place: string[] = [];
      for (const p of parts) {
        if (REMOTE_TAIL.test(p)) continue;
        const s = parseSalary(p);
        if (s && !pay) { pay = s; continue; }
        place.push(p);
      }
      return {
        company, title: head, location: place.join(", ") || null, remote,
        salaryMin: pay?.min ?? null, salaryMax: pay?.max ?? null,
        salaryCurrency: pay ? "USD" : null,
      };
    }
  }

  const bare = { location: null, remote: false, salaryMin: null, salaryMax: null, salaryCurrency: null };

  /**
   * Ділимо по ОСТАННЬОМУ « at », як і по останньому « в » вище, і з тієї
   * самої причини: воно трапляється всередині назви посади. Remote3 віддає
   * «Job Application for MLRO at Bybit at Bybit» — поділ по першому давав
   * компанію «Bybit at Bybit», і рівно так п'ять таких рядків лежали в
   * живому кеші.
   */
  const atCut = clean.toLowerCase().lastIndexOf(" at ");
  if (atCut > 0) {
    const company = clean.slice(atCut + 4).trim().replace(/[.,]$/, "");
    // WeLoveProduct пише «Senior Product Manager … job at Planet»: слово
    // «job» тут — частина шаблону дошки, а не назви посади, і без цього
    // рядка кожна така вакансія називалась би «… Products job».
    let title = clean.slice(0, atCut).trim().replace(/\s+job$/i, "");
    // «Job Application for X at Bybit at Bybit» — Remote3 пише компанію
    // двічі. Після поділу по останньому « at » друга копія лишається
    // всередині назви посади; прибираємо саме її, а не будь-яке « at ».
    if (title.toLowerCase().endsWith(` at ${company.toLowerCase()}`)) {
      title = title.slice(0, -(company.length + 4)).trim();
    }
    if (company && title && company.length <= 60) {
      return { ...bare, company, title };
    }
  }

  const colon = /^(.+?)\s*[:|–—]\s*(.+)$/.exec(clean);
  if (colon && colon[1]!.length <= 60) {
    return { ...bare, company: colon[1]!.trim(), title: colon[2]!.trim() };
  }

  return null;   // без компанії картка марна
}

/**
 * Прибирає мітки переходів. DOU чіпляє ?utm_source=jobsrss до кожного
 * посилання; без очищення та сама вакансія з двох прогонів має два різні
 * url і лягає в кеш двічі.
 */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch { return raw.trim(); }
}

/**
 * Рядок, який дошка не мала показувати нікому.
 *
 * Це не наша вигадка: у живій стрічці Remote3 лежать власні тестові записи
 * їхньої команди — «__probe_job__ at undefined», «__xsschain_job__», — і
 * посилання в них веде на `/remote-jobs/null`. Два таких рядки доїхали до
 * нашого кеша й були видимі людині.
 *
 * Розбір заголовка їх не спиняє: формально «__probe_job__ at undefined» —
 * бездоганний «Роль at Компанія». Спиняє лише те, що вміє впізнати саме
 * службовий запис: подвійне підкреслення на краях, слово «undefined» чи
 * «null» замість назви, посилання, що закінчується на /null.
 *
 * Перевіряємо і сирий заголовок, і вже розібрану компанію: у Remote3
 * зіпсоване було саме друге поле.
 */
export function isJunk(text: string, link: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^__.*__$/.test(t)) return true;                 // __probe_job__
  if (/(^|\s)__[a-z0-9_]+__(\s|$)/i.test(t)) return true;
  if (/^(undefined|null|nan|none|n\/a|test)$/i.test(t)) return true;
  if (/\b(undefined|__probe|__repro|__xss)\b/i.test(t)) return true;
  if (link && /\/(null|undefined)\/?$/i.test(link)) return true;
  return false;
}

/** Найменша й найбільша річна сума, які взагалі бувають. */
const MIN_YEARLY = 1_000;
const MAX_YEARLY = 5_000_000;

/**
 * Сума з заголовка — у річну.
 *
 * Множник бере дошка, а не здогад. Межі потрібні окремо: одна вакансія на
 * web3.career заявляла 25 мільйонів на рік, і така цифра не просто дивна —
 * вона з'їдає весь верх будь-якого сортування за зарплатою.
 */
function yearlyPay(v: number | null, board: Board): number | null {
  if (v === null) return null;
  const n = Math.round(board.salaryPeriod === "month" ? v * 12 : v);
  return n >= MIN_YEARLY && n <= MAX_YEARLY ? n : null;
}

/**
 * Читає одну дошку.
 *
 * Країну ставить дошка, а не місто вакансії: оголошення в Лісабоні,
 * опубліковане на українській дошці, адресоване українцям. Країна тут
 * означає «кому це показувати», а не «де стоїть офіс».
 *
 * Зірочка — «країни немає». Такою позначається глобальна стрічка, додана з
 * адмінки вставленим посиланням: сама вона нічим не відрізняється від
 * національної, але вакансії з неї потрібні всім. NULL у `jobs_cache.country`
 * і означає «видно всім» (digest.ts: `j.country IS NULL OR j.country = ?`),
 * тож перекладаємо тут, а не тримаємо ще одну колонку-прапорець.
 */
export async function fetchBoard(board: Board, o: FetchOptions = {},
                                freshDays = 14): Promise<RawJob[]> {
  const country = board.country === "*" ? null : board.country;

  if (board.kind === "jsonld") return fetchJsonLd(board, country, o, freshDays);
  if (board.kind === "nextjs") return fetchNextBoard(board, country, o, freshDays);

  if (board.kind !== "rss") throw new Error(`формат «${board.kind}» ще не вміємо: ${board.name}`);

  const xml = await fetchXml(board.feedUrl, {}, o);
  const out: RawJob[] = [];
  for (const it of items(xml)) {
    if (!it.link || !it.title) continue;
    if (isJunk(it.title, it.link)) continue;
    const p = parseBoardTitle(it.title);
    if (!p) continue;
    if (isJunk(p.company, "")) continue;
    out.push({
      url: cleanUrl(it.link), company: p.company, title: p.title,
      location: p.location, remote: p.remote, postedAt: iso(it.date),
      // Період бере ДОШКА: у заголовку про нього не сказано жодним словом.
      salaryMin: yearlyPay(p.salaryMin, board), salaryMax: yearlyPay(p.salaryMax, board),
      salaryCurrency: p.salaryCurrency,
      source: board.name, country,
    });
  }
  return out;
}

/**
 * Дошка, яка віддає вакансії розміткою JobPosting.
 *
 * Це не милиця під один сайт. `JobPosting` — стандарт schema.org, і дошки
 * ставлять його самі, щоб потрапити в Google Jobs: там лежать назва, компанія,
 * місто й дата в однакових полях у всіх. Саме тому воно надійніше за розбір
 * верстки, яка змінюється щомісяця.
 *
 * Знадобилось воно на живому прикладі: web3.career не має ні RSS, ні посилань
 * на ATS — сторінка виглядала порожньою, і ми чесно писали «не розпізнано».
 * Насправді вісімнадцять вакансій лежали в ній відкритим текстом.
 */
export function parseJobPostings(html: string, source: string, country: string | null,
                                 pageUrl?: string): RawJob[] {
  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    // Один зіпсований блок не має валити решту сторінки: розмітку пишуть
    // люди, і серед двадцяти блоків один із комою наприкінці — норма.
    try { parsed = JSON.parse(m[1]!); } catch { continue; }

    for (const node of flatten(parsed)) {
      if (node["@type"] !== "JobPosting") continue;
      // Адреса сторінки як запасна — і це не здогад, а те, як розмітку
      // пишуть насправді: на сторінці однієї вакансії `url` опускають, бо
      // вакансія і є ця сторінка. На жодній із восьми перевірених дошок
      // JobPosting свого `url` не мав.
      const url = pickUrl(node) ?? pageUrl ?? null;
      const title = str(node.title);
      if (!url || !title) continue;

      const org0 = node.hiringOrganization;
      const company0 = str(typeof org0 === "object" && org0 !== null
        ? (org0 as Record<string, unknown>).name : org0);

      // Ключ ширший за адресу, і це не дрібниця: у списку адреси ще немає, і
      // всі вісімнадцять вакансій сторінки мають однакову заглушку. За самою
      // адресою вони схлопувались би в одну — саме так ми й брали з дошки на
      // сорок одну тисячу вакансій по одній зі сторінки.
      const key = `${url}|${title}|${company0}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const loc = jobLocation(node);
      out.push({
        url, company: company0 || "Unknown company", title: decode(decode(title)),
        location: loc,
        remote: isRemote(node, loc),
        postedAt: iso(str(node.datePosted)),
        source, country,
        ...salaryOf(node),
        description: str(node.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
      });
    }
  }
  return out;
}

/**
 * Віддалена чи ні, коли розмітка суперечить сама собі.
 *
 * `jobLocationType: TELECOMMUTE` самого по собі мало. web3.career ставить
 * його ВСІМ вакансіям поспіль — включно з «Office Manager» за конкретною
 * адресою в Нью-Йорку, у якої тут-таки вказано addressLocality. Офіс-менеджер
 * в офісі віддаленим не буває; прапорець просто проставлено скопом.
 *
 * Тому конкретне місто важить більше за прапорець. Ціна помилки несиметрична:
 * зайве «віддалено» шле людині в Києві вакансію, на яку треба ходити ногами в
 * Нью-Йорк, а зайве «не віддалено» лише сховає її від тих, хто й так шукає
 * деінде.
 */
function isRemote(node: Record<string, unknown>, loc: string | null): boolean {
  if (loc && REMOTE_ANYWHERE.test(loc)) return true;
  if (loc) return false;   // є конкретне місто — вірю місту
  return node.jobLocationType === "TELECOMMUTE";
}

/**
 * Позначка віддаленості всередині рядка локації — «Remote, USA».
 * `REMOTE_TAIL` вище на це не годиться: він прив'язаний до цілого слова,
 * бо там розбирається хвіст заголовка, а не вільний текст адреси.
 */
const REMOTE_ANYWHERE = /remote|anywhere|distributed|télétravail|worldwide/i;

/** Розмітку кладуть і масивом, і в `@graph`, і в `itemListElement`. */
function flatten(v: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 4 || v === null || typeof v !== "object") return [];
  if (Array.isArray(v)) return v.flatMap((x) => flatten(x, depth + 1));
  const node = v as Record<string, unknown>;
  return [node, ...flatten(node["@graph"], depth + 1),
          ...flatten(node.itemListElement, depth + 1), ...flatten(node.item, depth + 1)];
}

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** Адреса оголошення: `url`, а якщо його немає — той, куди подаються. */
function pickUrl(node: Record<string, unknown>): string | null {
  for (const key of ["url", "sameAs"]) {
    const v = str(node[key]);
    if (/^https?:\/\//i.test(v)) return v;
  }
  const id = str(node["@id"]);
  return /^https?:\/\//i.test(id) ? id : null;
}

/**
 * Вилка з розмітки.
 *
 * Беремо лише річну: погодинна чи місячна поруч із річними читалась би як
 * помилка — «45» замість «135 000». Те саме правило вже діє на Lever.
 */
function salaryOf(node: Record<string, unknown>): {
  salaryMin?: number; salaryMax?: number; salaryCurrency?: string;
} {
  const base = node.baseSalary;
  if (!base || typeof base !== "object") return {};
  const b = base as Record<string, unknown>;
  const v = b.value;
  if (!v || typeof v !== "object") return {};
  const q = v as Record<string, unknown>;
  if (String(q.unitText ?? "").toUpperCase() !== "YEAR") return {};

  // Ті самі межі, що й на заголовках: одна вакансія на web3.career заявляла
  // 25 мільйонів на рік, і така цифра з'їдає весь верх сортування за
  // зарплатою, нічого про зарплату не повідомляючи.
  const num = (x: unknown): number | undefined => {
    if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) return undefined;
    const n = Math.round(x);
    return n >= MIN_YEARLY && n <= MAX_YEARLY ? n : undefined;
  };
  const min = num(q.minValue) ?? num(q.value);
  const max = num(q.maxValue);
  if (min === undefined && max === undefined) return {};
  return {
    ...(min !== undefined ? { salaryMin: min } : {}),
    ...(max !== undefined ? { salaryMax: max } : {}),
    ...(typeof b.currency === "string" && b.currency ? { salaryCurrency: b.currency } : {}),
  };
}

/** Місто зі вкладеної адреси; порожнє краще за «[object Object]». */
function jobLocation(node: Record<string, unknown>): string | null {
  const first = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
  if (!first || typeof first !== "object") return null;
  const addr = (first as Record<string, unknown>).address;
  if (!addr || typeof addr !== "object") return null;
  const a = addr as Record<string, unknown>;
  const parts = [str(a.addressLocality), str(a.addressRegion), str(a.addressCountry)];
  return parts.filter(Boolean).join(", ") || null;
}


/**
 * Скільки сторінок списку гортаємо, коли розмітка зшивається з посиланнями.
 *
 * Сторінка коштує ОДИН запит і дає близько двох десятків вакансій, тож
 * шістдесят сторінок — це приблизно тисяча вакансій за шістдесят запитів.
 * Раніше стелею була ціна: кожна вакансія коштувала окрему сторінку, і зі
 * сорока однієї тисячі ми брали сотню.
 */
const JSONLD_LIST_PAGES = 200;
/** Скільки вакансій беремо з дошки за прогін. */
const JSONLD_JOBS = 4000;

/**
 * Скільки сторінок гортаємо, коли зшити не вдалось.
 *
 * Тоді кожна вакансія знову коштує окремий запит, і глибина мусить бути
 * інша: п'ять сторінок — це близько сотні запитів, а не тисячі.
 */
const JSONLD_SLOW_PAGES = 5;

/**
 * Дошка, яку читаємо розміткою.
 *
 * Двома кроками, бо саме так влаштовані живі дошки. У списку розмітка є, але
 * БЕЗ адрес — а вакансія без адреси нікому не потрібна, людину нікуди вести.
 * На сторінці ж окремої вакансії адреса відома: це сама сторінка. Перший
 * блок JobPosting там належить їй, решта — «схожі вакансії» збоку (перевірено
 * на web3.career: слаг адреси збігається саме з першим блоком).
 *
 * Гортаємо список, бо однієї сторінки замало: web3.career показує
 * вісімнадцять вакансій за раз, а має сорок одну тисячу. Читати їх усі ми не
 * будемо ніколи й не мусимо — дошка сортує найновішим уперед, а нам і треба
 * найновіше. Сто двадцять вакансій на добу при чотирнадцятиденній свіжості —
 * це щоденний зріз, а не спроба скачати сайт.
 */
/**
 * Чи є на сторінці бодай одна вакансія, молодша за вікно свіжості.
 *
 * Це і є справжня межа глибини. Стала кількість сторінок або читає замало
 * (jobstash має 7 698 вакансій, а сорок сторінок беруть 400 — і найстаріша з
 * них лише десятиденна, тобто попереду ще багато свіжого), або гортає в
 * порожнечу. Дошка сортує найновішим уперед, тож щойно ціла сторінка
 * виявилась старішою за вікно, далі буде лише старіше.
 */
function hasFresh(jobs: RawJob[], freshDays: number): boolean {
  const edge = Date.now() - freshDays * 86_400_000;
  return jobs.some((j) => !j.postedAt || new Date(j.postedAt).getTime() >= edge);
}

async function fetchJsonLd(board: Board, country: string | null, o: FetchOptions,
                           freshDays: number): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();

  let budget = JSONLD_LIST_PAGES;
  for (let page = 1; page <= budget && seen.size < JSONLD_JOBS; page++) {
    let url = board.feedUrl;
    if (page > 1) {
      try {
        const u = new URL(board.feedUrl);
        u.searchParams.set("page", String(page));
        url = u.toString();
      } catch { break; }
    }

    let html: string;
    try { html = await fetchXml(url, {}, o); } catch { break; }

    const { jobs: batch, stitched } = await jobsFromListing(html, board, country, o);
    // Дошка, яку не вдалось зшити, коштує запит на кожну вакансію — глибше
    // за п'ять сторінок такої ціни ми не платимо.
    if (!stitched) budget = Math.min(budget, JSONLD_SLOW_PAGES);
    // Сторінка цілком за межею свіжості означає, що далі буде лише старіше.
    if (page > 1 && !hasFresh(batch, freshDays)) break;
    const before = seen.size;
    for (const j of batch) {
      if (seen.has(j.url)) continue;
      seen.add(j.url);
      out.push(j);
    }
    // Сторінка не додала нічого нового: або список скінчився, або дошка не
    // знає параметра `page` й віддала ту саму. Розрізняти нема потреби.
    if (seen.size === before) break;
  }
  return out.slice(0, JSONLD_JOBS);
}

/**
 * Вакансії з однієї сторінки списку.
 *
 * Спершу пробуємо зшити розмітку з посиланнями просто тут, БЕЗ жодного
 * додаткового запиту. Це можливо тому, що адреса вакансії складається з її ж
 * назви та компанії: «Investment Analyst» у «Kakao Ventures» лежить за
 * `/investment-analyst-kakao-ventures/153281`. Тобто розмітка й посилання
 * описують те саме різними словами, і зіставити їх можна за слагом.
 *
 * Різниця в ціні величезна: сторінка коштує ОДИН запит замість вісімнадцяти.
 * Саме через ці вісімнадцять ми брали з дошки на сорок одну тисячу вакансій
 * заледве сотню.
 *
 * Якщо зшити не вдалось — падаємо на старий шлях і відкриваємо сторінки
 * вакансій поодинці. Він повільний, але працює там, де назва в адресі не
 * повторює назву вакансії.
 */
async function jobsFromListing(html: string, board: Board, country: string | null,
                               o: FetchOptions): Promise<{ jobs: RawJob[]; stitched: boolean }> {
  // Дошці могло пощастити мати повну розмітку з адресами.
  const complete = parseJobPostings(html, board.name, country);
  if (complete.length) return { jobs: complete, stitched: true };

  const links = jobLinks(html, board.feedUrl);
  const stitched = stitchBySlug(parseJobPostings(html, board.name, country, PLACEHOLDER), links);
  if (stitched.length) return { jobs: stitched, stitched: true };

  const jobs: RawJob[] = [];
  await mapLimit(links, 4, async (u) => {
    try {
      const job = parseJobPostings(await fetchXml(u, {}, o), board.name, country, u)[0];
      if (job) jobs.push(job);
    } catch {
      // Одна сторінка зі списку не вирок дошці.
    }
  });
  return { jobs, stitched: false };
}

/**
 * Адреса-заглушка для розбору списку.
 *
 * `parseJobPostings` навмисно викидає вакансію без адреси — людину нікуди
 * вести. Але тут адреса ще попереду, тож підставляємо позначку, яку зараз же
 * замінимо справжньою.
 */
const PLACEHOLDER = "https://nextrole.invalid/unmatched";

/** Слаг так, як його робить сама дошка в адресі. */
function slugify(text: string): string {
  return decode(decode(text)).toLowerCase()
    .replace(/[\u2019'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Зшиває розмітку з посиланнями за слагом.
 *
 * Правило вимагає збігу И назви, И компанії: сама назва не годиться, бо
 * «Founding Engineer» буває у двох компаній одразу, і ми б дали людині
 * посилання не на ту вакансію. Компанія в адресі пишеться без дефісів
 * («ondofinance»), тому порівнюємо, прибравши їх з обох боків.
 *
 * Неоднозначний збіг відкидаємо мовчки: краще не взяти вакансію, ніж
 * повести людину до чужої.
 */
function stitchBySlug(postings: RawJob[], links: string[]): RawJob[] {
  if (postings.length === 0 || links.length === 0) return [];
  const paths = links.map((l) => {
    let seg = "";
    try { seg = new URL(l).pathname.split("/").filter(Boolean)[0] ?? ""; } catch { /* лишиться порожнім */ }
    return { url: l, seg, flat: seg.replace(/-/g, "") };
  });

  const out: RawJob[] = [];
  for (const j of postings) {
    const title = slugify(j.title);
    const company = slugify(j.company).replace(/-/g, "");
    if (!title || !company) continue;
    const hit = paths.filter((p) => p.seg.startsWith(title) && p.flat.includes(company));
    if (hit.length !== 1) continue;
    out.push({ ...j, url: hit[0]!.url });
  }
  return out;
}

/**
 * Посилання, які схожі на окремі вакансії.
 *
 * Ознака навмисно вузька: свій домен і числовий хвіст у шляху. Числом
 * закінчуються посилання на вакансію майже скрізь, бо це її id, — а от
 * «/about» чи «/pricing» так не виглядають ніколи. Ширша ознака означала б
 * сорок запитів у сторінки «Про нас».
 */
export function jobLinks(html: string, base: string): string[] {
  let host: string;
  try { host = new URL(base).hostname; } catch { return []; }
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#?]{6,200})["']/gi)) {
    let u: URL;
    try { u = new URL(m[1]!, base); } catch { continue; }
    if (u.hostname !== host) continue;
    if (!/\/[a-z0-9][a-z0-9-]{5,}\/\d{3,}\/?$/i.test(u.pathname)) continue;
    out.add(u.toString());
  }
  return [...out];
}

/**
 * Дошка на Next.js, яка кладе записи вакансій у власний потік.
 *
 * Такий сайт виглядає порожнім: у HTML немає ні стрічки, ні розмітки, ні
 * посилань на ATS, і легко вирішити, що вакансії домальовує браузер. Це
 * майже правда — але дані для малювання сервер уже надіслав, у викликах
 * `self.__next_f.push([1,"…"])`. Там лежить готовий запис: назва, компанія,
 * її сайт, місто, країна, дата.
 *
 * Так читається jobstash.xyz — 7698 вакансій, які ми чесно вважали
 * недосяжними. Десять записів на один запит, тобто вдесятеро дешевше за
 * дошку з розміткою, де кожна вакансія коштує окрему сторінку.
 */
export function parseNextPayload(html: string, source: string, country: string | null,
                                 base: string): RawJob[] {
  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (const node of nextObjects(unpackNextStream(html))) {
    const title = str(node.title);
    const href = str(node.href) || str(node.url);
    if (!title || !href) continue;

    let url: string;
    try { url = new URL(href, base).toString(); } catch { continue; }
    if (seen.has(url)) continue;

    const org = node.organization ?? node.company;
    const company = str(typeof org === "object" && org !== null
      ? (org as Record<string, unknown>).name : org);
    // Без компанії вакансія непридатна: підбір і дедуплікація тримаються
    // на парі «компанія + роль».
    if (!company) continue;
    seen.add(url);

    const addr = Array.isArray(node.addresses) ? node.addresses[0] : null;
    const a = addr && typeof addr === "object" ? addr as Record<string, unknown> : {};
    const location = str(node.location)
      || [str(a.locality), str(a.country)].filter(Boolean).join(", ") || null;

    out.push({
      url, company, title, location,
      remote: a.isRemote === true || str(node.locationType).toUpperCase() === "REMOTE"
              || REMOTE_ANYWHERE.test(location ?? ""),
      postedAt: iso(str(node.datePosted)),
      source, country,
      description: str(node.summary) || null,
    });
  }
  return out;
}

/**
 * Потік Next.js як суцільний текст.
 *
 * Сервер шле сторінку шматками, кожен — рядок JS із екранованим вмістом.
 * Склеюємо їх і знімаємо екранування: окремий шматок може обірватись
 * посеред запису, тож розбирати їх поодинці не можна.
 */
function unpackNextStream(html: string): string {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => m[1]!);
  if (chunks.length === 0) return "";
  return chunks.join("").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n").replace(/\\u([0-9a-fA-F]{4})/g,
      (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Скільки вглиб шукаємо дужку, що закриває запис. */
const OBJECT_MAX = 12_000;

/**
 * Об'єкти, схожі на вакансію.
 *
 * Ознака — форма, а не назва поля: є `title` і посилання. Прив'язатись до
 * ключа `"job":` було б прив'язкою до одного сайту, а форма запису однакова
 * скрізь, бо її диктує те, що дошка малює на екрані.
 */
function* nextObjects(blob: string): Generator<Record<string, unknown>> {
  for (const m of blob.matchAll(/\{"(?:id|title|slug|jobId)"/g)) {
    const start = m.index!;
    let depth = 0;
    for (let i = start; i < Math.min(start + OBJECT_MAX, blob.length); i++) {
      const c = blob[i];
      if (c === '"') {                      // рядок пропускаємо цілком:
        i++;                                // дужка в тексті вакансії не рахується
        while (i < blob.length && blob[i] !== '"') i += blob[i] === "\\" ? 2 : 1;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            const o: unknown = JSON.parse(blob.slice(start, i + 1));
            if (o && typeof o === "object" && !Array.isArray(o)) yield o as Record<string, unknown>;
          } catch { /* обрізаний шматок — не запис */ }
          break;
        }
      }
    }
  }
}


/** Скільки сторінок такої дошки гортаємо за прогін. */
const NEXT_PAGES = 200;

/**
 * Дошка, чиї записи лежать у потоці Next.js.
 *
 * Гортається тим самим `?page=N`, що й дошка з розміткою, але коштує на
 * порядок менше: сторінка віддає десяток ГОТОВИХ записів, і ходити по
 * окремих вакансіях не треба взагалі. Сорок сторінок — це близько чотирьохсот
 * найновіших вакансій за сорок запитів.
 *
 * Спиняємось, щойно сторінка не додала нічого нового: так поводиться і дошка,
 * яка про параметр не знає, і кінець списку — розрізняти їх нема потреби.
 */
async function fetchNextBoard(board: Board, country: string | null,
                              o: FetchOptions, freshDays: number): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= NEXT_PAGES; page++) {
    let url = board.feedUrl;
    if (page > 1) {
      try {
        const u = new URL(board.feedUrl);
        u.searchParams.set("page", String(page));
        url = u.toString();
      } catch { break; }
    }

    let batch: RawJob[];
    try { batch = parseNextPayload(await fetchXml(url, {}, o), board.name, country, board.feedUrl); }
    catch { break; }

    if (page > 1 && !hasFresh(batch, freshDays)) break;

    const before = seen.size;
    for (const j of batch) {
      if (seen.has(j.url)) continue;
      seen.add(j.url);
      out.push(j);
    }
    if (seen.size === before) break;
  }
  return out;
}
