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
export async function fetchGetro(collectionId: number, o: FetchOptions = {}, pages = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (let page = 0; page < pages; page++) {
    const p = await fetchJson<{ results?: { jobs?: GetroJob[] } }>(
      `https://api.getro.com/api/v2/collections/${collectionId}/search/jobs`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, hitsPerPage: 100, filters: {} }) }, o);
    const batch = p.results?.jobs ?? [];
    if (batch.length === 0) break;
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
];

export function extractAts(url: string): { provider: string; slug: string } | null {
  for (const [provider, rx] of ATS_PATTERNS) {
    const m = rx.exec(url);
    if (m?.[1]) return { provider, slug: m[1].toLowerCase() };
  }
  return null;
}
