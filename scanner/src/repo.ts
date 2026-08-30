import { summarize } from "./summary.js";
import { extractSalary } from "./salary.js";
import type { D1Client, D1Statement } from "./d1.js";
import type { AtsProvider, Company, NormalizedJob, SourceStatus } from "./types.js";
import type { Board } from "./sources/boards.js";

interface CompanyRow {
  slug: string; name: string; ats_provider: string | null; ats_slug: string | null;
  tags: string; discovered_via: string | null; last_fit_at: string | null;
  last_scanned_at: string | null; dry_scans: number;
}
interface SourceRow {
  source_name: string; status: string; consecutive_fail_days: number; last_ok_at: string | null;
}

const parseTags = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Колекція Getro з нішею, яку вона диктує своїм вакансіям. */
export interface GetroCollection { id: number; tags: string[] }

export class Repo {
  constructor(private readonly d1: D1Client) {}

  // ── національні дошки ──────────────────────────────────────
  /**
   * Дошки живуть у базі, а не в коді: тому нова країна додається адресою з
   * адмінки й не потребує деплою.
   */
  async listBoards(): Promise<Board[]> {
    const rows = await this.d1.query<{ name: string; label: string; country: string; feed_url: string; kind: string }>(
      "SELECT name,label,country,feed_url,kind FROM country_boards WHERE enabled=1 ORDER BY country,name");
    return rows.map((r) => ({
      name: r.name, label: r.label, country: r.country, feedUrl: r.feed_url, kind: r.kind,
    }));
  }

  /**
   * Колекції Getro. Теж рядки, з тієї ж причини: борд екосистеми фонду
   * додається з адмінки посиланням, а не правкою масиву в scan.ts.
   *
   * Ніша належить конкретному борду, а не Getro загалом: колекція 858 — це
   * Solana, а 1200 — ізраїльська дошка з Teva й NVIDIA.
   */
  async listGetroCollections(): Promise<GetroCollection[]> {
    const rows = await this.d1.query<{ collection_id: number; tags: string | null }>(
      "SELECT collection_id, tags FROM getro_collections WHERE enabled=1 ORDER BY collection_id");
    return rows.map((r) => ({ id: r.collection_id, tags: parseTags(r.tags) }));
  }

  // ── вакансії ───────────────────────────────────────────────
  async upsertJobs(jobs: NormalizedJob[]): Promise<void> {
    if (jobs.length === 0) return;
    const statements: D1Statement[] = jobs.map((j) => {
      // Сирий текст оголошення в базу не пишемо ніколи — лише витяг.
      const summary = summarize(j.description, j.company);
      // Вилка з тексту — лише коли джерело не дало її окремим полем. Повний
      // текст є тільки тут, на скані: далі лишається витяг на 240 символів.
      const parsed = j.salaryMin == null && j.salaryMax == null ? extractSalary(j.description) : null;
      const salaryMin = j.salaryMin ?? parsed?.min ?? null;
      const salaryMax = j.salaryMax ?? parsed?.max ?? null;
      const salaryCurrency = j.salaryCurrency ?? parsed?.currency ?? null;
      return {
        sql: `INSERT INTO jobs_cache
                (id,url,company,company_key,title,location,remote,salary_min,salary_max,salary_currency,source,tags,dedupe_key,posted_at,fetched_at,country,summary,summary_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(url) DO UPDATE SET
                company=excluded.company, title=excluded.title, location=excluded.location,
                remote=excluded.remote, source=excluded.source, tags=excluded.tags,
                posted_at=excluded.posted_at, fetched_at=excluded.fetched_at,
                country=excluded.country,
                -- Вилку оновлюємо лише відомою: порожня з нового скану не
                -- має стерти витягнуту з тексту раніше.
                salary_min=COALESCE(excluded.salary_min, jobs_cache.salary_min),
                salary_max=COALESCE(excluded.salary_max, jobs_cache.salary_max),
                salary_currency=COALESCE(excluded.salary_currency, jobs_cache.salary_currency),
                -- Наявний опис не затираємо порожнім: джерело могло цього
                -- разу не віддати текст.
                summary=COALESCE(excluded.summary, jobs_cache.summary),
                summary_at=COALESCE(excluded.summary_at, jobs_cache.summary_at)`,
        params: [
          crypto.randomUUID(), j.url, j.company, j.companyKey, j.title, j.location,
          j.remote ? 1 : 0, salaryMin, salaryMax, salaryCurrency,
          j.source, JSON.stringify(j.tags), j.dedupeKey, j.postedAt, j.fetchedAt,
          j.country ?? null, summary, summary ? j.fetchedAt : null,
        ],
      };
    });
    await this.d1.batch(statements);
  }

  async countDistinctCompaniesSince(sinceIso: string): Promise<number> {
    const rows = await this.d1.query<{ n: number }>(
      "SELECT COUNT(DISTINCT company_key) AS n FROM jobs_cache WHERE fetched_at >= ?", [sinceIso]);
    return rows[0]?.n ?? 0;
  }

  async countJobs(): Promise<number> {
    const rows = await this.d1.query<{ n: number }>("SELECT COUNT(*) AS n FROM jobs_cache");
    return rows[0]?.n ?? 0;
  }

  // ── компанії ───────────────────────────────────────────────
  async listCompanies(): Promise<Company[]> {
    const rows = await this.d1.query<CompanyRow>("SELECT * FROM companies");
    return rows.map((r) => ({
      slug: r.slug, name: r.name,
      atsProvider: (r.ats_provider as AtsProvider | null) ?? null,
      atsSlug: r.ats_slug, tags: parseTags(r.tags),
      discoveredVia: r.discovered_via, lastFitAt: r.last_fit_at,
      lastScannedAt: r.last_scanned_at, dryScans: r.dry_scans,
    }));
  }

  async knownCompanyKeys(): Promise<Set<string>> {
    const rows = await this.d1.query<{ slug: string; name: string }>("SELECT slug,name FROM companies");
    const set = new Set<string>();
    for (const r of rows) { set.add(r.slug); set.add(r.name.toLowerCase()); }
    return set;
  }

  /** AUTO-GROW: знайдена компанія лишається джерелом назавжди. */
  async upsertCompany(c: {
    slug: string; name: string; provider: AtsProvider | null; atsSlug: string | null;
    tags?: string[]; discoveredVia?: string;
  }): Promise<void> {
    await this.d1.execute(
      `INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
       VALUES (?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET
         ats_provider=COALESCE(excluded.ats_provider, companies.ats_provider),
         ats_slug=COALESCE(excluded.ats_slug, companies.ats_slug),
         name=excluded.name,
         -- Теги оновлюємо, але лише коли є що записати: інакше повторна
         -- розвідка з порожнім результатом стерла б правильну нішу.
         tags=CASE WHEN excluded.tags != '[]' THEN excluded.tags ELSE companies.tags END`,
      [c.slug, c.name, c.provider, c.atsSlug, JSON.stringify(c.tags ?? []), c.discoveredVia ?? "manual"]);
  }

  async markCompanyScanned(slug: string, foundJobs: boolean): Promise<void> {
    await this.d1.execute(
      `UPDATE companies SET last_scanned_at=datetime('now'),
         last_fit_at = CASE WHEN ? THEN datetime('now') ELSE last_fit_at END,
         dry_scans   = CASE WHEN ? THEN 0 ELSE dry_scans + 1 END
       WHERE slug = ?`,
      [foundJobs ? 1 : 0, foundJobs ? 1 : 0, slug]);
  }

  // ── здоров'я джерел ────────────────────────────────────────
  async recordSourceOutcome(source: string, ok: boolean, jobs: number, error?: string): Promise<void> {
    if (ok) {
      await this.d1.execute(
        `INSERT INTO sources_state (source_name,status,last_ok_at,consecutive_fail_days,last_error,jobs_last_run,checked_at)
         VALUES (?,'ok',datetime('now'),0,NULL,?,datetime('now'))
         ON CONFLICT(source_name) DO UPDATE SET
           status='ok', last_ok_at=datetime('now'), consecutive_fail_days=0,
           last_error=NULL, jobs_last_run=excluded.jobs_last_run, checked_at=datetime('now')`,
        [source, jobs]);
      return;
    }
    await this.d1.execute(
      `INSERT INTO sources_state (source_name,status,consecutive_fail_days,last_error,jobs_last_run,checked_at)
       VALUES (?,'degraded',1,?,0,datetime('now'))
       ON CONFLICT(source_name) DO UPDATE SET
         status='degraded',
         -- Рахуємо ДНІ падінь, а не прогони: повторний скан того самого дня
         -- (наприклад, форсований watchdog) не має вбивати живе джерело.
         consecutive_fail_days = CASE
           WHEN date(COALESCE(sources_state.checked_at, '1970-01-01')) < date('now')
             THEN sources_state.consecutive_fail_days + 1
           ELSE MAX(sources_state.consecutive_fail_days, 1)
         END,
         last_error=excluded.last_error, jobs_last_run=0, checked_at=datetime('now')`,
      [source, (error ?? "невідома помилка").slice(0, 300)]);
  }

  async listSourceStates(): Promise<Array<{
    source: string; status: SourceStatus; consecutiveFailDays: number; everOk: boolean;
  }>> {
    const rows = await this.d1.query<SourceRow>("SELECT * FROM sources_state");
    return rows.map((r) => ({
      source: r.source_name,
      status: (r.status as SourceStatus) ?? "ok",
      consecutiveFailDays: r.consecutive_fail_days,
      everOk: r.last_ok_at !== null,
    }));
  }

  async deprecateSource(source: string): Promise<void> {
    await this.d1.execute("UPDATE sources_state SET status='deprecated' WHERE source_name=?", [source]);
  }

  async getSourceKey(source: string): Promise<string | null> {
    const rows = await this.d1.query<{ key_value: string }>(
      "SELECT key_value FROM source_keys WHERE source_name=?", [source]);
    return rows[0]?.key_value ?? null;
  }

  // ── прогони ────────────────────────────────────────────────
  async startRun(id: string, startedAt: string): Promise<void> {
    // OR IGNORE: D1 тепер повторює запити, і таймаут ПІСЛЯ коміту дав би
    // конфлікт ключа на другій спробі — прогін помирав би, не почавшись.
    await this.d1.execute("INSERT OR IGNORE INTO scan_runs (id,started_at,status) VALUES (?,?,'running')", [id, startedAt]);
  }

  async finishRun(id: string, o: {
    distinctCompanies: number; jobsFound: number; ladderReached: string;
    status: "ok" | "short" | "failed"; notes: string;
  }): Promise<void> {
    await this.d1.execute(
      `UPDATE scan_runs SET finished_at=datetime('now'), distinct_companies=?, jobs_found=?,
         ladder_reached=?, status=?, notes=? WHERE id=?`,
      [o.distinctCompanies, o.jobsFound, o.ladderReached, o.status, o.notes.slice(0, 4000), id]);
  }

  async lastRunSince(sinceIso: string): Promise<{ id: string; distinctCompanies: number; status: string } | null> {
    const rows = await this.d1.query<{ id: string; distinct_companies: number; status: string }>(
      "SELECT id,distinct_companies,status FROM scan_runs WHERE started_at>=? ORDER BY started_at DESC LIMIT 1",
      [sinceIso]);
    const r = rows[0];
    return r ? { id: r.id, distinctCompanies: r.distinct_companies, status: r.status } : null;
  }
}
