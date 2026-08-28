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
   .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

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
const SALARY = /^(?:від\s*|from\s*)?\$\s*(\d[\d\s]*)(?:\s*[–—-]\s*\$?\s*(\d[\d\s]*))?\+?$/i;

function parseSalary(part: string): { min: number; max: number | null } | null {
  const m = SALARY.exec(part.trim());
  if (!m) return null;
  const num = (v: string): number => Number(v.replace(/\s/g, ""));
  const min = num(m[1]!);
  if (!Number.isFinite(min) || min <= 0) return null;
  const max = m[2] ? num(m[2]) : null;
  return { min, max: max && max >= min ? max : null };
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
  const clean = decode(raw).replace(/\s+/g, " ").trim();
  if (!clean) return null;

  const cut = clean.lastIndexOf(" в ");
  if (cut > 0) {
    const head = clean.slice(0, cut).trim();
    const parts = clean.slice(cut + 3).split(",").map((s) => s.trim()).filter(Boolean);
    const company = parts.shift();
    if (head && company) {
      const remote = parts.some((p) => REMOTE_TAIL.test(p));
      let pay: { min: number; max: number | null } | null = null;
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
 */
export async function fetchBoard(board: Board, o: FetchOptions = {}): Promise<RawJob[]> {
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
      source: board.name, country: board.country,
    });
  }
  return out;
}
