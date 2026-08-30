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
import { fetchXml, type FetchOptions } from "../http.js";
import type { RawJob } from "../types.js";

export interface Board {
  name: string;      // board:dou-ua-python
  label: string;     // DOU
  country: string;   // UA
  feedUrl: string;
  kind: string;      // rss | api
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
export async function fetchBoard(board: Board, o: FetchOptions = {}): Promise<RawJob[]> {
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
      salaryMin: p.salaryMin, salaryMax: p.salaryMax, salaryCurrency: p.salaryCurrency,
      source: board.name, country: board.country === "*" ? null : board.country,
    });
  }
  return out;
}
