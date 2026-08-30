import { mapLimit, runSource, SourceUnavailableError } from "./http.js";
import type { AtsProvider, Company, RawJob, SourceResult } from "./types.js";
import { ATS, GUESS_ORDER } from "./sources/ats.js";
import { AGGREGATORS } from "./sources/aggregators.js";
import { fetchGetro, extractAts } from "./sources/getro.js";
import { companyKey } from "./normalize.js";

export interface RungRun { jobs: RawJob[]; results: SourceResult[] }

// ── R1: прямі ATS компаній зі списку ─────────────────────────
export interface R1Deps {
  markScanned: (slug: string, found: boolean) => Promise<void>;
  learnAts: (slug: string, name: string, provider: AtsProvider, atsSlug: string) => Promise<void>;
}

export async function runR1(companies: Company[], deps: R1Deps, concurrency = 6): Promise<RungRun> {
  const results = await mapLimit(companies, concurrency, async (c): Promise<SourceResult> => {
    if (c.atsProvider && c.atsSlug) {
      const source = `${c.atsProvider}:${c.atsSlug}`;
      const r = await runSource(source, async () => {
        const jobs = await ATS[c.atsProvider!](c.atsSlug!, c.name);
        return c.tags.length ? jobs.map((j) => ({ ...j, inheritedTags: c.tags })) : jobs;
      });
      await deps.markScanned(c.slug, r.jobs.length > 0);
      return r;
    }
    // ATS ще невідомий — пробуємо провайдерів по черзі й запам'ятовуємо відповідь
    for (const provider of GUESS_ORDER) {
      try {
        const jobs = await ATS[provider](c.atsSlug ?? c.slug, c.name);
        if (jobs.length > 0) {
          await deps.learnAts(c.slug, c.name, provider, c.atsSlug ?? c.slug);
          await deps.markScanned(c.slug, true);
          return { source: `${provider}:${c.slug}`, ok: true,
                   jobs: c.tags.length ? jobs.map((j) => ({ ...j, inheritedTags: c.tags })) : jobs };
        }
      } catch { /* не на цьому провайдері — пробуємо наступний */ }
    }
    await deps.markScanned(c.slug, false);
    return { source: `unknown:${c.slug}`, ok: true, jobs: [] };
  });
  return { jobs: results.flatMap((r) => r.jobs), results };
}

// ── R2: агрегатори ───────────────────────────────────────────
export async function runR2(skip: Set<string> = new Set()): Promise<RungRun> {
  const active = Object.entries(AGGREGATORS).filter(([n]) => !skip.has(n));
  const results = await mapLimit(active, 5, ([name, fn]) => runSource(name, () => fn()));
  return { jobs: results.flatMap((r) => r.jobs), results };
}

// ── R3: колекції Getro ───────────────────────────────────────
/**
 * Ніша береться з колекції, а не з того, що це Getro.
 *
 * Раніше «web3» вішало правило SOURCE_TAGS на префікс `getro:` — тобто на
 * будь-який борд, який Getro хостить. Серед них ізраїльська дошка з Elbit і
 * Teva, і всі 412 її вакансій були в кеші як крипта.
 */
export async function runR3(
  collections: Array<{ id: number; tags: string[] }>, skip: Set<string> = new Set()
): Promise<RungRun> {
  const active = collections.filter((c) => !skip.has(`getro:${c.id}`));
  const results = await mapLimit(active, 4, (c) => runSource(`getro:${c.id}`, async () => {
    const jobs = await fetchGetro(c.id);
    return c.tags.length ? jobs.map((j) => ({ ...j, inheritedTags: c.tags })) : jobs;
  }));
  return { jobs: results.flatMap((r) => r.jobs), results };
}

/** Перебирає id колекцій і повертає ті, що відповідають. Робиться зрідка. */
export async function discoverGetroCollections(
  ids: number[], concurrency = 3, paceMs = 350
): Promise<number[]> {
  // Getro тротлить агресивно. Повільно й із витримкою — надійніше, ніж швидко й у 429.
  const live = await mapLimit(ids, concurrency, async (id, i) => {
    await new Promise((r) => setTimeout(r, (i % concurrency) * paceMs));
    try {
      const jobs = await fetchGetro(id, { retries: 2, retryDelayMs: 1500, timeoutMs: 15_000 }, 1);
      return jobs.length > 0 ? id : null;
    } catch { return null; }
  });
  return live.filter((v): v is number => v !== null);
}

// ── R4: вгадування ATS-слага з назви компанії ────────────────
export function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|the|group|sa|bv|ag|kg)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Бренди, які самі є агрегаторами.
 *
 * У багатьох із них є справжня дошка на Lever чи Greenhouse, тому і вгадування
 * слага, і збір ATS-лінків радо беруть їх за роботодавця. Далі одна «компанія»
 * заливає кеш: lever:jobgether дав 1774 вакансії — 10% усього кешу — і забрав
 * 582 рядки з 600 у вікні добірки. Правило «одна роль на компанію» після цього
 * чесно лишало від добірки одну вакансію.
 */
const AGGREGATOR_BRANDS = new Set([
  "jobgether", "arbeitnow", "jobicy", "remoteok", "remotive", "himalayas",
  "nodesk", "workingnomads", "weworkremotely", "jobspresso", "landingjobs",
  "themuse", "cryptocurrencyjobs", "cryptojobslist", "web3career",
  "builtin", "otta", "welcometothejungle", "wellfound", "angellist",
]);

/** Чи це агрегатор, а не роботодавець. Приймає і назву, і готовий слаг. */
export function isAggregatorBrand(nameOrSlug: string): boolean {
  return AGGREGATOR_BRANDS.has(slugify(nameOrSlug));
}

export interface R4Deps {
  addCompany: (c: { slug: string; name: string; provider: AtsProvider; atsSlug: string; discoveredVia: string }) => Promise<void>;
}

/**
 * Береш назву компанії з будь-якого агрегатора, робиш слаг, стукаєш у ATS.
 * Виміряна ефективність — 45%. Кожне влучання стає постійним джерелом.
 */
export async function runR4(
  pool: RawJob[], knownKeys: Set<string>, deps: R4Deps, maxCandidates = 60, concurrency = 8
): Promise<RungRun & { added: number }> {
  const seen = new Set<string>();
  const candidates: Array<{ name: string; slug: string }> = [];
  for (const job of pool) {
    const key = companyKey(job.company);
    const slug = slugify(job.company);
    if (!slug || slug.length < 3 || seen.has(slug)) continue;
    if (knownKeys.has(slug) || knownKeys.has(key)) continue;
    if (isAggregatorBrand(slug)) continue;
    seen.add(slug);
    candidates.push({ name: job.company, slug });
    if (candidates.length >= maxCandidates) break;
  }

  let added = 0;
  const results = await mapLimit(candidates, concurrency, async (c): Promise<SourceResult> => {
    for (const provider of GUESS_ORDER) {
      try {
        const jobs = await ATS[provider](c.slug, c.name, { retries: 0, timeoutMs: 12_000 });
        if (jobs.length > 0) {
          await deps.addCompany({ slug: c.slug, name: c.name, provider, atsSlug: c.slug, discoveredVia: "slug_guess" });
          added++;
          return { source: `${provider}:${c.slug}`, ok: true, jobs };
        }
      } catch (e) {
        if (!(e instanceof SourceUnavailableError)) { /* мережа — просто далі */ }
      }
    }
    return { source: `guess:${c.slug}`, ok: true, jobs: [] };
  });

  return { jobs: results.flatMap((r) => r.jobs), results, added };
}

/** Витягує компанії з ATS-лінків у вже зібраних вакансіях (Getro дає 80%). */
export function harvestAtsFromJobs(
  jobs: RawJob[]
): Array<{ slug: string; name: string; provider: AtsProvider; tags: string[] }> {
  const out = new Map<string, { slug: string; name: string; provider: AtsProvider; tags: string[] }>();
  for (const j of jobs) {
    const hit = extractAts(j.url);
    if (!hit) continue;
    if (isAggregatorBrand(hit.slug) || isAggregatorBrand(j.company)) continue;
    if (!out.has(hit.slug)) {
      // Ніша береться з даних самого джерела, не вгадується
      out.set(hit.slug, {
        slug: hit.slug, name: j.company,
        provider: hit.provider as AtsProvider, tags: j.inheritedTags ?? [],
      });
    }
  }
  return [...out.values()];
}
