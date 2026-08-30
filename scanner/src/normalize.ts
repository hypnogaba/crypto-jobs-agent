import type { NormalizedJob, RawJob } from "./types.js";
import { deriveTags } from "./tags.js";

const LEGAL = new Set([
  "inc","llc","ltd","limited","gmbh","ag","bv","nv","sa","sas","sarl","oy","ab",
  "as","aps","plc","corp","corporation","co","company","holding","group","kg",
]);

/** Шум, який відрізняє публікації тієї самої ролі в різних країнах. */
const TITLE_NOISE = /\((?:m\/f\/d|m\/w\/d|m\/f\/x|w\/m\/d|h\/f|f\/h|m\/f|remote|hybrid|onsite|contract|fixed[- ]term)\)/gi;

const collapse = (v: string): string => v.replace(/\s+/g, " ").trim();

export function companyKey(name: string): string {
  const words = collapse(name.toLowerCase().replace(/[^a-z0-9\s.&-]/g, " ")).split(" ");
  const kept = words.filter((w, i) => i === 0 || !LEGAL.has(w.replace(/\./g, "")));
  return collapse(kept.join(" ").replace(/[.&-]/g, " ")) || collapse(name.toLowerCase());
}

export function titleKey(title: string): string {
  return collapse(title.toLowerCase().replace(TITLE_NOISE, " ").replace(/[^a-z0-9\s]/g, " "));
}

/** Локація навмисно відсутня — це і є правило схлопування геоклонів. */
export const dedupeKey = (j: RawJob): string => `${companyKey(j.company)}|${titleKey(j.title)}`;

export function isFresh(postedAt: string | null, days: number, now = new Date()): boolean {
  if (!postedAt) return true;             // більшість бордів дати не публікують
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return true;
  return (now.getTime() - t) / 86_400_000 <= days;
}

export const hasLiveUrl = (j: RawJob): boolean => /^https?:\/\/\S+$/i.test(j.url.trim());

export function normalizeJob(job: RawJob, now = new Date()): NormalizedJob {
  return {
    ...job,
    url: job.url.trim(),
    company: collapse(job.company) || "Невідома компанія",
    title: collapse(job.title),
    companyKey: companyKey(job.company),
    dedupeKey: dedupeKey(job),
    tags: deriveTags(job),
    fetchedAt: now.toISOString(),
  };
}

/**
 * Наскільки повний запис про вакансію.
 *
 * Потрібно рівно для дедуплікації: коли дві дошки описують ту саму пару
 * «компанія + роль», лишитись має та, що знає більше. Досі вигравала та, що
 * стояла раніше в пласкому списку, тобто порядок вирішував алфавіт назв дошок:
 * web3.career віддавав 435 свіжих вакансій, а в кеш сідало 94, бо
 * `board:global-jobstash` стоїть перед `board:global-web3career`. Втрати
 * вакансій не було — людина побачила б ту саму, — але виграв довільніший
 * запис, а не багатший: у web3.career зарплата є в 93% вакансій.
 *
 * Зарплата важить найбільше, бо саме за нею підбір відсіює найчастіше й саме
 * її людина бачить у картці першою.
 */
function richness(j: RawJob): number {
  return (j.salaryMin != null || j.salaryMax != null ? 4 : 0)
       + (j.description?.trim() ? 2 : 0)
       + (j.postedAt ? 1 : 0)
       + (j.location?.trim() ? 1 : 0);
}

/** Усі центральні правила за один прохід: живий URL → свіжість → дедуп. */
export function prepare(jobs: RawJob[], freshnessDays: number, now = new Date()): NormalizedJob[] {
  const seen = new Set<string>();
  const out: NormalizedJob[] = [];
  // Сортування стійке (Array.prototype.sort у V8), тож рівні за повнотою
  // лишаються в тому порядку, у якому прийшли, — а не тасуються щопрогону.
  const ordered = jobs.length > 1 ? [...jobs].sort((a, b) => richness(b) - richness(a)) : jobs;
  for (const job of ordered) {
    if (!hasLiveUrl(job)) continue;
    if (!job.title?.trim() || !job.company?.trim()) continue;
    if (!isFresh(job.postedAt, freshnessDays, now)) continue;
    const n = normalizeJob(job, now);
    if (seen.has(n.dedupeKey)) continue;
    seen.add(n.dedupeKey);
    out.push(n);
  }
  return out;
}
