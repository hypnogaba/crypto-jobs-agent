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
 * Заголовок дошки → роль, компанія, місце.
 *
 * Три формати, які трапляються насправді:
 *   «Роль в Компанія, Місто, віддалено»  — DOU
 *   «Роль at Компанія»                   — NoDesk
 *   «Компанія: Роль»                     — We Work Remotely
 *
 * Перший розбирається по ОСТАННЬОМУ « в »: у назвах ролей це слово трапляється
 * («Розробник в команду платежів»), і поділ по першому дав би компанію
 * «команду платежів».
 */
export function parseBoardTitle(raw: string): ParsedTitle | null {
  const clean = decode(raw.slice(0, TITLE_MAX)).replace(/\s+/g, " ").trim();
  if (!clean) return null;

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

  const at = /^(.+?)\s+at\s+(.+)$/i.exec(clean);
  if (at && at[2]!.length <= 60) {
    return { ...bare, company: at[2]!.trim().replace(/[.,]$/, ""), title: at[1]!.trim() };
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
  const country = board.country === "*" ? null : board.country;

  if (board.kind === "jsonld") return fetchJsonLd(board, country, o);

  if (board.kind !== "rss") throw new Error(`формат «${board.kind}» ще не вміємо: ${board.name}`);

  const xml = await fetchXml(board.feedUrl, {}, o);
  const out: RawJob[] = [];
  for (const it of items(xml)) {
    if (!it.link || !it.title) continue;
    const p = parseBoardTitle(it.title);
    if (!p) continue;
    out.push({
      url: cleanUrl(it.link), company: p.company, title: p.title,
      location: p.location, remote: p.remote, postedAt: iso(it.date),
      salaryMin: p.salaryMin, salaryMax: p.salaryMax, salaryCurrency: p.salaryCurrency,
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
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);

      const org = node.hiringOrganization;
      const company = str(typeof org === "object" && org !== null
        ? (org as Record<string, unknown>).name : org);
      const loc = jobLocation(node);
      out.push({
        url, company: company || "Unknown company", title,
        location: loc,
        remote: isRemote(node, loc),
        postedAt: iso(str(node.datePosted)),
        source, country,
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


/** Скільки сторінок вакансій відкриваємо за прогін на одну таку дошку. */
const JSONLD_PAGES = 40;

/**
 * Дошка, яку читаємо розміткою.
 *
 * Двома кроками, бо саме так влаштовані живі дошки. У списку розмітка є, але
 * БЕЗ адрес — а вакансія без адреси нікому не потрібна, людину нікуди вести.
 * На сторінці ж окремої вакансії адреса відома: це сама сторінка. Перший
 * блок JobPosting там належить їй, решта — «схожі вакансії» збоку (перевірено
 * на web3.career: слаг адреси збігається саме з першим блоком).
 *
 * Тому: беремо список, збираємо з нього посилання на вакансії, відкриваємо
 * кожне. Сорок за прогін — дошка не мусить коштувати дорожче за сорок
 * запитів на добу.
 */
async function fetchJsonLd(board: Board, country: string | null, o: FetchOptions): Promise<RawJob[]> {
  const page = await fetchXml(board.feedUrl, {}, o);

  // Якщо дошці пощастило мати повну розмітку прямо в списку — на цьому все.
  const direct = parseJobPostings(page, board.name, country);
  if (direct.length) return direct;

  const links = jobLinks(page, board.feedUrl).slice(0, JSONLD_PAGES);
  const out: RawJob[] = [];
  await mapLimit(links, 4, async (u) => {
    try {
      const first = parseJobPostings(await fetchXml(u, {}, o), board.name, country, u)[0];
      if (first) out.push(first);
    } catch {
      // Одна сторінка з чотирьох десятків не вирок дошці.
    }
  });
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
