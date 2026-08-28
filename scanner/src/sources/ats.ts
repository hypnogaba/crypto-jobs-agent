import { fetchJson, fetchXml, type FetchOptions } from "../http.js";
import type { AtsProvider, RawJob } from "../types.js";

const REMOTE = /remote|anywhere|distributed|home[- ]office|télétravail/i;
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ── Greenhouse ────────────────────────────────────────────────
export async function fetchGreenhouse(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ absolute_url: string; title: string; location?: { name?: string }; updated_at?: string; first_published?: string }> }>(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`, {}, o);
  return (p.jobs ?? []).map((j) => {
    const loc = j.location?.name ?? null;
    return { url: j.absolute_url, company: name, title: j.title, location: loc,
      remote: REMOTE.test(loc ?? ""), postedAt: iso(j.first_published ?? j.updated_at), source: `greenhouse:${slug}` };
  });
}

// ── Lever ─── назва вакансії в полі `text`, не `title`
export async function fetchLever(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const posts = await fetchJson<Array<{ text: string; hostedUrl?: string; applyUrl?: string; categories?: { location?: string }; workplaceType?: string; createdAt?: number }>>(
    `https://api.lever.co/v0/postings/${slug}?mode=json`, {}, o);
  return posts.map((j) => {
    const loc = j.categories?.location ?? null;
    return { url: j.hostedUrl ?? j.applyUrl ?? "", company: name, title: j.text, location: loc,
      remote: j.workplaceType?.toLowerCase() === "remote" || REMOTE.test(loc ?? ""),
      postedAt: iso(j.createdAt), source: `lever:${slug}` };
  });
}

// ── Ashby ─── посилання в полі `jobUrl`
export async function fetchAshby(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ title: string; location?: string; isRemote?: boolean; publishedAt?: string; jobUrl: string; isListed?: boolean }> }>(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}`, {}, o);
  return (p.jobs ?? []).filter((j) => j.isListed !== false).map((j) => ({
    url: j.jobUrl, company: name, title: j.title, location: j.location ?? null,
    remote: j.isRemote === true || REMOTE.test(j.location ?? ""),
    postedAt: iso(j.publishedAt), source: `ashby:${slug}` }));
}

// ── Workable ──────────────────────────────────────────────────
export async function fetchWorkable(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ title: string; location?: { city?: string; country?: string }; url?: string; shortcode?: string; published_on?: string; telecommuting?: boolean }> }>(
    `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`, {}, o);
  return (p.jobs ?? []).map((j) => {
    const loc = [j.location?.city, j.location?.country].filter(Boolean).join(", ") || null;
    return { url: j.url ?? `https://apply.workable.com/${slug}/j/${j.shortcode}/`, company: name,
      title: j.title, location: loc, remote: j.telecommuting === true || REMOTE.test(loc ?? ""),
      postedAt: iso(j.published_on), source: `workable:${slug}` };
  });
}

// ── SmartRecruiters ───────────────────────────────────────────
export async function fetchSmartRecruiters(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ content?: Array<{ id: string; name: string; releasedDate?: string; location?: { city?: string; country?: string; remote?: boolean } }> }>(
    `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`, {}, o);
  return (p.content ?? []).map((j) => {
    const loc = [j.location?.city, j.location?.country].filter(Boolean).join(", ") || null;
    return { url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`, company: name, title: j.name,
      location: loc, remote: j.location?.remote === true || REMOTE.test(loc ?? ""),
      postedAt: iso(j.releasedDate), source: `smartrecruiters:${slug}` };
  });
}

// ── Breezy HR ─────────────────────────────────────────────────
export async function fetchBreezy(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const rows = await fetchJson<Array<{ name: string; url: string; published_date?: string; location?: { city?: string; country?: { name?: string }; is_remote?: boolean } }>>(
    `https://${slug}.breezy.hr/json`, {}, o);
  return rows.map((j) => {
    const loc = [j.location?.city, j.location?.country?.name].filter(Boolean).join(", ") || null;
    return { url: j.url, company: name, title: j.name, location: loc,
      remote: j.location?.is_remote === true || REMOTE.test(loc ?? ""),
      postedAt: iso(j.published_date), source: `breezy:${slug}` };
  });
}

// ── Rippling ──────────────────────────────────────────────────
export async function fetchRippling(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const rows = await fetchJson<Array<{ name: string; url: string; workLocation?: { label?: string } }>>(
    `https://api.rippling.com/platform/api/ats/v1/board/${slug}/jobs`, {}, o);
  return rows.map((j) => {
    const loc = j.workLocation?.label ?? null;
    return { url: j.url, company: name, title: j.name, location: loc,
      remote: REMOTE.test(loc ?? ""), postedAt: null, source: `rippling:${slug}` };
  });
}

// ── Personio ─── XML, не JSON
export async function fetchPersonio(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const xml = await fetchXml(`https://${slug}.jobs.personio.de/xml`, {}, o);
  const jobs: RawJob[] = [];
  const tag = (block: string, t: string): string | null => {
    const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(block);
    return m ? m[1]!.replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;
  };
  for (const m of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
    const b = m[1]!;
    const id = tag(b, "id"); const title = tag(b, "name");
    if (!id || !title) continue;
    const loc = tag(b, "office");
    jobs.push({ url: `https://${slug}.jobs.personio.de/job/${id}`, company: name, title,
      location: loc, remote: REMOTE.test(`${loc ?? ""} ${title}`),
      postedAt: iso(tag(b, "createdAt")), source: `personio:${slug}` });
  }
  return jobs;
}

// ── Workday ─── розблоковує великий ентерпрайз
export async function fetchWorkday(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  // slug має вигляд "tenant|wdN|SiteName"
  const [tenant, wd, site] = slug.split("|");
  if (!tenant || !wd || !site) return [];
  const host = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const p = await fetchJson<{ jobPostings?: Array<{ title: string; externalPath: string; locationsText?: string; postedOn?: string }> }>(
    `${host}/wday/cxs/${tenant}/${site}/jobs`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 100, offset: 0, searchText: "" }) }, o);
  return (p.jobPostings ?? []).map((j) => ({
    url: `${host}/en-US/${site}${j.externalPath}`, company: name, title: j.title,
    location: j.locationsText ?? null, remote: REMOTE.test(j.locationsText ?? ""),
    postedAt: null,                       // Workday віддає відносний текст ("Posted Today"), не дату
    source: `workday:${tenant}` }));
}

export type AtsFetcher = (slug: string, name: string, o?: FetchOptions) => Promise<RawJob[]>;

// ── BambooHR ──────────────────────────────────────────────────
// Публічний ендпоінт, ключа не потребує. Додано, щоб розбавити концентрацію:
// Greenhouse і Ashby разом давали 67% усього кешу — зміна одного їхнього API
// забирала б дві третини продукту за ніч.
export async function fetchBambooHr(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ result?: Array<{ id: string; jobOpeningName: string;
    location?: { city?: string; state?: string; country?: string };
    isRemote?: boolean; departmentLabel?: string }> }>(
    `https://${slug}.bamboohr.com/careers/list`, {}, o);
  return (p.result ?? []).map((j) => {
    const loc = [j.location?.city, j.location?.state, j.location?.country]
      .filter(Boolean).join(", ") || null;
    return {
      url: `https://${slug}.bamboohr.com/careers/${j.id}`, company: name,
      title: j.jobOpeningName, location: loc,
      remote: j.isRemote === true || REMOTE.test(loc ?? ""),
      // Дати відкриття вакансії цей ендпоінт не віддає взагалі.
      postedAt: null, source: `bamboohr:${slug}`,
    };
  });
}

export const ATS: Record<AtsProvider, AtsFetcher> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
  breezy: fetchBreezy,
  rippling: fetchRippling,
  personio: fetchPersonio,
  workday: fetchWorkday,
  bamboohr: fetchBambooHr,
};

/** Порядок перевірки при вгадуванні: найпоширеніші попереду. */
export const GUESS_ORDER: AtsProvider[] =
  ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "breezy", "bamboohr"];
