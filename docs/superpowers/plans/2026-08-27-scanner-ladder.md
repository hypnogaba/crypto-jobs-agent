# Scan Engine (ladder R1–R5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the job-search scan engine — a full TypeScript port of the R1–R5 escalation ladder described in `docs/reference/job-search-engine-spec.md` — that runs daily, writes normalized vacancies into Cloudflare D1, and never reports "nothing found" without proving how deep it dug.

**Architecture:** A standalone Node service in `scanner/`, run by a systemd timer on the project's existing always-on Linux host. It talks to Cloudflare D1 over the D1 REST API rather than a Workers binding. Cloudflare Workers was evaluated first and rejected: the free plan caps a Worker invocation at 10 ms CPU and 50 external subrequests, while one full ladder pass needs roughly 50–90 subrequests and parses several megabytes of aggregator JSON. The web app stays on Workers; only the scanner moves to the host. A second systemd timer runs a watchdog that re-checks the day's *result* (distinct companies with live URLs), not merely whether the job started.

**Tech Stack:** Node 24 (native `fetch`), TypeScript compiled with `tsc`, Vitest for tests, `@anthropic-ai/sdk` for the R5 source-expansion step, Cloudflare D1 REST API for storage, systemd service + timer units for scheduling.

---

---

## ⚠ Ревізія 2026-08-27 (після застосування схеми)

Цей план написаний **до** того, як була ухвалена продуктова модель і застосована
канонічна схема. Що змінилось і що робити виконавцю:

1. **Таблиця `companies` більше не існує — тепер `companies`**, і в неї
   додані `tags`, `discovered_via`, `last_scanned_at`, `dry_scans`. Скрізь у цьому
   плані читати `companies` як `companies` і мапити поля відповідно.
2. **Task 2 (створення схеми) вже виконаний.** Схема лежить у `db/migrations/0001_schema.sql`
   і застосована до віддаленої D1 — десять таблиць. Task 2 пропустити повністю.
3. **`jobs_cache` тепер має `tags`, `salary_min`, `salary_max`, `salary_currency`.**
   Це основа маршрутизації за нішами: кожна вакансія успадковує теги свого джерела
   плюс отримує власні з назви посади.
4. **`sources_state` має `jobs_last_run` і `checked_at`** — їх заповнює адмінка.
5. **Додати шість ATS-адаптерів**, підтверджених живими запитами й відсутніх у
   Task 7: Workable, SmartRecruiters, Workday, Breezy, Personio, Rippling. Разом
   із трьома наявними це дев'ять провайдерів. Workday особливо цінний — розблоковує
   великий ентерпрайз (NVIDIA віддала 2000 позицій).
6. **Додати перебір колекцій Getro** окремим кроком у R3. Живих колекцій ~890,
   у них 80% прямих ATS-лінків — це головне джерело нових компаній.
7. **R4 (вгадування слага) має виміряну ефективність 45%** і є другим механізмом
   росту. Пріоритет вищий, ніж передбачав початковий план.
8. **R5 лишається необов'язковим.** Без `ANTHROPIC_API_KEY` рівень пропускається,
   драбина зупиняється на R4 — це працює, просто вужче.

Причина «жодних плейсхолдерів» лишається чинною: код у кроках нижче робочий,
змінюються лише імена таблиць і додаються джерела.

---

## Context the implementer needs

Read `docs/reference/job-search-engine-spec.md` first — it is the behavioural contract this plan implements. Key rules that shape the code:

- **"Nothing new" is not an acceptable result.** If a pass yields fewer than `DISTINCT_COMPANY_TARGET` (7) distinct companies, the ladder escalates to the next rung.
- **A broken source is not an empty source.** HTTP 401/403/404/406/410/429 or a Cloudflare challenge means *unavailable*; it must never be counted as "0 vacancies found".
- **Every job needs a live URL.** A row without a usable URL is dropped.
- **Geo-clones collapse.** The same role posted in five countries is one row.
- **The company list grows itself.** Any company that produces a fit is appended to `companies` and swept on every later run.

Three findings from live probing done while writing this plan — they are already baked into the code below, do not "fix" them back:

1. **Getro returns `406` without an `Accept: application/json` header.** The spec lists 406 as a dead-source signal, so Getro has been silently counted as dead. With the header it returns data normally.
2. **Ashby's field is `jobUrl`, Lever's title field is `text`, not `title`.** Both verified against live responses.
3. **RemoteOK's first array element is a legal notice, not a job.** It must be skipped, and their terms require attribution and a followable link back — the same applies to Remotive.

---

## File structure

```
scanner/
  package.json              — deps, scripts (build/test/scan/watchdog)
  tsconfig.json             — ESM, NodeNext, strict
  vitest.config.ts
  .env.example              — documents every required variable
  migrations/
    0002_scanner.sql        — jobs_cache, sources_state, companies, scan_runs
  deploy/
    jobs-scanner.service    — oneshot unit running the scan
    jobs-scanner.timer      — Mon–Fri 05:00
    jobs-watchdog.service   — oneshot unit running the watchdog
    jobs-watchdog.timer     — Mon–Fri 08:00
  src/
    types.ts                — RawJob, NormalizedJob, SourceResult, ladder types
    config.ts               — env loading + thresholds
    http.ts                 — fetchJson, SourceUnavailableError, broken-source classification
    d1.ts                   — D1Client over the REST API
    normalize.ts            — company key, geo-clone dedupe key, freshness, RawJob → NormalizedJob
    repo.ts                 — typed accessors for the four tables
    sources/greenhouse.ts   — R1 ATS adapter
    sources/lever.ts        — R1 ATS adapter
    sources/ashby.ts        — R1 ATS adapter
    sources/arbeitnow.ts    — R2 aggregator
    sources/remotive.ts     — R2 aggregator
    sources/remoteok.ts     — R2 aggregator
    sources/hn.ts           — R2 aggregator (Who is hiring thread)
    sources/getro.ts        — R3 ecosystem boards
    rungs/r1-standing.ts    — sweep standing companies, resolve which ATS each uses
    rungs/r2-aggregators.ts — run the four aggregators
    rungs/r3-getro.ts       — run configured Getro collections
    rungs/r4-discovery.ts   — rotational role-keyword discovery of NEW companies
    rungs/r5-expand.ts      — Claude proposes new sources, verified before use
    selfrepair.ts           — sources_state transitions, deprecation, broken-source handling
    ladder.ts               — orchestrates R1→R5 against the distinct-company gate
    scan.ts                 — scan entrypoint, writes a scan_runs record
    watchdog.ts             — watchdog entrypoint
```

Each source adapter has one job: fetch one endpoint and return `SourceResult`. They never touch D1, never decide freshness, and never dedupe — that all happens once, centrally, in `normalize.ts` and `ladder.ts`. This is what keeps adding a new source cheap.

---

### Task 1: Scaffold the scanner project

**Files:**
- Create: `scanner/package.json`
- Create: `scanner/tsconfig.json`
- Create: `scanner/vitest.config.ts`
- Create: `scanner/.env.example`
- Create: `scanner/src/types.ts`
- Create: `scanner/src/config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create `scanner/package.json`**

```json
{
  "name": "scanner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "scan": "node dist/scan.js",
    "watchdog": "node dist/watchdog.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.121.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "typescript": "^5.9.3",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Create `scanner/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `scanner/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Create `scanner/src/types.ts`**

```typescript
/** A vacancy exactly as a source returned it, before any normalization. */
export interface RawJob {
  /** Live, directly-openable application URL. Rows without one are dropped. */
  url: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  /** ISO-8601, or null when the source does not publish a date. */
  postedAt: string | null;
  /** Source identity, e.g. "ashby:elevenlabs" or "aggregator:remotive". */
  source: string;
}

export interface NormalizedJob extends RawJob {
  /** Collapses geo-clones: same company + same role = one key. */
  dedupeKey: string;
  /** Company identity with legal suffixes and punctuation stripped. */
  companyKey: string;
  fetchedAt: string;
}

export type SourceStatus = "ok" | "degraded" | "deprecated";

/** What every source adapter returns. Adapters never throw for source-side failures. */
export interface SourceResult {
  source: string;
  ok: boolean;
  jobs: RawJob[];
  /** Human-readable failure reason, present when ok is false. */
  error?: string;
  /**
   * True when the source itself was unreachable (paywall, block, 404, rate limit).
   * A broken source must never be counted as "found nothing".
   */
  broken?: boolean;
}

export type AtsProvider = "greenhouse" | "lever" | "ashby";

export interface Company {
  slug: string;
  name: string;
  atsProvider: AtsProvider | null;
  atsSlug: string | null;
  track: "A" | "B";
  addedAt: string;
  lastFitAt: string | null;
}

export type Rung = "R1" | "R2" | "R3" | "R4" | "R5";

export interface RungOutcome {
  rung: Rung;
  sourcesTried: number;
  sourcesBroken: number;
  jobsFound: number;
  distinctCompaniesAfter: number;
}
```

- [ ] **Step 5: Create `scanner/src/config.ts`**

```typescript
export interface Config {
  cfAccountId: string;
  cfDatabaseId: string;
  cfApiToken: string;
  anthropicApiKey: string | null;
  freshnessDays: number;
  /** Ladder keeps escalating until this many distinct companies are found. */
  distinctCompanyTarget: number;
  /** Watchdog forces a re-run below this many distinct companies. */
  watchdogFloor: number;
  /** Getro collection ids to sweep. 858 is the Solana ecosystem board. */
  getroCollectionIds: number[];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    cfAccountId: required("CF_ACCOUNT_ID"),
    cfDatabaseId: required("CF_D1_DATABASE_ID"),
    cfApiToken: required("CF_API_TOKEN"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    freshnessDays: intFromEnv("FRESHNESS_DAYS", 14),
    distinctCompanyTarget: intFromEnv("DISTINCT_COMPANY_TARGET", 7),
    watchdogFloor: intFromEnv("WATCHDOG_FLOOR", 5),
    getroCollectionIds: (process.env.GETRO_COLLECTION_IDS ?? "858")
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n)),
  };
}
```

- [ ] **Step 6: Create `scanner/.env.example`**

```
# Cloudflare D1 access. The API token needs the "D1:Edit" permission —
# the existing Workers-deploy token does NOT have it, create a new one.
CF_ACCOUNT_ID=
CF_D1_DATABASE_ID=
CF_API_TOKEN=

# Optional. Without it, rung R5 (Claude proposes new sources) is skipped
# and the ladder stops at R4.
ANTHROPIC_API_KEY=

# Tuning — the defaults match docs/reference/job-search-engine-spec.md
FRESHNESS_DAYS=14
DISTINCT_COMPANY_TARGET=7
WATCHDOG_FLOOR=5
GETRO_COLLECTION_IDS=858
```

- [ ] **Step 7: Ignore build output and local env**

Append to the repository root `.gitignore`:

```
# scanner build output and local secrets
scanner/dist/
scanner/node_modules/
scanner/.env
```

- [ ] **Step 8: Install and verify the toolchain**

Run from `scanner/`:
```bash
npm install
npx tsc --noEmit
```
Expected: install completes, `tsc` prints nothing (no files reference anything missing yet).

- [ ] **Step 9: Commit**

```bash
git add scanner/package.json scanner/package-lock.json scanner/tsconfig.json \
        scanner/vitest.config.ts scanner/.env.example scanner/src/types.ts \
        scanner/src/config.ts .gitignore
git commit -m "scanner: scaffold project, types and config"
```

---

### Task 2: D1 schema for the scanner

**Files:**
- Create: `scanner/migrations/0002_scanner.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Shared vacancy cache. One scan serves every user; matching is per-user later.
CREATE TABLE IF NOT EXISTS jobs_cache (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL UNIQUE,
    company      TEXT NOT NULL,
    company_key  TEXT NOT NULL,
    title        TEXT NOT NULL,
    location     TEXT,
    remote       INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL,
    dedupe_key   TEXT NOT NULL,
    posted_at    TEXT,
    fetched_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_cache_dedupe   ON jobs_cache(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_jobs_cache_company  ON jobs_cache(company_key);
CREATE INDEX IF NOT EXISTS idx_jobs_cache_fetched  ON jobs_cache(fetched_at);

-- Health of every source. A source that breaks is deprecated, never treated as empty.
CREATE TABLE IF NOT EXISTS sources_state (
    source_name           TEXT PRIMARY KEY,
    status                TEXT NOT NULL DEFAULT 'ok',
    last_ok_at            TEXT,
    consecutive_fail_days INTEGER NOT NULL DEFAULT 0,
    last_error            TEXT
);

-- Auto-growing company list. Any company that yields a fit is swept forever after.
CREATE TABLE IF NOT EXISTS companies (
    slug         TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    ats_provider TEXT,
    ats_slug     TEXT,
    track        TEXT NOT NULL,
    added_at     TEXT NOT NULL,
    last_fit_at  TEXT
);

-- Proof of work. The watchdog reads this to judge the day by its result.
CREATE TABLE IF NOT EXISTS scan_runs (
    id                  TEXT PRIMARY KEY,
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    distinct_companies  INTEGER NOT NULL DEFAULT 0,
    jobs_found          INTEGER NOT NULL DEFAULT 0,
    ladder_reached      TEXT,
    status              TEXT NOT NULL DEFAULT 'running',
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at);

-- Seed the standing list from the working engine's proven set.
INSERT OR IGNORE INTO companies (slug, name, ats_provider, ats_slug, track, added_at) VALUES
    ('datadog',           'Datadog',           NULL, NULL, 'A', datetime('now')),
    ('remote-com',        'Remote.com',        NULL, NULL, 'A', datetime('now')),
    ('elastic',           'Elastic',           NULL, NULL, 'A', datetime('now')),
    ('supabase',          'Supabase',          NULL, NULL, 'A', datetime('now')),
    ('lemlist',           'lemlist',           NULL, NULL, 'A', datetime('now')),
    ('nivoda',            'Nivoda',            NULL, NULL, 'A', datetime('now')),
    ('n8n',               'n8n',               NULL, NULL, 'A', datetime('now')),
    ('synthesia',         'Synthesia',         NULL, NULL, 'A', datetime('now')),
    ('doctolib',          'Doctolib',          NULL, NULL, 'A', datetime('now')),
    ('mistral',           'Mistral AI',        NULL, NULL, 'A', datetime('now')),
    ('elevenlabs',        'ElevenLabs',        'ashby', 'elevenlabs', 'A', datetime('now')),
    ('filigran',          'Filigran',          NULL, NULL, 'A', datetime('now')),
    ('helsing',           'Helsing',           NULL, NULL, 'A', datetime('now')),
    ('auterion',          'Auterion',          NULL, NULL, 'A', datetime('now')),
    ('solana-foundation', 'Solana Foundation', NULL, NULL, 'B', datetime('now')),
    ('squads',            'Squads',            NULL, NULL, 'B', datetime('now')),
    ('cow-dao',           'CoW DAO',           NULL, NULL, 'B', datetime('now')),
    ('solflare',          'Solflare',          NULL, NULL, 'B', datetime('now')),
    ('ondo',              'Ondo Finance',      NULL, NULL, 'B', datetime('now')),
    ('trust-wallet',      'Trust Wallet',      NULL, NULL, 'B', datetime('now')),
    ('yo-labs',           'Yo Labs',           NULL, NULL, 'B', datetime('now')),
    ('kraken',            'Kraken',            NULL, NULL, 'B', datetime('now'));
```

- [ ] **Step 2: Confirm the API token can write to D1**

The Cloudflare token used for Workers deploys does **not** carry D1 permissions. Create a Custom Token in the Cloudflare dashboard with `Account → D1 → Edit`, then verify it (substitute your own values, and do not paste them into any file that is committed):

```bash
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database/$CF_D1_DATABASE_ID/query" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT name FROM sqlite_master WHERE type = ?","params":["table"]}'
```
Expected: `"success": true` and a `result[0].results` array listing the tables created by `web/migrations/0001_init.sql` (`User`, `CandidateProfile`, `JobSignal`, `DailyCard`).
If you get `"code": 10000` / `Authentication error`, the token lacks D1 permission — fix the token before continuing.

- [ ] **Step 3: Apply the migration to the remote database**

Run from `web/` (that is where the wrangler config with the D1 binding lives):
```bash
npx wrangler d1 execute crypto-jobs-agent --remote --file=../scanner/migrations/0002_scanner.sql
```
Expected: wrangler reports the commands executed successfully.

- [ ] **Step 4: Verify the seed landed**

```bash
npx wrangler d1 execute crypto-jobs-agent --remote \
  --command "SELECT track, COUNT(*) AS n FROM companies GROUP BY track"
```
Expected: two rows — track `A` with 14, track `B` with 8.

- [ ] **Step 5: Commit**

```bash
git add scanner/migrations/0002_scanner.sql
git commit -m "scanner: D1 schema for jobs cache, source health and standing companies"
```

---

### Task 3: D1 REST client

**Files:**
- Create: `scanner/src/d1.ts`
- Test: `scanner/src/d1.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { D1Client } from "./d1.js";

function clientWithFetch(fetchImpl: typeof fetch): D1Client {
  return new D1Client(
    { accountId: "acct", databaseId: "db", token: "tok" },
    fetchImpl
  );
}

describe("D1Client", () => {
  it("posts sql and params to the D1 query endpoint and returns rows", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [{ success: true, results: [{ id: "a" }], meta: {} }],
          errors: [],
        }),
        { status: 200 }
      )
    );

    const rows = await clientWithFetch(fetchMock as unknown as typeof fetch)
      .query<{ id: string }>("SELECT id FROM t WHERE x = ?", ["v"]);

    expect(rows).toEqual([{ id: "a" }]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db/query"
    );
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({
      sql: "SELECT id FROM t WHERE x = ?",
      params: ["v"],
    });
  });

  it("throws with the Cloudflare error message when success is false", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          result: [],
          errors: [{ code: 7500, message: "no such table: nope" }],
        }),
        { status: 200 }
      )
    );

    await expect(
      clientWithFetch(fetchMock as unknown as typeof fetch).query("SELECT 1")
    ).rejects.toThrow("no such table: nope");
  });

  it("splits a batch into chunks so one call never exceeds the statement cap", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, result: [], errors: [] }),
        { status: 200 }
      )
    );

    const statements = Array.from({ length: 55 }, (_, i) => ({
      sql: "INSERT INTO t VALUES (?)",
      params: [i],
    }));

    await clientWithFetch(fetchMock as unknown as typeof fetch).batch(statements);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).batch).toHaveLength(50);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).batch).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/d1.test.ts`
Expected: FAIL — `Failed to resolve import "./d1.js"`.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Cloudflare D1 over the REST API.
 *
 * The scanner runs on a normal Linux host, not inside a Worker, so there is no
 * D1 binding available — every statement goes over HTTPS instead.
 */

export interface D1Credentials {
  accountId: string;
  databaseId: string;
  token: string;
}

export interface D1Statement {
  sql: string;
  params?: unknown[];
}

interface D1Envelope<T> {
  success: boolean;
  result: Array<{ success: boolean; results?: T[]; meta?: unknown }>;
  errors: Array<{ code: number; message: string }>;
}

/** D1 rejects very large batches; 50 statements per call stays comfortably under. */
const MAX_STATEMENTS_PER_CALL = 50;

export class D1Client {
  private readonly endpoint: string;

  constructor(
    private readonly creds: D1Credentials,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}` +
      `/d1/database/${creds.databaseId}/query`;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const envelope = await this.post<T>({ sql, params });
    return envelope.result[0]?.results ?? [];
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.post({ sql, params });
  }

  async batch(statements: D1Statement[]): Promise<void> {
    for (let i = 0; i < statements.length; i += MAX_STATEMENTS_PER_CALL) {
      const chunk = statements.slice(i, i + MAX_STATEMENTS_PER_CALL);
      await this.post({
        batch: chunk.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      });
    }
  }

  private async post<T>(body: unknown): Promise<D1Envelope<T>> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`D1 HTTP ${response.status}: ${await response.text()}`);
    }

    const envelope = (await response.json()) as D1Envelope<T>;
    if (!envelope.success) {
      const detail = envelope.errors.map((e) => e.message).join("; ") || "unknown D1 error";
      throw new Error(`D1 query failed: ${detail}`);
    }
    return envelope;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/d1.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/d1.ts scanner/src/d1.test.ts
git commit -m "scanner: D1 REST client with chunked batches"
```

---

### Task 4: HTTP helper that tells "broken" apart from "empty"

**Files:**
- Create: `scanner/src/http.ts`
- Test: `scanner/src/http.test.ts`

This is the single most important safety rule in the whole engine: a source that is blocked, paywalled or rate-limited must never be recorded as having found nothing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchJson, SourceUnavailableError, isBrokenStatus } from "./http.js";

describe("isBrokenStatus", () => {
  it("treats auth, block, missing, rate-limit and not-acceptable as broken", () => {
    for (const status of [401, 402, 403, 404, 406, 410, 429]) {
      expect(isBrokenStatus(status)).toBe(true);
    }
  });

  it("does not treat success or server errors as broken", () => {
    expect(isBrokenStatus(200)).toBe(false);
    expect(isBrokenStatus(500)).toBe(false);
  });
});

describe("fetchJson", () => {
  it("returns parsed JSON on success", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ hello: "world" }), { status: 200 })
    );
    const data = await fetchJson<{ hello: string }>(
      "https://example.test/x",
      {},
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );
    expect(data).toEqual({ hello: "world" });
  });

  it("raises SourceUnavailableError on a broken status without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(
      fetchJson("https://example.test/x", {}, {
        fetchImpl: fetchMock as unknown as typeof fetch,
        retries: 2,
      })
    ).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detects a Cloudflare interstitial served with status 200", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
    await expect(
      fetchJson("https://example.test/x", {}, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("retries server errors then gives up as unavailable", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(
      fetchJson("https://example.test/x", {}, {
        fetchImpl: fetchMock as unknown as typeof fetch,
        retries: 2,
        retryDelayMs: 0,
      })
    ).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/http.test.ts`
Expected: FAIL — `Failed to resolve import "./http.js"`.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * HTTP access for source adapters.
 *
 * The one rule that matters here: distinguish "this source is unreachable"
 * from "this source legitimately returned nothing". Everything downstream —
 * self-repair, the escalation ladder, the watchdog — depends on that split.
 */

export class SourceUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}

/** Statuses that mean the door is shut, not that the room is empty. */
const BROKEN_STATUSES = new Set([401, 402, 403, 404, 406, 410, 429]);

export function isBrokenStatus(status: number): boolean {
  return BROKEN_STATUSES.has(status);
}

export interface FetchJsonOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

const CHALLENGE_MARKERS = [
  "just a moment",
  "attention required",
  "checking your browser",
  "enable javascript and cookies",
];

const DEFAULT_HEADERS: Record<string, string> = {
  // Several boards 406 or 403 a request without these. Getro in particular
  // returns 406 with no Accept header — that is why it looked dead.
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; job-scanner/1.0)",
};

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  options: FetchJsonOptions = {}
): Promise<T> {
  const {
    fetchImpl = fetch,
    timeoutMs = 25_000,
    retries = 2,
    retryDelayMs = 1_000,
  } = options;

  let lastError: Error = new SourceUnavailableError(`No attempt made for ${url}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: { ...DEFAULT_HEADERS, ...(init.headers as Record<string, string>) },
      });

      // A shut door is final — retrying a 403 just burns time.
      if (isBrokenStatus(response.status)) {
        throw new SourceUnavailableError(
          `${url} returned ${response.status}`,
          response.status
        );
      }

      if (!response.ok) {
        lastError = new Error(`${url} returned ${response.status}`);
      } else {
        const text = await response.text();
        const head = text.slice(0, 500).toLowerCase();
        if (CHALLENGE_MARKERS.some((marker) => head.includes(marker))) {
          throw new SourceUnavailableError(`${url} served a bot challenge page`);
        }
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new SourceUnavailableError(`${url} did not return JSON`);
        }
      }
    } catch (error) {
      if (error instanceof SourceUnavailableError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new SourceUnavailableError(`${url} failed after retries: ${lastError.message}`);
}

/** Wraps an adapter so a source failure becomes data, never an exception. */
export async function runSource(
  source: string,
  fn: () => Promise<import("./types.js").RawJob[]>
): Promise<import("./types.js").SourceResult> {
  try {
    return { source, ok: true, jobs: await fn() };
  } catch (error) {
    const broken = error instanceof SourceUnavailableError;
    return {
      source,
      ok: false,
      jobs: [],
      broken,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/http.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/http.ts scanner/src/http.test.ts
git commit -m "scanner: HTTP helper that separates unreachable sources from empty ones"
```

---

### Task 5: Normalization, geo-clone dedupe and freshness

**Files:**
- Create: `scanner/src/normalize.ts`
- Test: `scanner/src/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { companyKey, dedupeKey, isFresh, normalizeJob, dropWithoutUrl } from "./normalize.js";
import type { RawJob } from "./types.js";

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    url: "https://jobs.example.com/1",
    company: "Example Inc.",
    title: "Partnerships Manager",
    location: "Remote",
    remote: true,
    postedAt: "2026-08-20T00:00:00.000Z",
    source: "ashby:example",
    ...overrides,
  };
}

describe("companyKey", () => {
  it("strips legal suffixes, punctuation and case", () => {
    expect(companyKey("Example Inc.")).toBe("example");
    expect(companyKey("EXAMPLE  GmbH")).toBe("example");
    expect(companyKey("Ex-ample, Ltd")).toBe("example");
  });

  it("keeps distinct companies distinct", () => {
    expect(companyKey("Solana Foundation")).not.toBe(companyKey("Solana Labs"));
  });
});

describe("dedupeKey", () => {
  it("collapses the same role posted in different countries", () => {
    const berlin = raw({ location: "Berlin, Germany", url: "https://x.test/de" });
    const lisbon = raw({ location: "Lisbon, Portugal", url: "https://x.test/pt" });
    expect(dedupeKey(berlin)).toBe(dedupeKey(lisbon));
  });

  it("keeps different roles at the same company apart", () => {
    expect(dedupeKey(raw({ title: "Partnerships Manager" })))
      .not.toBe(dedupeKey(raw({ title: "Backend Engineer" })));
  });

  it("ignores seniority punctuation noise in titles", () => {
    expect(dedupeKey(raw({ title: "Partnerships Manager (m/f/d)" })))
      .toBe(dedupeKey(raw({ title: "Partnerships  Manager" })));
  });
});

describe("isFresh", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");

  it("accepts a posting inside the window", () => {
    expect(isFresh("2026-08-20T00:00:00.000Z", 14, now)).toBe(true);
  });

  it("rejects a posting older than the window", () => {
    expect(isFresh("2026-07-01T00:00:00.000Z", 14, now)).toBe(false);
  });

  it("accepts an unknown date — many boards publish none, and dropping them loses real roles", () => {
    expect(isFresh(null, 14, now)).toBe(true);
  });
});

describe("dropWithoutUrl", () => {
  it("removes rows with no usable http URL", () => {
    const jobs = [raw(), raw({ url: "" }), raw({ url: "mailto:a@b.c" })];
    expect(dropWithoutUrl(jobs)).toHaveLength(1);
  });
});

describe("normalizeJob", () => {
  it("adds keys and a fetch timestamp without altering the source fields", () => {
    const normalized = normalizeJob(raw(), new Date("2026-08-27T06:00:00.000Z"));
    expect(normalized.companyKey).toBe("example");
    expect(normalized.dedupeKey).toBe("example|partnerships manager");
    expect(normalized.fetchedAt).toBe("2026-08-27T06:00:00.000Z");
    expect(normalized.url).toBe(raw().url);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "./normalize.js"`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { NormalizedJob, RawJob } from "./types.js";

/** Suffixes that say nothing about company identity. */
const LEGAL_SUFFIXES = [
  "inc", "inc.", "llc", "ltd", "ltd.", "limited", "gmbh", "ag", "bv", "b.v.",
  "nv", "sa", "s.a.", "sas", "sarl", "oy", "ab", "as", "aps", "plc", "corp",
  "corporation", "co", "company", "labs", "technologies",
];

/**
 * Noise that varies between postings of the same role. Stripping it is what
 * makes geo-clone dedup work: "Partnerships Manager (m/f/d)" in Berlin and
 * "Partnerships Manager" in Lisbon must collapse to one row.
 */
const TITLE_NOISE = /\((?:m\/f\/d|m\/w\/d|m\/f\/x|h\/f|remote|hybrid|contract)\)/gi;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function companyKey(name: string): string {
  const words = collapse(
    name.toLowerCase().replace(/[^a-z0-9\s.]/g, " ")
  ).split(" ");

  const kept = words.filter((word, index) => {
    // Only strip a suffix when it trails — "Labs" in "Yo Labs" is identity,
    // but a company must never reduce to an empty key.
    if (index === 0) return true;
    return !LEGAL_SUFFIXES.includes(word);
  });

  return collapse(kept.join(" ").replace(/\./g, ""));
}

export function titleKey(title: string): string {
  return collapse(
    title
      .toLowerCase()
      .replace(TITLE_NOISE, " ")
      .replace(/[^a-z0-9\s]/g, " ")
  );
}

/** Company + role. Location is deliberately absent — that is the geo-clone rule. */
export function dedupeKey(job: RawJob): string {
  return `${companyKey(job.company)}|${titleKey(job.title)}`;
}

export function isFresh(
  postedAt: string | null,
  freshnessDays: number,
  now: Date = new Date()
): boolean {
  if (!postedAt) return true;
  const posted = new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return true;
  const ageDays = (now.getTime() - posted.getTime()) / 86_400_000;
  return ageDays <= freshnessDays;
}

export function dropWithoutUrl(jobs: RawJob[]): RawJob[] {
  return jobs.filter((job) => /^https?:\/\/\S+$/i.test(job.url.trim()));
}

export function normalizeJob(job: RawJob, now: Date = new Date()): NormalizedJob {
  return {
    ...job,
    companyKey: companyKey(job.company),
    dedupeKey: dedupeKey(job),
    fetchedAt: now.toISOString(),
  };
}

/**
 * Applies every central rule at once: drop URL-less rows, drop stale rows,
 * normalize, then collapse duplicates keeping the first occurrence.
 */
export function prepare(
  jobs: RawJob[],
  freshnessDays: number,
  now: Date = new Date()
): NormalizedJob[] {
  const seen = new Set<string>();
  const out: NormalizedJob[] = [];

  for (const job of dropWithoutUrl(jobs)) {
    if (!isFresh(job.postedAt, freshnessDays, now)) continue;
    const normalized = normalizeJob(job, now);
    if (seen.has(normalized.dedupeKey)) continue;
    seen.add(normalized.dedupeKey);
    out.push(normalized);
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/normalize.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/normalize.ts scanner/src/normalize.test.ts
git commit -m "scanner: normalization with geo-clone dedupe and freshness window"
```

---

### Task 6: Repository layer over D1

**Files:**
- Create: `scanner/src/repo.ts`
- Test: `scanner/src/repo.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { Repo } from "./repo.js";
import type { D1Client } from "./d1.js";
import type { NormalizedJob } from "./types.js";

function fakeD1(rows: unknown[] = []) {
  return {
    query: vi.fn(async () => rows),
    execute: vi.fn(async () => undefined),
    batch: vi.fn(async () => undefined),
  } as unknown as D1Client & {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    batch: ReturnType<typeof vi.fn>;
  };
}

const job: NormalizedJob = {
  url: "https://jobs.example.com/1",
  company: "Example",
  companyKey: "example",
  title: "Partnerships Manager",
  location: "Remote",
  remote: true,
  postedAt: "2026-08-20T00:00:00.000Z",
  source: "ashby:example",
  dedupeKey: "example|partnerships manager",
  fetchedAt: "2026-08-27T05:00:00.000Z",
};

describe("Repo.upsertJobs", () => {
  it("writes nothing when given no jobs", async () => {
    const d1 = fakeD1();
    await new Repo(d1).upsertJobs([]);
    expect(d1.batch).not.toHaveBeenCalled();
  });

  it("upserts on the url so a re-scan refreshes instead of duplicating", async () => {
    const d1 = fakeD1();
    await new Repo(d1).upsertJobs([job]);

    const statements = d1.batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain("ON CONFLICT(url) DO UPDATE");
    expect(statements[0]!.params).toContain("https://jobs.example.com/1");
    expect(statements[0]!.params).toContain(1); // remote stored as integer
  });
});

describe("Repo.countDistinctCompaniesSince", () => {
  it("returns the counted value", async () => {
    const d1 = fakeD1([{ n: 9 }]);
    const count = await new Repo(d1).countDistinctCompaniesSince("2026-08-27T00:00:00.000Z");
    expect(count).toBe(9);
  });

  it("returns zero when the query yields no rows", async () => {
    const d1 = fakeD1([]);
    expect(await new Repo(d1).countDistinctCompaniesSince("x")).toBe(0);
  });
});

describe("Repo.recordSourceOutcome", () => {
  it("resets the failure counter and stamps last_ok_at on success", async () => {
    const d1 = fakeD1();
    await new Repo(d1).recordSourceOutcome("aggregator:remotive", true);
    const [sql, params] = d1.execute.mock.calls[0]!;
    expect(sql).toContain("consecutive_fail_days = 0");
    expect(params).toContain("aggregator:remotive");
  });

  it("increments the failure counter on failure", async () => {
    const d1 = fakeD1();
    await new Repo(d1).recordSourceOutcome("aggregator:remotive", false, "403");
    const [sql] = d1.execute.mock.calls[0]!;
    expect(sql).toContain("consecutive_fail_days = sources_state.consecutive_fail_days + 1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/repo.test.ts`
Expected: FAIL — `Failed to resolve import "./repo.js"`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { D1Client, D1Statement } from "./d1.js";
import type { NormalizedJob, SourceStatus, Company, AtsProvider } from "./types.js";

interface StandingRow {
  slug: string;
  name: string;
  ats_provider: string | null;
  ats_slug: string | null;
  track: string;
  added_at: string;
  last_fit_at: string | null;
}

interface SourceStateRow {
  source_name: string;
  status: string;
  last_ok_at: string | null;
  consecutive_fail_days: number;
  last_error: string | null;
}

export class Repo {
  constructor(private readonly d1: D1Client) {}

  async upsertJobs(jobs: NormalizedJob[]): Promise<void> {
    if (jobs.length === 0) return;

    const statements: D1Statement[] = jobs.map((job) => ({
      sql: `
        INSERT INTO jobs_cache
          (id, url, company, company_key, title, location, remote, source, dedupe_key, posted_at, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          company    = excluded.company,
          title      = excluded.title,
          location   = excluded.location,
          remote     = excluded.remote,
          source     = excluded.source,
          posted_at  = excluded.posted_at,
          fetched_at = excluded.fetched_at
      `,
      params: [
        crypto.randomUUID(),
        job.url,
        job.company,
        job.companyKey,
        job.title,
        job.location,
        job.remote ? 1 : 0,
        job.source,
        job.dedupeKey,
        job.postedAt,
        job.fetchedAt,
      ],
    }));

    await this.d1.batch(statements);
  }

  async countDistinctCompaniesSince(sinceIso: string): Promise<number> {
    const rows = await this.d1.query<{ n: number }>(
      "SELECT COUNT(DISTINCT company_key) AS n FROM jobs_cache WHERE fetched_at >= ?",
      [sinceIso]
    );
    return rows[0]?.n ?? 0;
  }

  async knownDedupeKeys(): Promise<Set<string>> {
    const rows = await this.d1.query<{ dedupe_key: string }>(
      "SELECT DISTINCT dedupe_key FROM jobs_cache"
    );
    return new Set(rows.map((r) => r.dedupe_key));
  }

  async listCompanies(): Promise<Company[]> {
    const rows = await this.d1.query<StandingRow>(
      "SELECT * FROM companies ORDER BY added_at"
    );
    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      atsProvider: (row.ats_provider as AtsProvider | null) ?? null,
      atsSlug: row.ats_slug,
      track: row.track === "B" ? "B" : "A",
      addedAt: row.added_at,
      lastFitAt: row.last_fit_at,
    }));
  }

  /** AUTO-GROW: remember which ATS a company actually uses so later runs skip probing. */
  async rememberAts(slug: string, provider: AtsProvider, atsSlug: string): Promise<void> {
    await this.d1.execute(
      "UPDATE companies SET ats_provider = ?, ats_slug = ?, last_fit_at = ? WHERE slug = ?",
      [provider, atsSlug, new Date().toISOString(), slug]
    );
  }

  /** AUTO-GROW: a company that produced a fit joins the standing sweep permanently. */
  async addCompany(company: {
    slug: string;
    name: string;
    provider: AtsProvider;
    atsSlug: string;
    track: "A" | "B";
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.d1.execute(
      `INSERT INTO companies (slug, name, ats_provider, ats_slug, track, added_at, last_fit_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         ats_provider = excluded.ats_provider,
         ats_slug     = excluded.ats_slug,
         last_fit_at  = excluded.last_fit_at`,
      [company.slug, company.name, company.provider, company.atsSlug, company.track, now, now]
    );
  }

  async recordSourceOutcome(
    source: string,
    ok: boolean,
    error?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    if (ok) {
      await this.d1.execute(
        `INSERT INTO sources_state (source_name, status, last_ok_at, consecutive_fail_days, last_error)
         VALUES (?, 'ok', ?, 0, NULL)
         ON CONFLICT(source_name) DO UPDATE SET
           status = 'ok',
           last_ok_at = excluded.last_ok_at,
           consecutive_fail_days = 0,
           last_error = NULL`,
        [source, now]
      );
      return;
    }

    await this.d1.execute(
      `INSERT INTO sources_state (source_name, status, last_ok_at, consecutive_fail_days, last_error)
       VALUES (?, 'degraded', NULL, 1, ?)
       ON CONFLICT(source_name) DO UPDATE SET
         status = 'degraded',
         consecutive_fail_days = sources_state.consecutive_fail_days + 1,
         last_error = excluded.last_error`,
      [source, error ?? "unknown"]
    );
  }

  async listSourceStates(): Promise<
    Array<{ source: string; status: SourceStatus; consecutiveFailDays: number }>
  > {
    const rows = await this.d1.query<SourceStateRow>("SELECT * FROM sources_state");
    return rows.map((row) => ({
      source: row.source_name,
      status: (row.status as SourceStatus) ?? "ok",
      consecutiveFailDays: row.consecutive_fail_days,
    }));
  }

  async deprecateSource(source: string): Promise<void> {
    await this.d1.execute(
      "UPDATE sources_state SET status = 'deprecated' WHERE source_name = ?",
      [source]
    );
  }

  async startRun(id: string, startedAt: string): Promise<void> {
    await this.d1.execute(
      "INSERT INTO scan_runs (id, started_at, status) VALUES (?, ?, 'running')",
      [id, startedAt]
    );
  }

  async finishRun(
    id: string,
    outcome: {
      distinctCompanies: number;
      jobsFound: number;
      ladderReached: string;
      status: "ok" | "short" | "failed";
      notes: string;
    }
  ): Promise<void> {
    await this.d1.execute(
      `UPDATE scan_runs SET
         finished_at = ?, distinct_companies = ?, jobs_found = ?,
         ladder_reached = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        new Date().toISOString(),
        outcome.distinctCompanies,
        outcome.jobsFound,
        outcome.ladderReached,
        outcome.status,
        outcome.notes,
        id,
      ]
    );
  }

  async lastRunSince(sinceIso: string): Promise<
    { id: string; distinctCompanies: number; status: string } | null
  > {
    const rows = await this.d1.query<{
      id: string;
      distinct_companies: number;
      status: string;
    }>(
      "SELECT id, distinct_companies, status FROM scan_runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT 1",
      [sinceIso]
    );
    const row = rows[0];
    return row
      ? { id: row.id, distinctCompanies: row.distinct_companies, status: row.status }
      : null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/repo.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/repo.ts scanner/src/repo.test.ts
git commit -m "scanner: repository layer for jobs, sources, companies and runs"
```

---

### Task 7: R1 — ATS adapters (Greenhouse, Lever, Ashby)

**Files:**
- Create: `scanner/src/sources/greenhouse.ts`
- Create: `scanner/src/sources/lever.ts`
- Create: `scanner/src/sources/ashby.ts`
- Test: `scanner/src/sources/ats.test.ts`

Response shapes below were verified against live endpoints on 2026-08-27. Note the two easy-to-get-wrong fields: **Lever's title is `text`** (not `title`), and **Ashby's link is `jobUrl`** (not `url`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchAshby } from "./ashby.js";

function jsonFetch(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

describe("fetchGreenhouse", () => {
  it("maps the board payload and flags remote from the location name", async () => {
    const fetchImpl = jsonFetch({
      jobs: [
        {
          absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/1",
          title: "Partnerships Lead",
          location: { name: "Remote - EMEA" },
          updated_at: "2026-08-21T21:32:54-04:00",
          company_name: "Anthropic",
        },
      ],
    });

    const jobs = await fetchGreenhouse("anthropic", "Anthropic", { fetchImpl });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      url: "https://job-boards.greenhouse.io/anthropic/jobs/1",
      company: "Anthropic",
      title: "Partnerships Lead",
      location: "Remote - EMEA",
      remote: true,
      source: "greenhouse:anthropic",
    });
  });
});

describe("fetchLever", () => {
  it("reads the title from `text` and the link from `hostedUrl`", async () => {
    const fetchImpl = jsonFetch([
      {
        text: "Ecosystem Manager",
        hostedUrl: "https://jobs.lever.co/acme/abc",
        categories: { location: "Berlin, Germany" },
        workplaceType: "onsite",
        createdAt: 1787203369315,
      },
    ]);

    const jobs = await fetchLever("acme", "Acme", { fetchImpl });

    expect(jobs[0]).toMatchObject({
      title: "Ecosystem Manager",
      url: "https://jobs.lever.co/acme/abc",
      location: "Berlin, Germany",
      remote: false,
      source: "lever:acme",
    });
    expect(jobs[0]!.postedAt).toBe(new Date(1787203369315).toISOString());
  });

  it("marks remote workplaceType as remote", async () => {
    const fetchImpl = jsonFetch([
      {
        text: "DevRel",
        hostedUrl: "https://jobs.lever.co/acme/x",
        categories: { location: "Anywhere" },
        workplaceType: "remote",
        createdAt: 1787203369315,
      },
    ]);
    const jobs = await fetchLever("acme", "Acme", { fetchImpl });
    expect(jobs[0]!.remote).toBe(true);
  });
});

describe("fetchAshby", () => {
  it("reads the link from `jobUrl` and honours isRemote", async () => {
    const fetchImpl = jsonFetch({
      jobs: [
        {
          title: "Account Manager - India",
          location: "India",
          isRemote: true,
          publishedAt: "2026-07-21T16:03:51.100+00:00",
          jobUrl: "https://jobs.ashbyhq.com/elevenlabs/a571",
          isListed: true,
        },
      ],
    });

    const jobs = await fetchAshby("elevenlabs", "ElevenLabs", { fetchImpl });

    expect(jobs[0]).toMatchObject({
      url: "https://jobs.ashbyhq.com/elevenlabs/a571",
      title: "Account Manager - India",
      remote: true,
      source: "ashby:elevenlabs",
    });
  });

  it("skips unlisted postings", async () => {
    const fetchImpl = jsonFetch({
      jobs: [
        { title: "Hidden", location: "X", isRemote: false, jobUrl: "https://x.test/1", isListed: false },
      ],
    });
    expect(await fetchAshby("acme", "Acme", { fetchImpl })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/sources/ats.test.ts`
Expected: FAIL — cannot resolve `./greenhouse.js`.

- [ ] **Step 3: Write `scanner/src/sources/greenhouse.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface GreenhouseJob {
  absolute_url: string;
  title: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
}

const REMOTE_HINT = /remote|anywhere|distributed/i;

export async function fetchGreenhouse(
  boardSlug: string,
  companyName: string,
  options: FetchJsonOptions = {}
): Promise<RawJob[]> {
  const payload = await fetchJson<{ jobs?: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${boardSlug}/jobs?content=false`,
    {},
    options
  );

  return (payload.jobs ?? []).map((job) => {
    const location = job.location?.name ?? null;
    return {
      url: job.absolute_url,
      company: companyName,
      title: job.title,
      location,
      remote: REMOTE_HINT.test(location ?? ""),
      postedAt: job.first_published ?? job.updated_at ?? null,
      source: `greenhouse:${boardSlug}`,
    };
  });
}
```

- [ ] **Step 4: Write `scanner/src/sources/lever.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface LeverPosting {
  /** Lever calls the job title `text`, not `title`. */
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  categories?: { location?: string; commitment?: string };
  workplaceType?: string;
  createdAt?: number;
}

const REMOTE_HINT = /remote|anywhere|distributed/i;

export async function fetchLever(
  boardSlug: string,
  companyName: string,
  options: FetchJsonOptions = {}
): Promise<RawJob[]> {
  const postings = await fetchJson<LeverPosting[]>(
    `https://api.lever.co/v0/postings/${boardSlug}?mode=json`,
    {},
    options
  );

  return postings.map((posting) => {
    const location = posting.categories?.location ?? null;
    const remote =
      posting.workplaceType?.toLowerCase() === "remote" ||
      REMOTE_HINT.test(location ?? "");

    return {
      url: posting.hostedUrl ?? posting.applyUrl ?? "",
      company: companyName,
      title: posting.text,
      location,
      remote,
      postedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
      source: `lever:${boardSlug}`,
    };
  });
}
```

- [ ] **Step 5: Write `scanner/src/sources/ashby.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface AshbyJob {
  title: string;
  location?: string;
  isRemote?: boolean;
  publishedAt?: string;
  /** Ashby calls the link `jobUrl`. */
  jobUrl: string;
  isListed?: boolean;
}

export async function fetchAshby(
  boardSlug: string,
  companyName: string,
  options: FetchJsonOptions = {}
): Promise<RawJob[]> {
  const payload = await fetchJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${boardSlug}`,
    {},
    options
  );

  return (payload.jobs ?? [])
    .filter((job) => job.isListed !== false)
    .map((job) => ({
      url: job.jobUrl,
      company: companyName,
      title: job.title,
      location: job.location ?? null,
      remote: job.isRemote === true,
      postedAt: job.publishedAt ?? null,
      source: `ashby:${boardSlug}`,
    }));
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/sources/ats.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add scanner/src/sources/greenhouse.ts scanner/src/sources/lever.ts \
        scanner/src/sources/ashby.ts scanner/src/sources/ats.test.ts
git commit -m "scanner: Greenhouse, Lever and Ashby ATS adapters"
```

---

### Task 8: R1 rung — sweep standing companies and learn their ATS

**Files:**
- Create: `scanner/src/rungs/r1-standing.ts`
- Test: `scanner/src/rungs/r1-standing.test.ts`

Most seeded companies have no known ATS yet. The rung probes the three providers once, then stores the answer so later runs go straight to the right endpoint — that is one third of the subrequest budget saved from day two onward.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { resolveAts, runR1 } from "./r1-standing.js";
import type { Company } from "../types.js";
import { SourceUnavailableError } from "../http.js";

function company(overrides: Partial<Company> = {}): Company {
  return {
    slug: "acme",
    name: "Acme",
    atsProvider: null,
    atsSlug: null,
    track: "A",
    addedAt: "2026-08-01T00:00:00.000Z",
    lastFitAt: null,
    ...overrides,
  };
}

describe("resolveAts", () => {
  it("returns the first provider that yields postings and stops probing", async () => {
    const probes = {
      greenhouse: vi.fn(async () => { throw new SourceUnavailableError("404", 404); }),
      lever: vi.fn(async () => [
        { url: "https://x.test/1", company: "Acme", title: "T", location: null, remote: false, postedAt: null, source: "lever:acme" },
      ]),
      ashby: vi.fn(async () => []),
    };

    const resolved = await resolveAts(company(), probes);

    expect(resolved?.provider).toBe("lever");
    expect(probes.ashby).not.toHaveBeenCalled();
  });

  it("returns null when no provider recognises the company", async () => {
    const fail = vi.fn(async () => { throw new SourceUnavailableError("404", 404); });
    const resolved = await resolveAts(company(), {
      greenhouse: fail, lever: fail, ashby: fail,
    });
    expect(resolved).toBeNull();
  });
});

describe("runR1", () => {
  it("uses the stored provider without probing and reports the jobs", async () => {
    const greenhouse = vi.fn(async () => [
      { url: "https://x.test/1", company: "Acme", title: "T", location: null, remote: false, postedAt: null, source: "greenhouse:acme" },
    ]);

    const result = await runR1(
      [company({ atsProvider: "greenhouse", atsSlug: "acme" })],
      { greenhouse, lever: vi.fn(), ashby: vi.fn() },
      { rememberAts: vi.fn() }
    );

    expect(greenhouse).toHaveBeenCalledWith("acme", "Acme");
    expect(result.jobs).toHaveLength(1);
    expect(result.broken).toHaveLength(0);
  });

  it("records a broken source separately from an empty one", async () => {
    const greenhouse = vi.fn(async () => { throw new SourceUnavailableError("403", 403); });

    const result = await runR1(
      [company({ atsProvider: "greenhouse", atsSlug: "acme" })],
      { greenhouse, lever: vi.fn(), ashby: vi.fn() },
      { rememberAts: vi.fn() }
    );

    expect(result.jobs).toHaveLength(0);
    expect(result.broken).toEqual(["greenhouse:acme"]);
  });

  it("persists a newly discovered provider so the next run skips probing", async () => {
    const rememberAts = vi.fn();
    const ashby = vi.fn(async () => [
      { url: "https://x.test/1", company: "Acme", title: "T", location: null, remote: false, postedAt: null, source: "ashby:acme" },
    ]);
    const fail = vi.fn(async () => { throw new SourceUnavailableError("404", 404); });

    await runR1([company()], { greenhouse: fail, lever: fail, ashby }, { rememberAts });

    expect(rememberAts).toHaveBeenCalledWith("acme", "ashby", "acme");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/rungs/r1-standing.test.ts`
Expected: FAIL — cannot resolve `./r1-standing.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { AtsProvider, RawJob, Company } from "../types.js";
import { fetchGreenhouse } from "../sources/greenhouse.js";
import { fetchLever } from "../sources/lever.js";
import { fetchAshby } from "../sources/ashby.js";

export type AtsProbe = (slug: string, companyName: string) => Promise<RawJob[]>;

export interface AtsProbes {
  greenhouse: AtsProbe;
  lever: AtsProbe;
  ashby: AtsProbe;
}

export const defaultProbes: AtsProbes = {
  greenhouse: (slug, name) => fetchGreenhouse(slug, name),
  lever: (slug, name) => fetchLever(slug, name),
  ashby: (slug, name) => fetchAshby(slug, name),
};

export interface R1Deps {
  rememberAts: (slug: string, provider: AtsProvider, atsSlug: string) => Promise<void> | void;
}

export interface RungResult {
  jobs: RawJob[];
  broken: string[];
  sourcesTried: number;
}

const PROBE_ORDER: AtsProvider[] = ["greenhouse", "lever", "ashby"];

/**
 * Probes the three providers in order and returns the first that answers with
 * postings. A provider that 404s simply does not host this company.
 */
export async function resolveAts(
  company: Company,
  probes: AtsProbes
): Promise<{ provider: AtsProvider; slug: string; jobs: RawJob[] } | null> {
  const candidateSlug = company.atsSlug ?? company.slug;

  for (const provider of PROBE_ORDER) {
    try {
      const jobs = await probes[provider](candidateSlug, company.name);
      if (jobs.length > 0) {
        return { provider, slug: candidateSlug, jobs };
      }
    } catch {
      // Unavailable or unknown here — try the next provider.
    }
  }

  return null;
}

export async function runR1(
  companies: Company[],
  probes: AtsProbes,
  deps: R1Deps
): Promise<RungResult> {
  const jobs: RawJob[] = [];
  const broken: string[] = [];
  let sourcesTried = 0;

  for (const company of companies) {
    sourcesTried++;

    if (company.atsProvider && company.atsSlug) {
      const sourceId = `${company.atsProvider}:${company.atsSlug}`;
      try {
        jobs.push(...(await probes[company.atsProvider](company.atsSlug, company.name)));
      } catch {
        broken.push(sourceId);
      }
      continue;
    }

    const resolved = await resolveAts(company, probes);
    if (!resolved) continue;

    jobs.push(...resolved.jobs);
    await deps.rememberAts(company.slug, resolved.provider, resolved.slug);
  }

  return { jobs, broken, sourcesTried };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/rungs/r1-standing.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/rungs/r1-standing.ts scanner/src/rungs/r1-standing.test.ts
git commit -m "scanner: R1 rung sweeping standing companies with ATS auto-resolution"
```

---

### Task 9: R2 — aggregator adapters

**Files:**
- Create: `scanner/src/sources/arbeitnow.ts`
- Create: `scanner/src/sources/remotive.ts`
- Create: `scanner/src/sources/remoteok.ts`
- Create: `scanner/src/sources/hn.ts`
- Create: `scanner/src/rungs/r2-aggregators.ts`
- Test: `scanner/src/sources/aggregators.test.ts`

Field names verified live on 2026-08-27. Two traps: **RemoteOK's first array element is a legal notice**, and **both RemoteOK and Remotive require attribution plus a followable link back to their listing** — keep the source URL intact, never rewrite it to a company page.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchArbeitnow } from "./arbeitnow.js";
import { fetchRemotive } from "./remotive.js";
import { fetchRemoteOk } from "./remoteok.js";
import { parseHnComment } from "./hn.js";

function jsonFetch(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

describe("fetchArbeitnow", () => {
  it("maps data rows and converts the epoch-second timestamp", async () => {
    const fetchImpl = jsonFetch({
      data: [
        {
          company_name: "ZeKju GmbH",
          title: "Data Analyst",
          url: "https://www.arbeitnow.com/jobs/companies/zekju/data-analyst",
          location: "Munich",
          remote: false,
          created_at: 1787740000,
        },
      ],
    });

    const jobs = await fetchArbeitnow({ fetchImpl });

    expect(jobs[0]).toMatchObject({
      company: "ZeKju GmbH",
      title: "Data Analyst",
      location: "Munich",
      remote: false,
      source: "aggregator:arbeitnow",
    });
    expect(jobs[0]!.postedAt).toBe(new Date(1787740000 * 1000).toISOString());
  });
});

describe("fetchRemotive", () => {
  it("maps jobs and always marks them remote", async () => {
    const fetchImpl = jsonFetch({
      jobs: [
        {
          company_name: "Acme",
          title: "Community Manager",
          url: "https://remotive.com/remote-jobs/1",
          candidate_required_location: "Europe",
          publication_date: "2026-08-20T10:00:00",
        },
      ],
    });

    const jobs = await fetchRemotive({ fetchImpl });
    expect(jobs[0]).toMatchObject({
      company: "Acme",
      remote: true,
      location: "Europe",
      source: "aggregator:remotive",
    });
  });
});

describe("fetchRemoteOk", () => {
  it("skips the legal-notice element that RemoteOK puts first", async () => {
    const fetchImpl = jsonFetch([
      { legal: "API Terms of Service: please link back" },
      {
        company: "Tesco",
        position: "Team Manager",
        url: "https://remoteok.com/remote-jobs/1137144",
        location: "Worldwide",
        date: "2026-08-26T09:40:42+00:00",
      },
    ]);

    const jobs = await fetchRemoteOk({ fetchImpl });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ company: "Tesco", title: "Team Manager", remote: true });
  });
});

describe("parseHnComment", () => {
  it("extracts company and the first link from the pipe-delimited format", () => {
    const html =
      'Snout <a href="https:&#x2F;&#x2F;snout.com&#x2F;" rel="nofollow">https:&#x2F;&#x2F;snout.com&#x2F;</a> ' +
      "| Multiple Engineering Roles | Remote US or Ontario, Canada | Full Time<p>Join us";

    const parsed = parseHnComment(html, "2026-08-03T15:00:54Z");

    expect(parsed).toMatchObject({
      company: "Snout",
      url: "https://snout.com/",
      remote: true,
      source: "aggregator:hn",
    });
    expect(parsed!.title).toContain("Multiple Engineering Roles");
  });

  it("returns null when the comment carries no link", () => {
    expect(parseHnComment("We are hiring, email me", "2026-08-03T15:00:54Z")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/sources/aggregators.test.ts`
Expected: FAIL — cannot resolve `./arbeitnow.js`.

- [ ] **Step 3: Write `scanner/src/sources/arbeitnow.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface ArbeitnowJob {
  company_name: string;
  title: string;
  url: string;
  location?: string;
  remote?: boolean;
  created_at?: number;
}

export async function fetchArbeitnow(options: FetchJsonOptions = {}): Promise<RawJob[]> {
  const payload = await fetchJson<{ data?: ArbeitnowJob[] }>(
    "https://www.arbeitnow.com/api/job-board-api",
    {},
    options
  );

  return (payload.data ?? []).map((job) => ({
    url: job.url,
    company: job.company_name,
    title: job.title,
    location: job.location ?? null,
    remote: job.remote === true,
    postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
    source: "aggregator:arbeitnow",
  }));
}
```

- [ ] **Step 4: Write `scanner/src/sources/remotive.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface RemotiveJob {
  company_name: string;
  title: string;
  url: string;
  candidate_required_location?: string;
  publication_date?: string;
}

/**
 * Remotive's terms require attribution and a link back to the Remotive URL.
 * Keep `job.url` exactly as returned — do not swap in a company career page.
 */
export async function fetchRemotive(options: FetchJsonOptions = {}): Promise<RawJob[]> {
  const payload = await fetchJson<{ jobs?: RemotiveJob[] }>(
    "https://remotive.com/api/remote-jobs",
    {},
    options
  );

  return (payload.jobs ?? []).map((job) => ({
    url: job.url,
    company: job.company_name,
    title: job.title,
    location: job.candidate_required_location ?? null,
    remote: true,
    postedAt: job.publication_date
      ? new Date(`${job.publication_date}Z`).toISOString()
      : null,
    source: "aggregator:remotive",
  }));
}
```

- [ ] **Step 5: Write `scanner/src/sources/remoteok.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface RemoteOkEntry {
  legal?: string;
  company?: string;
  position?: string;
  url?: string;
  location?: string;
  date?: string;
}

/**
 * RemoteOK returns a plain array whose FIRST element is a legal notice, not a
 * job. Their terms also require a followable link back — keep `url` as-is.
 */
export async function fetchRemoteOk(options: FetchJsonOptions = {}): Promise<RawJob[]> {
  const entries = await fetchJson<RemoteOkEntry[]>("https://remoteok.com/api", {}, options);

  return entries
    .filter((entry) => !entry.legal && entry.url && entry.position && entry.company)
    .map((entry) => ({
      url: entry.url!,
      company: entry.company!,
      title: entry.position!,
      location: entry.location ?? null,
      remote: true,
      postedAt: entry.date ? new Date(entry.date).toISOString() : null,
      source: "aggregator:remoteok",
    }));
}
```

- [ ] **Step 6: Write `scanner/src/sources/hn.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface AlgoliaHit {
  objectID: string;
  title: string | null;
}

interface AlgoliaItem {
  children?: Array<{ text: string | null; created_at: string }>;
}

const REMOTE_HINT = /remote|anywhere|distributed/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * "Who is hiring" comments follow a loose convention:
 *   Company | link | Roles | Location | Type
 * We take the company from the leading text, the first http link as the URL,
 * and the remaining pipe fields as the role line. Anything without a link is
 * dropped — a vacancy the user cannot open is worse than no vacancy.
 */
export function parseHnComment(html: string, createdAt: string): RawJob | null {
  const linkMatch = /href="([^"]+)"/.exec(html);
  if (!linkMatch) return null;

  const url = decodeEntities(linkMatch[1]!);
  if (!/^https?:\/\//i.test(url)) return null;

  const flat = stripTags(html);
  const segments = flat.split("|").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  // The first segment is "Company <url>" — cut it at the URL.
  const company = segments[0]!.split(/https?:\/\//)[0]!.trim();
  if (!company) return null;

  const rest = segments.slice(1).filter((s) => !/^https?:\/\//i.test(s));
  const title = rest[0] ?? "See posting";
  const location = rest[1] ?? null;

  return {
    url,
    company,
    title,
    location,
    remote: REMOTE_HINT.test(flat),
    postedAt: new Date(createdAt).toISOString(),
    source: "aggregator:hn",
  };
}

export async function fetchHackerNews(options: FetchJsonOptions = {}): Promise<RawJob[]> {
  const search = await fetchJson<{ hits?: AlgoliaHit[] }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5",
    {},
    options
  );

  const thread = (search.hits ?? []).find((hit) =>
    (hit.title ?? "").toLowerCase().includes("who is hiring")
  );
  if (!thread) return [];

  const item = await fetchJson<AlgoliaItem>(
    `https://hn.algolia.com/api/v1/items/${thread.objectID}`,
    {},
    options
  );

  const jobs: RawJob[] = [];
  for (const child of item.children ?? []) {
    if (!child.text) continue;
    const parsed = parseHnComment(child.text, child.created_at);
    if (parsed) jobs.push(parsed);
  }
  return jobs;
}
```

- [ ] **Step 7: Write `scanner/src/rungs/r2-aggregators.ts`**

```typescript
import { runSource } from "../http.js";
import type { SourceResult } from "../types.js";
import { fetchArbeitnow } from "../sources/arbeitnow.js";
import { fetchRemotive } from "../sources/remotive.js";
import { fetchRemoteOk } from "../sources/remoteok.js";
import { fetchHackerNews } from "../sources/hn.js";

export type AggregatorFn = () => Promise<import("../types.js").RawJob[]>;

export const defaultAggregators: Record<string, AggregatorFn> = {
  "aggregator:arbeitnow": () => fetchArbeitnow(),
  "aggregator:remotive": () => fetchRemotive(),
  "aggregator:remoteok": () => fetchRemoteOk(),
  "aggregator:hn": () => fetchHackerNews(),
};

export async function runR2(
  aggregators: Record<string, AggregatorFn> = defaultAggregators,
  skip: Set<string> = new Set()
): Promise<SourceResult[]> {
  const active = Object.entries(aggregators).filter(([name]) => !skip.has(name));
  return Promise.all(active.map(([name, fn]) => runSource(name, fn)));
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/sources/aggregators.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add scanner/src/sources/arbeitnow.ts scanner/src/sources/remotive.ts \
        scanner/src/sources/remoteok.ts scanner/src/sources/hn.ts \
        scanner/src/rungs/r2-aggregators.ts scanner/src/sources/aggregators.test.ts
git commit -m "scanner: R2 aggregator adapters (Arbeitnow, Remotive, RemoteOK, HN)"
```

---

### Task 10: R3 — Getro ecosystem boards

**Files:**
- Create: `scanner/src/sources/getro.ts`
- Create: `scanner/src/rungs/r3-getro.ts`
- Test: `scanner/src/sources/getro.test.ts`

**Read this before writing the code.** Getro returns HTTP `406` when the request carries no `Accept: application/json` header. The engine spec lists 406 among the "source unavailable" signals, so this board has been recorded as dead when it was only mis-called. `http.ts` sends the header by default; do not remove it.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchGetro } from "./getro.js";

describe("fetchGetro", () => {
  it("posts a paged search and maps the nested organization name", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: {
            jobs: [
              {
                title: "Risk & Governance Manager",
                url: "https://boards.greenhouse.io/ondofinance/jobs/4382521009",
                organization: { name: "Ondo Finance" },
                searchable_locations: ["Remote"],
                work_mode: "remote",
                created_at: 1787749531,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const jobs = await fetchGetro(858, { fetchImpl });

    expect(jobs[0]).toMatchObject({
      company: "Ondo Finance",
      title: "Risk & Governance Manager",
      remote: true,
      location: "Remote",
      source: "getro:858",
    });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.getro.com/api/v2/collections/858/search/jobs");
    expect(init.method).toBe("POST");
  });

  it("sends an Accept header — without it Getro answers 406", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: { jobs: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    await fetchGetro(858, { fetchImpl });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init.headers as Record<string, string>)["Accept"]).toBe("application/json");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/sources/getro.test.ts`
Expected: FAIL — cannot resolve `./getro.js`.

- [ ] **Step 3: Write `scanner/src/sources/getro.ts`**

```typescript
import { fetchJson, type FetchJsonOptions } from "../http.js";
import type { RawJob } from "../types.js";

interface GetroJob {
  title: string;
  url: string;
  organization?: { name?: string };
  searchable_locations?: string[];
  work_mode?: string;
  created_at?: number;
}

const PAGE_SIZE = 100;

/**
 * Getro powers many VC/ecosystem job boards (collection 858 is Solana's).
 *
 * The endpoint answers 406 unless an `Accept: application/json` header is
 * present — fetchJson sends it by default, which is why this works.
 */
export async function fetchGetro(
  collectionId: number,
  options: FetchJsonOptions = {},
  pages = 2
): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  for (let page = 0; page < pages; page++) {
    const payload = await fetchJson<{ results?: { jobs?: GetroJob[] } }>(
      `https://api.getro.com/api/v2/collections/${collectionId}/search/jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, hitsPerPage: PAGE_SIZE, filters: {} }),
      },
      options
    );

    const batch = payload.results?.jobs ?? [];
    if (batch.length === 0) break;

    for (const job of batch) {
      jobs.push({
        url: job.url,
        company: job.organization?.name ?? "Unknown company",
        title: job.title,
        location: job.searchable_locations?.[0] ?? null,
        remote: (job.work_mode ?? "").toLowerCase() === "remote",
        postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
        source: `getro:${collectionId}`,
      });
    }

    if (batch.length < PAGE_SIZE) break;
  }

  return jobs;
}
```

- [ ] **Step 4: Write `scanner/src/rungs/r3-getro.ts`**

```typescript
import { runSource } from "../http.js";
import type { SourceResult } from "../types.js";
import { fetchGetro } from "../sources/getro.js";

export async function runR3(
  collectionIds: number[],
  skip: Set<string> = new Set()
): Promise<SourceResult[]> {
  const active = collectionIds.filter((id) => !skip.has(`getro:${id}`));
  return Promise.all(
    active.map((id) => runSource(`getro:${id}`, () => fetchGetro(id)))
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/sources/getro.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify against the live endpoint**

```bash
curl -sS -X POST "https://api.getro.com/api/v2/collections/858/search/jobs" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"page":0,"hitsPerPage":2,"filters":{}}' | head -c 300
```
Expected: JSON starting with `{"results":{"jobs":[`. If you instead get an empty body with HTTP 406, the `Accept` header was dropped.

- [ ] **Step 7: Commit**

```bash
git add scanner/src/sources/getro.ts scanner/src/rungs/r3-getro.ts scanner/src/sources/getro.test.ts
git commit -m "scanner: R3 Getro ecosystem boards, with the Accept header that fixes the 406"
```

---

### Task 11: R4 — discovery-by-role

**Files:**
- Create: `scanner/src/rungs/r4-discovery.ts`
- Test: `scanner/src/rungs/r4-discovery.test.ts`

R4's purpose is different from R1–R3: it is not looking for more vacancies, it is looking for **companies nobody knew about**. It sweeps aggregator output for role keywords, keeps only companies absent from the standing list, then verifies each against its own ATS before trusting it.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { rotateKeywords, findNewCompanies, runR4 } from "./r4-discovery.js";
import type { RawJob } from "../types.js";

function job(company: string, title: string): RawJob {
  return {
    url: `https://x.test/${company}`,
    company,
    title,
    location: null,
    remote: true,
    postedAt: null,
    source: "aggregator:remotive",
  };
}

describe("rotateKeywords", () => {
  it("returns a stable window that moves with the day number", () => {
    const day0 = rotateKeywords(0, 4);
    const day1 = rotateKeywords(1, 4);
    expect(day0).toHaveLength(4);
    expect(day1).toHaveLength(4);
    expect(day0).not.toEqual(day1);
  });

  it("wraps around the end of the keyword list", () => {
    const wrapped = rotateKeywords(999, 4);
    expect(wrapped).toHaveLength(4);
    expect(new Set(wrapped).size).toBe(4);
  });
});

describe("findNewCompanies", () => {
  it("keeps only keyword-matching roles at companies not already standing", () => {
    const pool = [
      job("KnownCo", "Partnerships Manager"),
      job("FreshCo", "Partnerships Manager"),
      job("OtherCo", "Warehouse Picker"),
    ];

    const found = findNewCompanies(pool, ["partnerships"], new Set(["knownco"]));

    expect(found.map((f) => f.company)).toEqual(["FreshCo"]);
  });
});

describe("runR4", () => {
  it("adds a discovered company only after its own ATS confirms it", async () => {
    const addCompany = vi.fn();
    const probes = {
      greenhouse: vi.fn(async () => { throw new Error("404"); }),
      lever: vi.fn(async () => [job("FreshCo", "Partnerships Manager")]),
      ashby: vi.fn(async () => []),
    };

    const result = await runR4(
      [job("FreshCo", "Partnerships Manager")],
      ["partnerships"],
      new Set(),
      probes,
      { addCompany }
    );

    expect(addCompany).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "lever", name: "FreshCo" })
    );
    expect(result.jobs).toHaveLength(1);
  });

  it("does not add a company whose ATS cannot be found", async () => {
    const addCompany = vi.fn();
    const fail = vi.fn(async () => { throw new Error("404"); });

    const result = await runR4(
      [job("GhostCo", "Partnerships Manager")],
      ["partnerships"],
      new Set(),
      { greenhouse: fail, lever: fail, ashby: fail },
      { addCompany }
    );

    expect(addCompany).not.toHaveBeenCalled();
    expect(result.jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/rungs/r4-discovery.test.ts`
Expected: FAIL — cannot resolve `./r4-discovery.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { AtsProvider, RawJob } from "../types.js";
import { companyKey } from "../normalize.js";
import type { AtsProbes } from "./r1-standing.js";

/**
 * Role keywords the engine cares about, in priority order. Marketing is
 * deliberately last — the spec caps generic marketing at a third of output.
 */
export const ROLE_KEYWORDS = [
  "partnerships",
  "ecosystem",
  "business development",
  "developer relations",
  "devrel",
  "community",
  "program manager",
  "go to market",
  "operations",
  "growth",
  "public affairs",
  "marketing",
];

/** A moving window so every run probes a different slice of the role space. */
export function rotateKeywords(dayNumber: number, size = 5): string[] {
  const start = dayNumber % ROLE_KEYWORDS.length;
  const window: string[] = [];
  for (let i = 0; i < size; i++) {
    window.push(ROLE_KEYWORDS[(start + i) % ROLE_KEYWORDS.length]!);
  }
  return window;
}

export interface DiscoveredCompany {
  company: string;
  slug: string;
}

export function findNewCompanies(
  pool: RawJob[],
  keywords: string[],
  knownCompanyKeys: Set<string>
): DiscoveredCompany[] {
  const seen = new Set<string>();
  const found: DiscoveredCompany[] = [];

  for (const job of pool) {
    const title = job.title.toLowerCase();
    if (!keywords.some((keyword) => title.includes(keyword))) continue;

    const key = companyKey(job.company);
    if (knownCompanyKeys.has(key) || seen.has(key)) continue;

    seen.add(key);
    found.push({ company: job.company, slug: key.replace(/\s+/g, "-") });
  }

  return found;
}

export interface R4Deps {
  addCompany: (company: {
    slug: string;
    name: string;
    provider: AtsProvider;
    atsSlug: string;
    track: "A" | "B";
  }) => Promise<void> | void;
}

const PROBE_ORDER: AtsProvider[] = ["greenhouse", "lever", "ashby"];

export async function runR4(
  pool: RawJob[],
  keywords: string[],
  knownCompanyKeys: Set<string>,
  probes: AtsProbes,
  deps: R4Deps,
  maxCompanies = 8
): Promise<{ jobs: RawJob[]; added: number }> {
  const candidates = findNewCompanies(pool, keywords, knownCompanyKeys).slice(0, maxCompanies);
  const jobs: RawJob[] = [];
  let added = 0;

  for (const candidate of candidates) {
    for (const provider of PROBE_ORDER) {
      try {
        const found = await probes[provider](candidate.slug, candidate.company);
        if (found.length === 0) continue;

        jobs.push(...found);
        await deps.addCompany({
          slug: candidate.slug,
          name: candidate.company,
          provider,
          atsSlug: candidate.slug,
          // Track assignment is refined per user at match time; A is the
          // safe default because it is the broader of the two.
          track: "A",
        });
        added++;
        break;
      } catch {
        // Not on this provider — keep probing.
      }
    }
  }

  return { jobs, added };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/rungs/r4-discovery.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/rungs/r4-discovery.ts scanner/src/rungs/r4-discovery.test.ts
git commit -m "scanner: R4 discovery-by-role finding and verifying unknown companies"
```

---

### Task 12: R5 — Claude proposes new sources

**Files:**
- Create: `scanner/src/rungs/r5-expand.ts`
- Test: `scanner/src/rungs/r5-expand.test.ts`

The last rung: when everything else is exhausted and the day is still short, ask Claude to name job sources the engine is not using, then **verify each proposal before believing it**. An unverified suggestion is worse than nothing — it manufactures dead links.

Two deliberate design points:
- The call is split in two — a web-search pass that researches, then a `messages.parse` pass that extracts structured candidates from that research. Combining server-side web search with a structured-output format in one request is not a documented-supported combination, and this engine cannot afford a silent parse failure at the bottom of the ladder.
- Every proposed endpoint is fetched and must return usable JSON before it is used. Claude's output is a lead, never a source.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { verifyCandidates } from "./r5-expand.js";

describe("verifyCandidates", () => {
  it("keeps only endpoints that actually return jobs", async () => {
    const probe = vi.fn(async (url: string) =>
      url.includes("good")
        ? [{ url: "https://good.test/j/1", company: "Good", title: "T", location: null, remote: true, postedAt: null, source: "expanded:good" }]
        : []
    );

    const kept = await verifyCandidates(
      [
        { name: "good", endpoint: "https://good.test/api", why: "" },
        { name: "empty", endpoint: "https://empty.test/api", why: "" },
      ],
      probe
    );

    expect(kept.map((k) => k.name)).toEqual(["good"]);
  });

  it("drops a candidate whose endpoint throws", async () => {
    const probe = vi.fn(async () => { throw new Error("403"); });
    const kept = await verifyCandidates(
      [{ name: "blocked", endpoint: "https://blocked.test/api", why: "" }],
      probe
    );
    expect(kept).toEqual([]);
  });

  it("rejects a non-http endpoint without calling the probe", async () => {
    const probe = vi.fn(async () => []);
    const kept = await verifyCandidates(
      [{ name: "bad", endpoint: "ftp://nope.test", why: "" }],
      probe
    );
    expect(kept).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/rungs/r5-expand.test.ts`
Expected: FAIL — cannot resolve `./r5-expand.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { fetchJson } from "../http.js";
import type { RawJob } from "../types.js";

export interface SourceCandidate {
  name: string;
  endpoint: string;
  why: string;
}

const CandidateListSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      endpoint: z.string(),
      why: z.string(),
    })
  ),
});

const RESEARCH_PROMPT = `You are helping a job-search scanner widen its source list.

The scanner already pulls from:
- Company ATS JSON APIs: Greenhouse, Lever, Ashby
- Aggregators: Arbeitnow, Remotive, RemoteOK, Hacker News "Who is hiring"
- Getro ecosystem job boards

Find job sources it is NOT using that expose machine-readable job listings over
a public HTTP endpoint returning JSON, with no API key or login. Favour
ecosystem, partnerships, developer-relations, community and operations roles in
tech, AI and web3.

For each source, give the exact request URL that returns job data. Do not
suggest sources that require scraping HTML, sit behind Cloudflare bot
protection, or need paid access.`;

const EXTRACT_PROMPT = `From the research below, list every concrete JSON job
endpoint that was identified. Include only endpoints that were stated as
publicly reachable without authentication. If none qualify, return an empty
list.

RESEARCH:
`;

/**
 * Asks Claude to research unused job sources, then extracts them as structured
 * candidates. Two calls on purpose: server-side web search and a structured
 * output format are not a documented-compatible pair, and a silent parse
 * failure here would leave the bottom rung of the ladder quietly dead.
 */
export async function proposeSources(apiKey: string): Promise<SourceCandidate[]> {
  const client = new Anthropic({ apiKey });

  const research = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: RESEARCH_PROMPT }],
  });

  const researchText = research.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (!researchText.trim()) return [];

  const extraction = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    messages: [{ role: "user", content: `${EXTRACT_PROMPT}${researchText}` }],
    output_config: { format: zodOutputFormat(CandidateListSchema) },
  });

  return extraction.parsed_output?.candidates ?? [];
}

export type CandidateProbe = (endpoint: string) => Promise<RawJob[]>;

/** A proposal is a lead, never a source. Nothing is used until it returns jobs. */
export async function verifyCandidates(
  candidates: SourceCandidate[],
  probe: CandidateProbe
): Promise<SourceCandidate[]> {
  const kept: SourceCandidate[] = [];

  for (const candidate of candidates) {
    if (!/^https?:\/\/\S+$/i.test(candidate.endpoint)) continue;
    try {
      const jobs = await probe(candidate.endpoint);
      if (jobs.length > 0) kept.push(candidate);
    } catch {
      // Unreachable or not JSON — discard silently, this rung is best-effort.
    }
  }

  return kept;
}

/**
 * Generic probe for an unknown endpoint. Accepts the two shapes that cover
 * almost every public job feed: a bare array, or an object with an array under
 * a common key.
 */
export async function probeUnknownEndpoint(endpoint: string): Promise<RawJob[]> {
  const payload = await fetchJson<unknown>(endpoint, {}, { retries: 0 });

  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : ((payload as Record<string, unknown>)?.jobs as unknown[]) ??
      ((payload as Record<string, unknown>)?.data as unknown[]) ??
      ((payload as Record<string, unknown>)?.results as unknown[]) ??
      [];

  if (!Array.isArray(rows)) return [];

  const jobs: RawJob[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;

    const url = [record.url, record.absolute_url, record.jobUrl, record.hostedUrl]
      .find((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value));
    const title = [record.title, record.text, record.position]
      .find((value): value is string => typeof value === "string");
    const company = [record.company, record.company_name, record.companyName]
      .find((value): value is string => typeof value === "string");

    if (!url || !title) continue;

    jobs.push({
      url,
      company: company ?? "Unknown company",
      title,
      location: typeof record.location === "string" ? record.location : null,
      remote: record.remote === true,
      postedAt: null,
      source: `expanded:${new URL(endpoint).hostname}`,
    });
  }

  return jobs;
}

export async function runR5(
  apiKey: string | null
): Promise<{ jobs: RawJob[]; sourcesAdded: string[] }> {
  if (!apiKey) return { jobs: [], sourcesAdded: [] };

  const candidates = await proposeSources(apiKey);
  const verified = await verifyCandidates(candidates, probeUnknownEndpoint);

  const jobs: RawJob[] = [];
  for (const source of verified) {
    try {
      jobs.push(...(await probeUnknownEndpoint(source.endpoint)));
    } catch {
      // Verified a moment ago but failed now — skip, do not fail the run.
    }
  }

  return { jobs, sourcesAdded: verified.map((s) => s.endpoint) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/rungs/r5-expand.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/rungs/r5-expand.ts scanner/src/rungs/r5-expand.test.ts
git commit -m "scanner: R5 rung asking Claude for new sources, verified before use"
```

---

### Task 13: Self-repair of source health

**Files:**
- Create: `scanner/src/selfrepair.ts`
- Test: `scanner/src/selfrepair.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { applySourceOutcomes, skipSet } from "./selfrepair.js";
import type { SourceResult } from "./types.js";

function result(overrides: Partial<SourceResult>): SourceResult {
  return { source: "aggregator:x", ok: true, jobs: [], ...overrides };
}

describe("applySourceOutcomes", () => {
  it("records a success for a source that answered", async () => {
    const repo = { recordSourceOutcome: vi.fn(), deprecateSource: vi.fn() };
    await applySourceOutcomes([result({ ok: true })], repo, []);
    expect(repo.recordSourceOutcome).toHaveBeenCalledWith("aggregator:x", true, undefined);
  });

  it("records a failure for a broken source", async () => {
    const repo = { recordSourceOutcome: vi.fn(), deprecateSource: vi.fn() };
    await applySourceOutcomes(
      [result({ ok: false, broken: true, error: "403" })],
      repo,
      []
    );
    expect(repo.recordSourceOutcome).toHaveBeenCalledWith("aggregator:x", false, "403");
  });

  it("deprecates a source that has failed two days running", async () => {
    const repo = { recordSourceOutcome: vi.fn(), deprecateSource: vi.fn() };
    await applySourceOutcomes([result({ ok: false, broken: true, error: "403" })], repo, [
      { source: "aggregator:x", status: "degraded", consecutiveFailDays: 2 },
    ]);
    expect(repo.deprecateSource).toHaveBeenCalledWith("aggregator:x");
  });

  it("leaves a source alone after a single bad day", async () => {
    const repo = { recordSourceOutcome: vi.fn(), deprecateSource: vi.fn() };
    await applySourceOutcomes([result({ ok: false, broken: true })], repo, [
      { source: "aggregator:x", status: "degraded", consecutiveFailDays: 1 },
    ]);
    expect(repo.deprecateSource).not.toHaveBeenCalled();
  });
});

describe("skipSet", () => {
  it("skips deprecated sources and nothing else", () => {
    const skip = skipSet([
      { source: "a", status: "deprecated", consecutiveFailDays: 5 },
      { source: "b", status: "degraded", consecutiveFailDays: 1 },
      { source: "c", status: "ok", consecutiveFailDays: 0 },
    ]);
    expect([...skip]).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/selfrepair.test.ts`
Expected: FAIL — cannot resolve `./selfrepair.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { SourceResult, SourceStatus } from "./types.js";

export interface SourceStateSnapshot {
  source: string;
  status: SourceStatus;
  consecutiveFailDays: number;
}

export interface SelfRepairRepo {
  recordSourceOutcome: (source: string, ok: boolean, error?: string) => Promise<void> | void;
  deprecateSource: (source: string) => Promise<void> | void;
}

/** Two consecutive bad days is the line between "flaky" and "gone". */
const DEPRECATE_AFTER_FAIL_DAYS = 2;

export async function applySourceOutcomes(
  results: SourceResult[],
  repo: SelfRepairRepo,
  priorStates: SourceStateSnapshot[]
): Promise<void> {
  const priorBySource = new Map(priorStates.map((state) => [state.source, state]));

  for (const result of results) {
    await repo.recordSourceOutcome(result.source, result.ok, result.error);

    if (result.ok) continue;

    const prior = priorBySource.get(result.source);
    const failDaysAfterThisRun = (prior?.consecutiveFailDays ?? 0) + 1;

    if (failDaysAfterThisRun > DEPRECATE_AFTER_FAIL_DAYS) {
      await repo.deprecateSource(result.source);
    }
  }
}

/** Deprecated sources are skipped entirely; degraded ones still get a chance. */
export function skipSet(states: SourceStateSnapshot[]): Set<string> {
  return new Set(
    states.filter((state) => state.status === "deprecated").map((state) => state.source)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/selfrepair.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/selfrepair.ts scanner/src/selfrepair.test.ts
git commit -m "scanner: self-repair marking broken sources degraded then deprecated"
```

---

### Task 14: The ladder

**Files:**
- Create: `scanner/src/ladder.ts`
- Test: `scanner/src/ladder.test.ts`

The ladder is where the spec's central rule lives: **stop only when the day is good enough, never because a rung returned nothing.** It also produces the proof-of-work note — what was tried, what was broken — so a zero-result day can be audited instead of guessed at.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { climbLadder } from "./ladder.js";
import type { RawJob } from "./types.js";

function job(company: string, n = 1): RawJob {
  return {
    url: `https://x.test/${company}/${n}`,
    company,
    title: `Role ${n}`,
    location: null,
    remote: true,
    postedAt: null,
    source: "test",
  };
}

function manyCompanies(count: number): RawJob[] {
  return Array.from({ length: count }, (_, i) => job(`Company${i}`));
}

describe("climbLadder", () => {
  it("stops at R1 once the distinct-company target is met", async () => {
    const rungs = {
      r1: vi.fn(async () => ({ jobs: manyCompanies(8), broken: [] as string[] })),
      r2: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r3: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r4: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r5: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
    };

    const outcome = await climbLadder(rungs, { distinctCompanyTarget: 7, freshnessDays: 14 });

    expect(outcome.reached).toBe("R1");
    expect(rungs.r2).not.toHaveBeenCalled();
    expect(outcome.distinctCompanies).toBe(8);
  });

  it("keeps climbing while the day is short", async () => {
    const rungs = {
      r1: vi.fn(async () => ({ jobs: manyCompanies(2), broken: [] as string[] })),
      r2: vi.fn(async () => ({ jobs: [job("Extra1")], broken: [] as string[] })),
      r3: vi.fn(async () => ({ jobs: [job("Extra2")], broken: [] as string[] })),
      r4: vi.fn(async () => ({ jobs: [job("Extra3")], broken: [] as string[] })),
      r5: vi.fn(async () => ({ jobs: [job("Extra4"), job("Extra5")], broken: [] as string[] })),
    };

    const outcome = await climbLadder(rungs, { distinctCompanyTarget: 7, freshnessDays: 14 });

    expect(outcome.reached).toBe("R5");
    expect(rungs.r5).toHaveBeenCalled();
    expect(outcome.distinctCompanies).toBe(7);
  });

  it("climbs past an empty rung rather than treating it as an answer", async () => {
    const rungs = {
      r1: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r2: vi.fn(async () => ({ jobs: manyCompanies(9), broken: [] as string[] })),
      r3: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r4: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r5: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
    };

    const outcome = await climbLadder(rungs, { distinctCompanyTarget: 7, freshnessDays: 14 });

    expect(rungs.r2).toHaveBeenCalled();
    expect(outcome.reached).toBe("R2");
  });

  it("collapses geo-clones so five countries count as one company", async () => {
    const clones: RawJob[] = ["Berlin", "Vienna", "Madrid", "Rome", "Lisbon"].map((city, i) => ({
      ...job("CloneCo", i),
      title: "Partnerships Manager",
      location: city,
      url: `https://x.test/clone/${i}`,
    }));

    const rungs = {
      r1: vi.fn(async () => ({ jobs: clones, broken: [] as string[] })),
      r2: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r3: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r4: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r5: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
    };

    const outcome = await climbLadder(rungs, { distinctCompanyTarget: 7, freshnessDays: 14 });

    expect(outcome.jobs).toHaveLength(1);
    expect(outcome.distinctCompanies).toBe(1);
  });

  it("names the broken sources in the proof-of-work note", async () => {
    const rungs = {
      r1: vi.fn(async () => ({ jobs: [], broken: ["greenhouse:acme"] })),
      r2: vi.fn(async () => ({ jobs: [], broken: ["aggregator:remoteok"] })),
      r3: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r4: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
      r5: vi.fn(async () => ({ jobs: [], broken: [] as string[] })),
    };

    const outcome = await climbLadder(rungs, { distinctCompanyTarget: 7, freshnessDays: 14 });

    expect(outcome.reached).toBe("R5");
    expect(outcome.proofOfWork).toContain("R1");
    expect(outcome.proofOfWork).toContain("greenhouse:acme");
    expect(outcome.proofOfWork).toContain("aggregator:remoteok");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/ladder.test.ts`
Expected: FAIL — cannot resolve `./ladder.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import { prepare } from "./normalize.js";
import type { NormalizedJob, RawJob, Rung } from "./types.js";

export interface RungRun {
  jobs: RawJob[];
  broken: string[];
}

export interface LadderRungs {
  r1: () => Promise<RungRun>;
  r2: () => Promise<RungRun>;
  r3: () => Promise<RungRun>;
  r4: (poolSoFar: RawJob[]) => Promise<RungRun>;
  r5: () => Promise<RungRun>;
}

export interface LadderOptions {
  distinctCompanyTarget: number;
  freshnessDays: number;
  now?: Date;
}

export interface LadderOutcome {
  jobs: NormalizedJob[];
  distinctCompanies: number;
  reached: Rung;
  brokenSources: string[];
  /** Human-readable record of what was actually attempted. */
  proofOfWork: string;
}

const ORDER: Rung[] = ["R1", "R2", "R3", "R4", "R5"];

/**
 * Climbs R1 → R5, stopping as soon as the day clears the distinct-company
 * target. An empty rung is never a stopping condition — that is the whole
 * point of the ladder.
 */
export async function climbLadder(
  rungs: LadderRungs,
  options: LadderOptions
): Promise<LadderOutcome> {
  const now = options.now ?? new Date();
  const rawPool: RawJob[] = [];
  const brokenSources: string[] = [];
  const trace: string[] = [];

  let prepared: NormalizedJob[] = [];
  let distinct = 0;
  let reached: Rung = "R1";

  for (const rung of ORDER) {
    reached = rung;

    const run =
      rung === "R4" ? await rungs.r4(rawPool) : await rungs[lowercase(rung)]();

    rawPool.push(...run.jobs);
    brokenSources.push(...run.broken);

    prepared = prepare(rawPool, options.freshnessDays, now);
    distinct = new Set(prepared.map((job) => job.companyKey)).size;

    trace.push(
      `${rung}: +${run.jobs.length} raw, ${distinct} distinct companies so far` +
        (run.broken.length > 0 ? `, unavailable: ${run.broken.join(", ")}` : "")
    );

    if (distinct >= options.distinctCompanyTarget) break;
  }

  return {
    jobs: prepared,
    distinctCompanies: distinct,
    reached,
    brokenSources,
    proofOfWork: trace.join("\n"),
  };
}

function lowercase(rung: Rung): "r1" | "r2" | "r3" | "r5" {
  return rung.toLowerCase() as "r1" | "r2" | "r3" | "r5";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/ladder.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/ladder.ts scanner/src/ladder.test.ts
git commit -m "scanner: R1-R5 ladder with distinct-company gate and proof of work"
```

---

### Task 15: Scan entrypoint

**Files:**
- Create: `scanner/src/scan.ts`

- [ ] **Step 1: Write the entrypoint**

```typescript
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { runSource } from "./http.js";
import { applySourceOutcomes, skipSet } from "./selfrepair.js";
import { climbLadder, type LadderRungs, type RungRun } from "./ladder.js";
import { defaultProbes, runR1 } from "./rungs/r1-standing.js";
import { runR2 } from "./rungs/r2-aggregators.js";
import { runR3 } from "./rungs/r3-getro.js";
import { rotateKeywords, runR4 } from "./rungs/r4-discovery.js";
import { runR5 } from "./rungs/r5-expand.js";
import type { RawJob, SourceResult } from "./types.js";

function toRungRun(results: SourceResult[]): RungRun {
  return {
    jobs: results.flatMap((result) => result.jobs),
    broken: results.filter((result) => !result.ok).map((result) => result.source),
  };
}

function dayNumber(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = new Date();
  const runId = crypto.randomUUID();

  const d1 = new D1Client({
    accountId: config.cfAccountId,
    databaseId: config.cfDatabaseId,
    token: config.cfApiToken,
  });
  const repo = new Repo(d1);

  await repo.startRun(runId, now.toISOString());

  const priorStates = await repo.listSourceStates();
  const skip = skipSet(priorStates);
  const collectedResults: SourceResult[] = [];

  const rungs: LadderRungs = {
    r1: async () => {
      const companies = await repo.listCompanies();
      const result = await runR1(companies, defaultProbes, {
        rememberAts: (slug, provider, atsSlug) => repo.rememberAts(slug, provider, atsSlug),
      });
      collectedResults.push(
        ...result.broken.map((source) => ({ source, ok: false, jobs: [], broken: true }))
      );
      return { jobs: result.jobs, broken: result.broken };
    },

    r2: async () => {
      const results = await runR2(undefined, skip);
      collectedResults.push(...results);
      return toRungRun(results);
    },

    r3: async () => {
      const results = await runR3(config.getroCollectionIds, skip);
      collectedResults.push(...results);
      return toRungRun(results);
    },

    r4: async (poolSoFar: RawJob[]) => {
      const companies = await repo.listCompanies();
      const known = new Set(companies.map((company) => company.slug.replace(/-/g, " ")));
      const keywords = rotateKeywords(dayNumber(now));

      const result = await runR4(poolSoFar, keywords, known, defaultProbes, {
        addCompany: (company) => repo.addCompany(company),
      });

      console.log(`R4 discovered ${result.added} new companies`);
      return { jobs: result.jobs, broken: [] };
    },

    r5: async () => {
      const wrapped = await runSource("rung:r5", async () => {
        const result = await runR5(config.anthropicApiKey);
        console.log(`R5 verified ${result.sourcesAdded.length} new sources`);
        return result.jobs;
      });
      collectedResults.push(wrapped);
      return toRungRun([wrapped]);
    },
  };

  try {
    const outcome = await climbLadder(rungs, {
      distinctCompanyTarget: config.distinctCompanyTarget,
      freshnessDays: config.freshnessDays,
      now,
    });

    await repo.upsertJobs(outcome.jobs);
    await applySourceOutcomes(collectedResults, repo, priorStates);

    const status = outcome.distinctCompanies >= config.distinctCompanyTarget ? "ok" : "short";

    await repo.finishRun(runId, {
      distinctCompanies: outcome.distinctCompanies,
      jobsFound: outcome.jobs.length,
      ladderReached: outcome.reached,
      status,
      notes: outcome.proofOfWork,
    });

    console.log(outcome.proofOfWork);
    console.log(
      `Run ${runId}: ${outcome.jobs.length} jobs, ` +
        `${outcome.distinctCompanies} distinct companies, reached ${outcome.reached}, ${status}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.finishRun(runId, {
      distinctCompanies: 0,
      jobsFound: 0,
      ladderReached: "none",
      status: "failed",
      notes: message,
    });
    console.error(`Run ${runId} failed: ${message}`);
    process.exitCode = 1;
  }
}

await main();
```

- [ ] **Step 2: Build and run the full test suite**

Run from `scanner/`:
```bash
npm run build
npm test
```
Expected: `tsc` completes with no errors, and every test file passes (d1, http, normalize, repo, ats, r1-standing, aggregators, getro, r4-discovery, r5-expand, selfrepair, ladder).

- [ ] **Step 3: Do a real scan against D1**

Create `scanner/.env` from `.env.example` with real values (this file is gitignored — confirm with `git check-ignore scanner/.env` before pasting a token into it), then:
```bash
node --env-file=.env dist/scan.js
```
Expected: the proof-of-work trace prints one line per rung, then a summary line. Distinct companies should reach at least 7; if it does not, the trace shows exactly which rungs ran and which sources were unavailable.

- [ ] **Step 4: Confirm the data landed**

Run from `web/`:
```bash
npx wrangler d1 execute crypto-jobs-agent --remote \
  --command "SELECT COUNT(*) AS jobs, COUNT(DISTINCT company_key) AS companies FROM jobs_cache"
```
Expected: both counts greater than zero, companies at least 7.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/scan.ts
git commit -m "scanner: scan entrypoint wiring the ladder to D1"
```

---

### Task 16: Watchdog

**Files:**
- Create: `scanner/src/watchdog.ts`
- Test: `scanner/src/watchdog.test.ts`

The watchdog judges the day by its **result**, not by whether the scan process started. A scan that ran happily and found four companies is a failure, and this is what catches it.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { judgeDay } from "./watchdog.js";

describe("judgeDay", () => {
  it("forces a re-run when the scan never started", () => {
    const verdict = judgeDay(null, 0, 5);
    expect(verdict.rerun).toBe(true);
    expect(verdict.reason).toContain("no scan run");
  });

  it("forces a re-run when the day is below the floor despite a clean run", () => {
    const verdict = judgeDay(
      { id: "r1", distinctCompanies: 3, status: "ok" },
      3,
      5
    );
    expect(verdict.rerun).toBe(true);
    expect(verdict.reason).toContain("3");
  });

  it("forces a re-run when the run failed outright", () => {
    const verdict = judgeDay(
      { id: "r1", distinctCompanies: 0, status: "failed" },
      0,
      5
    );
    expect(verdict.rerun).toBe(true);
  });

  it("passes a day that cleared the floor", () => {
    const verdict = judgeDay(
      { id: "r1", distinctCompanies: 9, status: "ok" },
      9,
      5
    );
    expect(verdict.rerun).toBe(false);
  });

  it("trusts the live count over the recorded one when they disagree", () => {
    // The run claims success but the cache says otherwise — believe the cache.
    const verdict = judgeDay(
      { id: "r1", distinctCompanies: 12, status: "ok" },
      2,
      5
    );
    expect(verdict.rerun).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `scanner/`: `npx vitest run src/watchdog.test.ts`
Expected: FAIL — cannot resolve `./watchdog.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { spawnSync } from "node:child_process";

export interface RunSummary {
  id: string;
  distinctCompanies: number;
  status: string;
}

export interface Verdict {
  rerun: boolean;
  reason: string;
}

/**
 * The live count from jobs_cache wins over whatever the run recorded — a run
 * can report success and still have written nothing usable.
 */
export function judgeDay(
  run: RunSummary | null,
  liveDistinctCompanies: number,
  floor: number
): Verdict {
  if (!run) {
    return { rerun: true, reason: "no scan run recorded for today" };
  }

  if (run.status === "failed") {
    return { rerun: true, reason: `today's run ${run.id} ended in status failed` };
  }

  if (liveDistinctCompanies < floor) {
    return {
      rerun: true,
      reason:
        `only ${liveDistinctCompanies} distinct companies in today's cache, ` +
        `floor is ${floor}`,
    };
  }

  return {
    rerun: false,
    reason: `${liveDistinctCompanies} distinct companies, at or above the floor of ${floor}`,
  };
}

function startOfTodayIso(now: Date): string {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = new Date();
  const since = startOfTodayIso(now);

  const d1 = new D1Client({
    accountId: config.cfAccountId,
    databaseId: config.cfDatabaseId,
    token: config.cfApiToken,
  });
  const repo = new Repo(d1);

  const run = await repo.lastRunSince(since);
  const liveCount = await repo.countDistinctCompaniesSince(since);
  const verdict = judgeDay(run, liveCount, config.watchdogFloor);

  console.log(`Watchdog verdict: ${verdict.reason}`);

  if (!verdict.rerun) return;

  console.log("Watchdog is forcing a deeper re-scan.");
  const rerun = spawnSync(process.execPath, ["dist/scan.js"], {
    stdio: "inherit",
    env: process.env,
  });

  if (rerun.status !== 0) {
    console.error(`Forced re-scan exited with status ${rerun.status}`);
    process.exitCode = 1;
  }
}

// Only run the process when executed directly, so the tests can import judgeDay.
if (process.argv[1]?.endsWith("watchdog.js")) {
  await main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `scanner/`: `npx vitest run src/watchdog.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/watchdog.ts scanner/src/watchdog.test.ts
git commit -m "scanner: watchdog judging the day by distinct-company result"
```

---

### Task 17: Deploy to the host

**Files:**
- Create: `scanner/deploy/jobs-scanner.service`
- Create: `scanner/deploy/jobs-scanner.timer`
- Create: `scanner/deploy/jobs-watchdog.service`
- Create: `scanner/deploy/jobs-watchdog.timer`
- Create: `scanner/deploy/README.md`

The host already runs several systemd services with `EnvironmentFile`-supplied secrets; these units follow that same pattern rather than inventing a new one.

- [ ] **Step 1: Write `scanner/deploy/jobs-scanner.service`**

```ini
[Unit]
Description=Job search scanner — daily ladder sweep
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/jobs-scanner
EnvironmentFile=/etc/jobs-scanner.env
ExecStart=/usr/bin/node dist/scan.js
StandardOutput=journal
StandardError=journal
TimeoutStartSec=1800
```

- [ ] **Step 2: Write `scanner/deploy/jobs-scanner.timer`**

```ini
[Unit]
Description=Run the job scanner on weekday mornings

[Timer]
OnCalendar=Mon..Fri *-*-* 05:00:00
Persistent=true
Unit=jobs-scanner.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Write `scanner/deploy/jobs-watchdog.service`**

```ini
[Unit]
Description=Job search watchdog — verifies the day's result, not just the run
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/jobs-scanner
EnvironmentFile=/etc/jobs-scanner.env
ExecStart=/usr/bin/node dist/watchdog.js
StandardOutput=journal
StandardError=journal
TimeoutStartSec=1800
```

- [ ] **Step 4: Write `scanner/deploy/jobs-watchdog.timer`**

```ini
[Unit]
Description=Run the job watchdog three hours after the scan

[Timer]
OnCalendar=Mon..Fri *-*-* 08:00:00
Persistent=true
Unit=jobs-watchdog.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Write `scanner/deploy/README.md`**

````markdown
# Deploying the scanner

The scanner runs on the project's always-on Linux host under systemd, not on
Cloudflare Workers. Workers' free plan allows 10 ms CPU and 50 external
subrequests per invocation; one ladder pass needs roughly 50–90 subrequests and
parses several megabytes of aggregator JSON, so it does not fit.

## First install

Build locally, then copy the built tree to the host:

```bash
cd scanner
npm ci
npm run build
rsync -av --delete \
  --exclude .env --exclude src --exclude '*.test.ts' \
  ./ <host>:/opt/jobs-scanner/
```

Create `/etc/jobs-scanner.env` on the host with the variables documented in
`.env.example`. It holds a live Cloudflare token, so lock it down:

```bash
chmod 600 /etc/jobs-scanner.env
chown root:root /etc/jobs-scanner.env
```

Install the units:

```bash
cp deploy/*.service deploy/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jobs-scanner.timer jobs-watchdog.timer
```

## Verify

```bash
systemctl list-timers 'jobs-*'          # both timers scheduled
systemctl start jobs-scanner.service    # run once, immediately
journalctl -u jobs-scanner.service -n 60 --no-pager
```

The log ends with the proof-of-work trace: one line per rung showing what it
added and which sources were unavailable, then a summary line.

## Updating

```bash
npm run build
rsync -av --delete --exclude .env --exclude src --exclude '*.test.ts' ./ <host>:/opt/jobs-scanner/
systemctl start jobs-scanner.service
```

No restart is needed — both units are `Type=oneshot`, fired by their timers.
````

- [ ] **Step 6: Install on the host and verify a real run**

Follow `deploy/README.md`. Then confirm:
```bash
systemctl list-timers 'jobs-*' --no-pager
systemctl start jobs-scanner.service
journalctl -u jobs-scanner.service -n 60 --no-pager
```
Expected: both timers listed with a next-run time; the manual run logs the rung-by-rung trace and finishes with a distinct-company count of at least 7.

- [ ] **Step 7: Verify the watchdog reacts correctly**

```bash
systemctl start jobs-watchdog.service
journalctl -u jobs-watchdog.service -n 30 --no-pager
```
Expected: after a healthy scan, `Watchdog verdict: N distinct companies, at or above the floor of 5` and no re-scan. If the earlier scan was short, the watchdog instead logs that it is forcing a deeper re-scan and runs one.

- [ ] **Step 8: Commit**

```bash
git add scanner/deploy/
git commit -m "scanner: systemd units and deploy guide"
```

---

## Definition of done

- `npm test` in `scanner/` passes every suite.
- `npm run build` produces `dist/` with no TypeScript errors.
- A real run writes rows into `jobs_cache` and reaches at least 7 distinct companies.
- `sources_state` has a row per source, and a deliberately broken source (point one at a 404 URL for two runs) ends up `deprecated` rather than counted as empty.
- Both systemd timers are enabled and show a next-run time.
- The scan log always ends with the proof-of-work trace, including on a short day.

## Deliberately out of scope

These belong to the next plan (Match Worker), not this one:

- Per-user filtering — role keywords, location rules, reject rules. This engine builds one shared cache; whose profile a vacancy suits is decided later.
- The `max 2 roles per company` output cap and the company cooldown. Both are per-report presentation rules, and there is no report here.
- Ranking, "why it fits" copy, and Telegram delivery.
- The X/Twitter lead layer.

## Open items to raise before starting

1. **The Cloudflare API token needs `D1:Edit`.** The existing Workers-deploy token does not have it. Task 2 Step 2 verifies this before any code depends on it.
2. **R5 needs an Anthropic API key.** Without `ANTHROPIC_API_KEY` the rung is skipped and the ladder tops out at R4 — which still works, just with less reach. One R5 pass is two Opus calls plus up to six web searches, so roughly cents per day.
3. **RemoteOK and Remotive both require attribution** and a followable link back to their listing. The adapters keep the source URL intact; a future public UI must display the attribution too, or risk having API access suspended.
