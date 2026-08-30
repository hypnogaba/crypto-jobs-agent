import { fetchJson, fetchXml, type FetchOptions } from "../http.js";
import type { RawJob } from "../types.js";

const REMOTE = /remote|anywhere|distributed/i;
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export async function fetchArbeitnow(o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ data?: Array<{ company_name: string; title: string; url: string; location?: string; remote?: boolean; created_at?: number }> }>(
    "https://www.arbeitnow.com/api/job-board-api", {}, o);
  return (p.data ?? []).map((j) => ({
    url: j.url, company: j.company_name, title: j.title, location: j.location ?? null,
    remote: j.remote === true, postedAt: iso(j.created_at), source: "aggregator:arbeitnow" }));
}

/** Умови Remotive вимагають атрибуції й живого лінка назад — url не підміняти. */
export async function fetchRemotive(o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ company_name: string; title: string; url: string; candidate_required_location?: string; publication_date?: string; salary?: string }> }>(
    "https://remotive.com/api/remote-jobs", {}, o);
  return (p.jobs ?? []).map((j) => ({
    url: j.url, company: j.company_name, title: j.title,
    location: j.candidate_required_location ?? null, remote: true,
    postedAt: iso(j.publication_date ? `${j.publication_date}Z` : null), source: "aggregator:remotive" }));
}

/** ПЕРШИЙ елемент масиву RemoteOK — юридична нотатка, не вакансія. */
export async function fetchRemoteOk(o: FetchOptions = {}): Promise<RawJob[]> {
  const rows = await fetchJson<Array<{ legal?: string; company?: string; position?: string; url?: string; location?: string; date?: string; salary_min?: number; salary_max?: number }>>(
    "https://remoteok.com/api", {}, o);
  return rows.filter((r) => !r.legal && r.url && r.position && r.company).map((r) => ({
    url: r.url!, company: r.company!, title: r.position!, location: r.location ?? null,
    remote: true, postedAt: iso(r.date), salaryMin: r.salary_min ?? null, salaryMax: r.salary_max ?? null,
    salaryCurrency: r.salary_min ? "USD" : null, source: "aggregator:remoteok" }));
}

export async function fetchJobicy(o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ companyName: string; jobTitle: string; url: string; jobGeo?: string; pubDate?: string; annualSalaryMin?: number; annualSalaryMax?: number; salaryCurrency?: string }> }>(
    "https://jobicy.com/api/v2/remote-jobs?count=100", {}, o);
  return (p.jobs ?? []).map((j) => ({
    url: j.url, company: j.companyName, title: j.jobTitle, location: j.jobGeo ?? null,
    remote: true, postedAt: iso(j.pubDate), salaryMin: j.annualSalaryMin ?? null,
    salaryMax: j.annualSalaryMax ?? null, salaryCurrency: j.salaryCurrency ?? null,
    source: "aggregator:jobicy" }));
}

export async function fetchHimalayas(o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ companyName?: string; title?: string; applicationLink?: string; guid?: string; locationRestrictions?: string[]; pubDate?: number; minSalary?: number; maxSalary?: number }> }>(
    "https://himalayas.app/jobs/api?limit=100", {}, o);
  return (p.jobs ?? []).filter((j) => j.title && j.companyName).map((j) => ({
    url: j.applicationLink ?? j.guid ?? "", company: j.companyName!, title: j.title!,
    location: (j.locationRestrictions ?? []).join(", ") || null, remote: true,
    postedAt: iso(j.pubDate), salaryMin: j.minSalary ?? null, salaryMax: j.maxSalary ?? null,
    source: "aggregator:himalayas" }));
}

export async function fetchWorkingNomads(o: FetchOptions = {}): Promise<RawJob[]> {
  const rows = await fetchJson<Array<{ company_name?: string; title?: string; url?: string; location?: string; pub_date?: string }>>(
    "https://www.workingnomads.com/api/exposed_jobs/", {}, o);
  return rows.filter((r) => r.title && r.company_name && r.url).map((r) => ({
    url: r.url!.startsWith("http") ? r.url! : `https://www.workingnomads.com${r.url}`,
    company: r.company_name!, title: r.title!, location: r.location ?? null, remote: true,
    postedAt: iso(r.pub_date), source: "aggregator:workingnomads" }));
}

export async function fetchLandingJobs(o: FetchOptions = {}): Promise<RawJob[]> {
  const rows = await fetchJson<Array<{ id: number; title?: string; company_name?: string; company?: { name?: string }; url?: string; locations?: string[]; remote?: boolean; published_at?: string; currency_code?: string }>>(
    "https://landing.jobs/api/v1/jobs", {}, o);
  return rows.filter((r) => r.title).map((r) => ({
    url: r.url ?? `https://landing.jobs/jobs/${r.id}`,
    company: r.company_name ?? r.company?.name ?? "Unknown company",
    title: r.title!, location: (r.locations ?? []).join(", ") || null,
    remote: r.remote === true, postedAt: iso(r.published_at), source: "aggregator:landingjobs" }));
}

export async function fetchTheMuse(o: FetchOptions = {}): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const page of [1, 2]) {
    const p = await fetchJson<{ results?: Array<{ name: string; company?: { name?: string }; refs?: { landing_page?: string }; locations?: Array<{ name?: string }>; publication_date?: string }> }>(
      `https://www.themuse.com/api/public/jobs?page=${page}`, {}, o);
    for (const j of p.results ?? []) {
      const loc = (j.locations ?? []).map((l) => l.name).filter(Boolean).join(", ") || null;
      const url = j.refs?.landing_page;
      if (!url || !j.name) continue;
      out.push({ url, company: j.company?.name ?? "Unknown company", title: j.name,
        location: loc, remote: REMOTE.test(loc ?? ""), postedAt: iso(j.publication_date),
        source: "aggregator:themuse" });
    }
  }
  return out;
}

// ── RSS ──────────────────────────────────────────────────────
const rssItems = (xml: string): Array<Record<string, string>> => {
  const items: Array<Record<string, string>> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1]!;
    const get = (t: string): string => {
      const r = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(b);
      return r ? r[1]!.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim() : "";
    };
    items.push({ title: get("title"), link: get("link"), date: get("pubDate"), region: get("region") });
  }
  return items;
};

/**
 * RSS джоб-бордів використовує два несумісні формати заголовка:
 *   "Company: Title"   — We Work Remotely, Jobspresso
 *   "Title at Company" — NoDesk, CryptocurrencyJobs
 * Без другого варіанта майже сотня вакансій за прогін лишалась без компанії.
 */
function splitTitle(raw: string): { company: string; title: string } {
  const clean = decode(raw).replace(/\s+/g, " ").trim();

  const at = /^(.+?)\s+at\s+(.+)$/i.exec(clean);
  if (at && at[2]!.length <= 60 && !/\bat\s*$/i.test(at[1]!)) {
    return { title: at[1]!.trim(), company: at[2]!.trim().replace(/[.,]$/, "") };
  }

  const colon = /^(.+?)\s*[:|–—]\s*(.+)$/.exec(clean);
  if (colon && colon[1]!.length <= 60) {
    return { company: colon[1]!.trim(), title: colon[2]!.trim() };
  }

  return { company: "Unknown company", title: clean };
}

async function rssSource(url: string, source: string, o: FetchOptions): Promise<RawJob[]> {
  const xml = await fetchXml(url, {}, o);
  return rssItems(xml)
    .filter((i) => i.link && i.title)
    .map((i) => {
      const { company, title } = splitTitle(i.title!);
      return { url: i.link!, company, title, location: i.region ? decode(i.region) : null,
        remote: true, postedAt: iso(i.date), source };
    })
    .filter((j) => j.company !== "Unknown company");   // без компанії картка марна
}

export const fetchWeWorkRemotely = (o: FetchOptions = {}) => rssSource("https://weworkremotely.com/remote-jobs.rss", "aggregator:wwr", o);

/**
 * Категорійні стрічки WWR: дизайн, підтримка, devops.
 *
 * Це не спроба доставити людям вакансії з WWR — вони й далі відсіюються
 * `linksToAggregator`, бо ведуть на каталог, а не до роботодавця. Сенс інший:
 * саме з агрегаторів сіється зростання списку компаній (див. «Зростання
 * окремо від достатності» у scan.ts), а спільна стрічка WWR — це тридцять
 * останніх вакансій упереміш, де інженерія витісняє все інше.
 *
 * Виміряно на живих стрічках із сервера: спільна дає ~30 позицій, сама лише
 * категорія дизайну — 62. Тобто дизайнерські компанії просто не доходили до
 * вгадування ATS, і їхні власні дошки в список не потрапляли. Кеш це видно
 * прямо: дизайн 311 рядків із 19 811 при 4 674 інженерних.
 *
 * Категорії обрані під наші тонкі сфери, а не «усі, які є».
 */
const WWR_CATEGORY = (slug: string) => (o: FetchOptions = {}) =>
  rssSource(`https://weworkremotely.com/categories/${slug}.rss`, `aggregator:wwr-${slug.replace(/^remote-|-jobs$/g, "")}`, o);

export const fetchWwrDesign  = WWR_CATEGORY("remote-design-jobs");
export const fetchWwrSupport = WWR_CATEGORY("remote-customer-support-jobs");
export const fetchWwrDevOps  = WWR_CATEGORY("remote-devops-sysadmin-jobs");
export const fetchJobspresso     = (o: FetchOptions = {}) => rssSource("https://jobspresso.co/?feed=job_feed", "aggregator:jobspresso", o);
export const fetchNoDesk         = (o: FetchOptions = {}) => rssSource("https://nodesk.co/remote-jobs/index.xml", "aggregator:nodesk", o);
export const fetchCryptoJobs     = (o: FetchOptions = {}) => rssSource("https://cryptocurrencyjobs.co/index.xml", "aggregator:cryptocurrencyjobs", o);

// ── Hacker News «Who is hiring» ───────────────────────────────
/** RSS-стрічки часто кодують сутності двічі й тричі — розкодовуємо до стабільного стану. */
function decode(v: string): string {
  let out = v;
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/&#x2F;/gi, "/").replace(/&#x27;/gi, "'").replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"').replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
    if (next === out) break;
    out = next;
  }
  return out;
}

export function parseHnComment(html: string, createdAt: string): RawJob | null {
  const link = /href="([^"]+)"/.exec(html);
  if (!link) return null;
  const url = decode(link[1]!);
  if (!/^https?:\/\//i.test(url)) return null;

  // Прибираємо посилання РАЗОМ із їхнім текстом: сам URL уже взято окремо,
  // а його текст інакше приклеюється до назви компанії.
  const withoutLinks = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ");
  const flat = decode(withoutLinks.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const parts = flat.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const company = parts[0]!.split(/https?:\/\//)[0]!.trim();
  if (!company || company.length > 60) return null;
  const rest = parts.slice(1).filter((s) => !/^https?:\/\//i.test(s));
  return { url, company, title: rest[0] ?? "See posting", location: rest[1] ?? null,
    remote: REMOTE.test(flat), postedAt: iso(createdAt), source: "aggregator:hn" };
}

export async function fetchHackerNews(o: FetchOptions = {}): Promise<RawJob[]> {
  const s = await fetchJson<{ hits?: Array<{ objectID: string; title: string | null }> }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5", {}, o);
  const thread = (s.hits ?? []).find((h) => (h.title ?? "").toLowerCase().includes("who is hiring"));
  if (!thread) return [];
  const item = await fetchJson<{ children?: Array<{ text: string | null; created_at: string }> }>(
    `https://hn.algolia.com/api/v1/items/${thread.objectID}`, {}, o);
  const jobs: RawJob[] = [];
  for (const c of item.children ?? []) {
    if (!c.text) continue;
    const p = parseHnComment(c.text, c.created_at);
    if (p) jobs.push(p);
  }
  return jobs;
}

export const AGGREGATORS: Record<string, (o?: FetchOptions) => Promise<RawJob[]>> = {
  "aggregator:arbeitnow": fetchArbeitnow,
  "aggregator:remotive": fetchRemotive,
  "aggregator:remoteok": fetchRemoteOk,
  "aggregator:jobicy": fetchJobicy,
  "aggregator:himalayas": fetchHimalayas,
  "aggregator:workingnomads": fetchWorkingNomads,
  "aggregator:landingjobs": fetchLandingJobs,
  "aggregator:themuse": fetchTheMuse,
  "aggregator:wwr": fetchWeWorkRemotely,
  // Категорії WWR годують саме зростання списку компаній, не добірку.
  "aggregator:wwr-design": fetchWwrDesign,
  "aggregator:wwr-customer-support": fetchWwrSupport,
  "aggregator:wwr-devops-sysadmin": fetchWwrDevOps,
  "aggregator:jobspresso": fetchJobspresso,
  "aggregator:nodesk": fetchNoDesk,
  "aggregator:cryptocurrencyjobs": fetchCryptoJobs,
  "aggregator:hn": fetchHackerNews,
};
