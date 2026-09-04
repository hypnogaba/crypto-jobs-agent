import { all } from "@/lib/db";

/**
 * Числа для публічних сторінок. Читаються з таблиці, а не рахуються.
 *
 * Рахує їх сканер наприкінці кожного прогону (`scanner/src/site-stats.ts`),
 * і там же лежать самі запити. Тут навмисно НЕМАЄ запасного шляху з живими
 * агрегатами: він був би другою копією того самого SQL у другому пакеті, а
 * такі копії розходяться першою ж правкою. Порожня таблиця означає «скан ще
 * не відпрацював», і сторінка тоді просто не показує чисел.
 *
 * Чому так: одне відкриття головної коштувало 236 тисяч прочитаних рядків
 * D1, і за добу дві третини всього навантаження бази припадали саме на неї.
 * Дані під цими числами змінюються двічі на добу.
 */

export interface HomeStats { jobs: number; companies: number; sources: number }

export interface FeedRow {
  company: string; title: string; location: string | null; remote: number; url: string;
}

interface Row { key: string; value: string }

/** Префікс ключів зі списками вакансій. Пише їх скан, читає jobs-pages. */
export const TAG_LIST_PREFIX = "jobs.list.";

/**
 * Ключі головної одним запитом: їх п'ять, і читаються вони разом.
 *
 * Списки вакансій сюди НЕ беремо: це двадцять чотири рядки по кілька
 * десятків кілобайт JSON кожен, і головній вони не потрібні. Сторінка-добірка
 * читає свій рядок за точним ключем.
 */
async function read(): Promise<Map<string, string>> {
  try {
    const rows = await all<Row>(
      "SELECT key, value FROM site_stats WHERE key NOT LIKE ?", `${TAG_LIST_PREFIX}%`);
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    // Таблиці ще немає (свіжа база, локальний дев) — це не помилка сторінки.
    return new Map();
  }
}

const json = <T,>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export interface SiteStats {
  home: HomeStats | null;
  feed: FeedRow[];
  tagCounts: Map<string, number>;
}

export async function siteStats(): Promise<SiteStats> {
  const s = await read();
  const n = (key: string): number | null => {
    const v = s.get(key);
    if (v === undefined) return null;
    const parsed = Number.parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const jobs = n("home.jobs");
  const companies = n("home.companies");
  const sources = n("home.sources");
  return {
    home: jobs !== null && companies !== null && sources !== null
      ? { jobs, companies, sources } : null,
    feed: json<FeedRow[]>(s.get("home.feed"), []),
    tagCounts: new Map(Object.entries(json<Record<string, number>>(s.get("jobs.tagCounts"), {}))),
  };
}
