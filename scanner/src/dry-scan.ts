/**
 * Скан насухо: `node dist/dry-scan.js --snapshot DIR [--cache DIR] [--out FILE] [--overlay]`.
 *
 * Той самий прогін, що й щоденний (`runScan` у scan-core.ts), ті самі живі
 * джерела й ті самі правила, але D1 не торкається ЗОВСІМ: клієнта бази тут
 * немає. Таблиці, з яких скан читає (companies, country_boards,
 * getro_collections, sources_state), беруться зі знімка JSON, зробленого
 * заздалегідь SELECT-ами. Записи не виконуються, а рахуються, і в кінці
 * видно, скільки рядків прогін записав би в D1.
 *
 * Навіщо. Кожне «додамо джерело» чи «розширимо вікно» досі оцінювалось
 * окремим скриптом, тобто не тим кодом, що працюватиме на сервері. А рахунок
 * D1 роблять записи ($1 за мільйон проти $0.001 за читання), і їх треба знати
 * до деплою, а не з рахунку після.
 *
 * Знімок (усе JSON-масиви рядків, як їх віддає `wrangler d1 execute --json`):
 *   companies.json, country_boards.json, getro_collections.json,
 *   sources_state.json, urls.json (масив адрес із jobs_cache, щоб відрізнити
 *   новий рядок від оновлення наявного).
 *
 * `--cache DIR` кладе кожну відповідь джерела на диск і вдруге бере звідти:
 * два прогони з різними налаштуваннями порівнюються на тих самих даних, а
 * джерела не отримують зайвих запитів.
 *
 * `--overlay` накладає на знімок зміни з crypto-sources.ts: те саме, що
 * зробить міграція 0047 після деплою.
 *
 * Оцінка записів. D1 рахує рядки, записані в таблицю І в кожен індекс.
 * Оновлення наявного рядка вакансії чіпає лише таблицю (жоден індекс не
 * містить полів із SET), тобто 1 запис; новий рядок пишеться в таблицю й у
 * три індекси (id, url, dedupe_key), тобто близько 4. Коефіцієнти звірено з
 * `wrangler d1 insights` за 07–11.09: 22 606 інструкцій і 32 878 записаних
 * рядків на скан.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cryptoFreshnessDays, getroMode } from "./config.js";
import { runScan, type ScanRepo } from "./scan-core.js";
import { withCompanyTags } from "./tags.js";
import { extractSalary } from "./salary.js";
import { applyOverlay } from "./crypto-sources.js";
import type { AtsProvider, Company, NormalizedJob, SourceStatus } from "./types.js";
import type { Board } from "./sources/boards.js";
import type { GetroCollection } from "./repo.js";

/** Скільки рядків D1 коштує одна інструкція кожного виду. Див. шапку. */
export const WRITE_COST = {
  jobInsert: 4, jobUpdate: 1, companyScanned: 2, companyUpsert: 1, sourceOutcome: 1, deprecate: 1,
} as const;

const parseTags = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  try { const v = JSON.parse(String(raw ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

export interface SnapshotTables {
  companies: Array<Record<string, unknown>>;
  boards: Array<Record<string, unknown>>;
  getro: Array<Record<string, unknown>>;
  states: Array<Record<string, unknown>>;
  urls: string[];
}

export interface DryRow {
  url: string; company: string; company_key: string; title: string; location: string | null;
  remote: number; salary_min: number | null; salary_max: number | null; salary_currency: string | null;
  source: string; tags: string[]; posted_at: string | null; fetched_at: string; country: string | null;
}

export interface DryCounts {
  jobStatements: number; jobInserts: number; jobUpdates: number;
  companyScanned: number; companyUpserts: number; sourceOutcomes: number; deprecations: number;
}

/** Сховище, яке читає знімок і лише рахує записи. */
export class SnapshotRepo implements ScanRepo {
  readonly rows = new Map<string, DryRow>();
  readonly counts: DryCounts = {
    jobStatements: 0, jobInserts: 0, jobUpdates: 0,
    companyScanned: 0, companyUpserts: 0, sourceOutcomes: 0, deprecations: 0,
  };
  private readonly existing: Set<string>;
  private companies: Company[];

  constructor(private readonly t: SnapshotTables) {
    this.existing = new Set(t.urls);
    this.companies = t.companies.map((r) => ({
      slug: String(r.slug), name: String(r.name),
      atsProvider: (r.ats_provider as AtsProvider | null) ?? null, atsSlug: (r.ats_slug as string | null) ?? null,
      tags: parseTags(r.tags), discoveredVia: (r.discovered_via as string | null) ?? null,
      lastFitAt: (r.last_fit_at as string | null) ?? null, lastScannedAt: (r.last_scanned_at as string | null) ?? null,
      dryScans: Number(r.dry_scans ?? 0),
    }));
  }

  /** Записи D1 за прогін за коефіцієнтами WRITE_COST. */
  rowsWritten(): number {
    const c = this.counts;
    return c.jobInserts * WRITE_COST.jobInsert + c.jobUpdates * WRITE_COST.jobUpdate
      + c.companyScanned * WRITE_COST.companyScanned + c.companyUpserts * WRITE_COST.companyUpsert
      + c.sourceOutcomes * WRITE_COST.sourceOutcome + c.deprecations * WRITE_COST.deprecate;
  }

  async startRun(): Promise<void> {}
  async finishRun(): Promise<void> {}
  async refreshSourceStats(): Promise<void> {}
  async countJobs(): Promise<number> { return this.existing.size + this.counts.jobInserts; }

  async listSourceStates(): Promise<Array<{ source: string; status: SourceStatus; consecutiveFailDays: number; everOk: boolean }>> {
    return this.t.states.map((r) => ({
      source: String(r.source_name), status: (r.status as SourceStatus) ?? "ok",
      consecutiveFailDays: Number(r.consecutive_fail_days ?? 0), everOk: r.last_ok_at !== null,
    }));
  }

  async listGetroCollections(): Promise<GetroCollection[]> {
    return this.t.getro.filter((r) => Number(r.enabled) === 1)
      .map((r) => ({ id: Number(r.collection_id), tags: parseTags(r.tags) }))
      .sort((a, b) => a.id - b.id);
  }

  async listBoards(): Promise<Board[]> {
    return this.t.boards.filter((r) => Number(r.enabled) === 1).map((r) => ({
      name: String(r.name), label: String(r.label), country: String(r.country), feedUrl: String(r.feed_url),
      kind: String(r.kind), salaryPeriod: (r.salary_period as string | null) ?? "year", tags: parseTags(r.tags),
    }));
  }

  async listCompanies(): Promise<Company[]> { return this.companies.map((c) => ({ ...c })); }

  async knownCompanyKeys(): Promise<Set<string>> {
    const set = new Set<string>();
    for (const c of this.companies) { set.add(c.slug); set.add(c.name.toLowerCase()); }
    return set;
  }

  async upsertCompany(c: { slug: string; name: string; provider: AtsProvider | null; atsSlug: string | null; tags?: string[]; discoveredVia?: string }): Promise<void> {
    this.counts.companyUpserts++;
    const i = this.companies.findIndex((x) => x.slug === c.slug);
    const tags = c.tags?.length ? c.tags : (i >= 0 ? this.companies[i]!.tags : []);
    const next: Company = {
      slug: c.slug, name: c.name, atsProvider: c.provider ?? (i >= 0 ? this.companies[i]!.atsProvider : null),
      atsSlug: c.atsSlug ?? (i >= 0 ? this.companies[i]!.atsSlug : null), tags,
      discoveredVia: c.discoveredVia ?? "manual", lastFitAt: null, lastScannedAt: null, dryScans: 0,
    };
    if (i >= 0) this.companies[i] = next; else this.companies.push(next);
  }

  async markCompanyScanned(): Promise<void> { this.counts.companyScanned++; }
  async recordSourceOutcome(): Promise<void> { this.counts.sourceOutcomes++; }
  async deprecateSource(): Promise<void> { this.counts.deprecations++; }

  /** Як Repo.upsertJobs: ніша компанії, вилка з тексту, останній запис перемагає. */
  async upsertJobs(jobs: NormalizedJob[]): Promise<void> {
    const bySlug = new Map(this.companies.filter((c) => c.tags.length).map((c) => [c.slug, c.tags]));
    for (const j of jobs) {
      this.counts.jobStatements++;
      const known = this.existing.has(j.url) || this.rows.has(j.url);
      if (known) this.counts.jobUpdates++; else this.counts.jobInserts++;
      const parsed = j.salaryMin == null && j.salaryMax == null ? extractSalary(j.description) : null;
      const prev = this.rows.get(j.url);
      this.rows.set(j.url, {
        url: j.url, company: j.company, company_key: j.companyKey, title: j.title, location: j.location,
        remote: j.remote ? 1 : 0,
        salary_min: j.salaryMin ?? parsed?.min ?? prev?.salary_min ?? null,
        salary_max: j.salaryMax ?? parsed?.max ?? prev?.salary_max ?? null,
        salary_currency: j.salaryCurrency ?? parsed?.currency ?? prev?.salary_currency ?? null,
        source: j.source, tags: withCompanyTags(j.tags, bySlug.get(j.companyKey) ?? []),
        posted_at: j.postedAt, fetched_at: j.fetchedAt, country: j.country ?? null,
      });
    }
  }
}

/**
 * fetch із кешем на диску. Ключ: метод, адреса й тіло. 429 і 5xx не
 * кешуються: це стан джерела на мить, а не його відповідь.
 */
export function cachingFetch(dir: string, inner: typeof fetch): typeof fetch {
  mkdirSync(dir, { recursive: true });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = createHash("sha1").update(`${init?.method ?? "GET"} ${url} ${typeof init?.body === "string" ? init.body : ""}`).digest("hex");
    const file = join(dir, `${key}.json`);
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8")) as { status: number; headers: Record<string, string>; body: string };
      return new Response(c.status === 204 || c.status === 304 ? null : c.body, { status: c.status, headers: c.headers });
    }
    const res = await inner(input, init);
    const body = await res.text();
    if (res.status !== 429 && res.status < 500) {
      const headers: Record<string, string> = {};
      for (const h of ["location", "content-type", "retry-after"]) {
        const v = res.headers.get(h);
        if (v) headers[h] = v;
      }
      writeFileSync(file, JSON.stringify({ status: res.status, headers, body, url }));
    }
    return new Response(res.status === 204 || res.status === 304 ? null : body, { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const readRows = (dir: string, file: string): Array<Record<string, unknown>> =>
  existsSync(join(dir, file)) ? JSON.parse(readFileSync(join(dir, file), "utf8")) : [];

async function main(): Promise<void> {
  const snap = arg("--snapshot");
  if (!snap) {
    console.log("Потрібен --snapshot DIR зі знімком таблиць (див. шапку файлу).");
    process.exitCode = 1;
    return;
  }
  const cache = arg("--cache");
  if (cache) globalThis.fetch = cachingFetch(cache, globalThis.fetch.bind(globalThis));

  let tables: SnapshotTables = {
    companies: readRows(snap, "companies.json"),
    boards: readRows(snap, "country_boards.json"),
    getro: readRows(snap, "getro_collections.json"),
    states: readRows(snap, "sources_state.json"),
    urls: (readRows(snap, "urls.json") as unknown[]).map((u) => (typeof u === "string" ? u : String((u as { url: string }).url))),
  };
  if (process.argv.includes("--overlay")) tables = applyOverlay(tables);

  const repo = new SnapshotRepo(tables);
  const freshnessDays = Number.parseInt(process.env.FRESHNESS_DAYS ?? "14", 10);
  const started = Date.now();
  await runScan({
    cfg: {
      freshnessDays, cryptoFreshnessDays: cryptoFreshnessDays(), getroMode: getroMode(),
      distinctCompanyTarget: Number.parseInt(process.env.DISTINCT_COMPANY_TARGET ?? "7", 10),
      anthropicApiKey: null,
    },
    repo,
  });

  const c = repo.counts;
  const summary = {
    finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
    settings: { freshnessDays, cryptoFreshnessDays: cryptoFreshnessDays(), getroMode: getroMode(),
      atsPay: process.env.ATS_PAY !== "0", overlay: process.argv.includes("--overlay") },
    counts: c, rowsWritten: repo.rowsWritten(), rows: repo.rows.size,
  };
  console.log(`\nНасухо: ${c.jobStatements} інструкцій вакансій (${c.jobInserts} нових, ${c.jobUpdates} оновлень), ` +
              `${c.companyScanned} позначок компаній, ${c.sourceOutcomes} станів джерел. ` +
              `Оцінка записів D1: ${summary.rowsWritten}.`);
  const out = arg("--out");
  if (out) {
    writeFileSync(out, JSON.stringify({ ...summary, jobs: [...repo.rows.values()] }));
    console.log(`Рядки й підсумок: ${out}`);
  }
}

if (process.argv[1]?.endsWith("dry-scan.js")) await main();
