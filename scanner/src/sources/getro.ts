import { fetchJson, type FetchOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface GetroJob {
  title: string; url: string;
  organization?: { name?: string; industry_tags?: string[]; topics?: string[] };
  searchable_locations?: string[];
  work_mode?: string; created_at?: number;
}

/**
 * Getro віддає справжні industry_tags по кожній компанії — «Blockchain and
 * Cryptocurrency», «Health Care», «Artificial Intelligence». Це набагато
 * надійніше за вгадування ніші з назви посади: колекції фондів охоплюють
 * усі галузі, і тегувати їх скопом означає зробити тег безглуздим.
 */
const INDUSTRY_MAP: Array<[string, RegExp]> = [
  ["web3",      /blockchain|cryptocurrenc|crypto|web3|\bnft\b|defi/i],
  ["ai",        /artificial intelligence|machine learning|computer vision|deep learning|generative/i],
  ["fintech",   /financial|fintech|payments|banking|insurance/i],
  ["health",    /health ?care|medical|biotech|pharma|life scien/i],
  ["games",     /gaming|video game/i],
  ["ecommerce", /e-?commerce|retail|marketplace/i],
  ["defence",   /defen[cs]e|aerospace|military/i],
  ["nonprofit", /non-?profit|social impact|philanthrop/i],
];

export function mapIndustries(org: GetroJob["organization"]): string[] {
  const text = [...(org?.industry_tags ?? []), ...(org?.topics ?? [])].join(" ");
  if (!text) return [];
  return INDUSTRY_MAP.filter(([, rx]) => rx.test(text)).map(([id]) => id);
}

/**
 * Getro тримає борди екосистем фондів. Живих колекцій близько 890, і 80%
 * вакансій у них ведуть прямо в ATS роботодавця — це головний постачальник
 * нових компаній для всієї системи.
 *
 * Ендпоінт віддає 406 без заголовка Accept: application/json. Саме через це
 * джерело раніше вважалося мертвим. http.ts надсилає його за замовчуванням.
 */
/**
 * Стеля сторінок на одну колекцію.
 *
 * Getro віддає РІВНО ДВАДЦЯТЬ вакансій на сторінку й мовчки ігнорує
 * `hitsPerPage`: ми просили сто й отримували двадцять, не помічаючи цього
 * роками. Тобто стара стеля «три сторінки» означала не 300 вакансій, а 60 —
 * при 1085 у Dragonfly і 925 у Polychain ми брали заледве двадцяту частину.
 *
 * Скільки сторінок треба насправді, каже сама колекція полем `count` на
 * першій сторінці, тож стеля спрацьовує лише на велетнях. Двісті — це 4000
 * вакансій; найбільша відома колекція має 3666, тож зараз не ріже нікого.
 *
 * Дорого це не коштує саме тому, що розмір відомий наперед: маленька
 * колекція на 27 вакансій попросить дві сторінки, а не двісті. На всіх
 * двадцяти колекціях виходить близько п'ятисот запитів на добу.
 */
const MAX_PAGES = 200;
/** Скільки Getro віддає за раз. Не наш вибір і не налаштовується. */
const PER_PAGE = 20;

export async function fetchGetro(collectionId: number, o: FetchOptions = {}, pages = MAX_PAGES): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let limit = pages;
  for (let page = 0; page < limit; page++) {
    const p = await fetchJson<{ results?: { jobs?: GetroJob[]; count?: number } }>(
      `https://api.getro.com/api/v2/collections/${collectionId}/search/jobs`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, hitsPerPage: PER_PAGE, filters: {} }) }, o);
    const batch = p.results?.jobs ?? [];
    if (batch.length === 0) break;

    // Колекція сама каже свій розмір — беремо рівно стільки сторінок, скільки
    // в ній є, і не стукаємо навмання до порожньої.
    if (page === 0) {
      const count = p.results?.count;
      if (typeof count === "number" && count > 0) {
        limit = Math.min(pages, Math.ceil(count / PER_PAGE));
      }
    }
    for (const j of batch) {
      if (!j.url || !j.title) continue;
      const inheritedTags = mapIndustries(j.organization);
      jobs.push({
        url: j.url, company: j.organization?.name ?? "Unknown company", title: j.title,
        location: j.searchable_locations?.[0] ?? null,
        remote: (j.work_mode ?? "").toLowerCase() === "remote",
        postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
        source: `getro:${collectionId}`,
        ...(inheritedTags.length ? { inheritedTags } : {}) });
    }
  }
  return jobs;
}

/**
 * Опис колекції — те, що бачить людина на самому борді.
 *
 * `858` це «Solana Network Opportunities», `390` — «Multicoin Capital»,
 * `619` — «Basis Set». Без цього в базі й у панелі лишаються голі номери, і
 * власник не може вирішити, яку колекцію вмикати: між «390» і «Multicoin
 * Capital» різниця саме в тому, чи можна тут щось вирішити.
 *
 * Один запит на колекцію, і лише під час розвідки — у щоденному скані назва
 * вже лежить у базі. Не відповіли або відповіли не тим — повертаємо null,
 * і колекція просто лишається без мітки. Розвідка через це не падає.
 */
export interface CollectionMeta { name: string | null; url: string | null }

export async function fetchCollectionMeta(
  collectionId: number, o: FetchOptions = {},
): Promise<CollectionMeta> {
  try {
    const p = await fetchJson<{ data?: { attributes?: { name?: unknown; domain?: unknown } } }>(
      `https://api.getro.com/api/v2/collections/${collectionId}`, {}, o);
    const a = p.data?.attributes;
    const name = typeof a?.name === "string" ? a.name.replace(/\s+/g, " ").trim() : "";
    const domain = typeof a?.domain === "string" ? a.domain.trim() : "";
    return { name: name ? name.slice(0, 120) : null, url: domain ? `https://${domain}` : null };
  } catch {
    return { name: null, url: null };
  }
}

/** Витягує ATS-слаг із посилання на вакансію — так росте список компаній. */
const ATS_PATTERNS: Array<[string, RegExp]> = [
  ["greenhouse", /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i],
  ["lever", /jobs\.lever\.co\/([a-z0-9_-]+)/i],
  ["ashby", /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i],
  ["workable", /apply\.workable\.com\/([a-z0-9_-]+)/i],
  ["smartrecruiters", /jobs\.smartrecruiters\.com\/([a-z0-9_-]+)/i],
  ["breezy", /([a-z0-9_-]+)\.breezy\.hr/i],
  ["rippling", /ats\.rippling\.com\/([a-z0-9_-]+)/i],
  ["personio", /([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)/i],
  ["bamboohr", /([a-z0-9_-]+)\.bamboohr\.com\/careers/i],
];

export function extractAts(url: string): { provider: string; slug: string } | null {
  for (const [provider, rx] of ATS_PATTERNS) {
    const m = rx.exec(url);
    if (m?.[1]) return { provider, slug: m[1].toLowerCase() };
  }
  return null;
}
