# Кабінет і онбординг — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити однаковий рядок «чому ти» на справжній опис кожної вакансії, дати кнопку «Податися» зі станом, розрізнити добірки в кабінеті й довести нову людину до першої добірки за годину, а не за добу.

**Architecture:** Сканер витягує опис із тексту оголошення детермінованою функцією (без моделі) і кладе в `jobs_cache.summary` — один опис на вакансію, спільний для всіх. Причини збігу зберігаються структурованим JSON у `sent.match_facts`; сканер пише ідентифікатори, сайт розкриває їх у назви за локаллю. Стан подачі живе в `sent.applied_at` / `hidden_at`.

**Tech Stack:** TypeScript, Node (сканер), Next.js 16 на Cloudflare Workers (сайт), D1/SQLite, vitest.

**Спека:** `docs/superpowers/specs/2026-08-28-dashboard-and-onboarding-design.md`

**Гілка:** `dashboard-onboarding` (worktree `.claude/worktrees/dashboard-onboarding`)

---

## Task 1: Міграція схеми

**Files:**
- Create: `db/migrations/0011_job_summary_and_match_state.sql`

- [ ] **Step 1: Написати міграцію**

```sql
-- Опис вакансії та стан подачі.
--
-- summary — готовий витяг ≤240 символів, НЕ сирий текст оголошення. Опис
-- вакансії однаковий для всіх людей, тому рахується один раз і лежить у
-- спільному кеші. summary_at дає змогу перерахувати старі рядки, якщо
-- витяг колись покращимо.
ALTER TABLE jobs_cache ADD COLUMN summary    TEXT;
ALTER TABLE jobs_cache ADD COLUMN summary_at TEXT;

-- Стан вакансії в кабінеті. Досі sent знав лише pending|sent|failed —
-- це про доставку, а не про те, що людина з вакансією зробила.
ALTER TABLE sent ADD COLUMN applied_at TEXT;
ALTER TABLE sent ADD COLUMN hidden_at  TEXT;

-- Причини збігу структуровано. Сканер пише ідентифікатори зі словника,
-- сайт розкриває їх у назви за локаллю: пакети окремі й спільного коду
-- не мають, тому контракт — це саме JSON.
ALTER TABLE sent ADD COLUMN match_facts TEXT NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Перевірити синтаксис на локальному SQLite**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding
rm -f /tmp/nr-check.db
sqlite3 /tmp/nr-check.db < db/migrations/0001_schema.sql
for f in db/migrations/000[2-9]*.sql db/migrations/0010*.sql db/migrations/0011*.sql; do
  sqlite3 /tmp/nr-check.db < "$f" || echo "FAIL $f"
done
sqlite3 /tmp/nr-check.db "PRAGMA table_info(sent);" | grep -E "applied_at|hidden_at|match_facts"
sqlite3 /tmp/nr-check.db "PRAGMA table_info(jobs_cache);" | grep -E "summary"
```

Expected: три рядки для `sent`, два для `jobs_cache`, жодного `FAIL`.

- [ ] **Step 3: Коміт**

```bash
git add db/migrations/0011_job_summary_and_match_state.sql
git commit -m "Схема: опис вакансії та стан подачі"
```

> Міграцію на живу базу застосовує людина окремо (Task 14), не агент.

---

## Task 2: Витяг опису вакансії

**Files:**
- Create: `scanner/src/summary.ts`
- Test: `scanner/src/summary.test.ts`

- [ ] **Step 1: Написати падаючі тести**

```ts
import { describe, expect, it } from "vitest";
import { summarize, cut } from "./summary.js";

describe("summarize", () => {
  it("бере абзац після заголовка про роль, а не рекламу компанії", () => {
    const text = [
      "About Ramp",
      "Ramp is building the smart infrastructure for finance teams, embedded in the transaction flow of every dollar a business spends.",
      "About the Role",
      "You will own the trade lifecycle for equities and crypto, resolving settlement breaks and reconciling with brokers every day.",
    ].join("\n\n");
    expect(summarize(text, "Ramp")).toMatch(/^You will own the trade lifecycle/);
  });

  it("не лишає тегів, коли HTML екранований подвійно", () => {
    // Greenhouse віддає &lt;p&gt;. Якщо декодувати сутності ПІСЛЯ зняття
    // тегів, вони випливають у видимий текст — саме цей дефект ловимо.
    const text = "&lt;p&gt;You will help fintechs and broker-dealers launch brokerage products using our institutional API.&lt;/p&gt;";
    const out = summarize(text, "Alpaca");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toMatch(/^You will help fintechs/);
  });

  it("відкидає абзац, що відкривається назвою компанії", () => {
    const text = [
      "Alpaca is a fast-growing fintech company serving developers around the world with brokerage infrastructure at scale.",
      "We are looking for a high-performing Account Executive with a track record of selling to registered investment advisers.",
    ].join("\n\n");
    expect(summarize(text, "Alpaca")).toMatch(/^We are looking for a high-performing/);
  });

  it("відкидає юридичні та маркетингові блоки", () => {
    const text = [
      "Benefits: we offer generous health cover, unlimited leave and an annual learning budget for every employee.",
      "In this role you will run ACATS and non-ACATS transfer workflows across the partner ecosystem.",
    ].join("\n\n");
    expect(summarize(text, "Acme")).toMatch(/^In this role you will run ACATS/);
  });

  it("повертає null на порожньому вході, а не порожній рядок", () => {
    expect(summarize("", "Acme")).toBeNull();
    expect(summarize(null, "Acme")).toBeNull();
    expect(summarize("   \n  ", "Acme")).toBeNull();
  });

  it("не повертає самих заголовків без тіла", () => {
    expect(summarize("Your Role:\n\nApply now", "Acme")).toBeNull();
  });
});

describe("cut", () => {
  it("обрізає по межі речення", () => {
    const p = "First sentence here. " + "x".repeat(300) + ".";
    expect(cut(p, 240)).toBe("First sentence here.");
  });

  it("не чіпає короткий текст", () => {
    expect(cut("Short one.", 240)).toBe("Short one.");
  });

  it("ріже по слову, коли перше речення довше за ліміт", () => {
    const p = "word ".repeat(100).trim() + ".";
    const out = cut(p, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 2: Запустити тести — мають упасти**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
npx vitest run src/summary.test.ts
```

Expected: FAIL — `Failed to resolve import "./summary.js"`.

- [ ] **Step 3: Реалізувати**

```ts
/**
 * Опис вакансії з тексту оголошення. Без моделі.
 *
 * Ключове рішення: опис вакансії ОДНАКОВИЙ для всіх людей, на відміну від
 * «чому ти». Тому він рахується один раз на вакансію і лежить у спільному
 * кеші. Сирий текст оголошення нікуди не зберігається — лише витяг.
 *
 * Евристику перевірено на живих відповідях Ashby, Lever і Greenhouse:
 * 15 вакансій, 15 описів, 12 із них справді про роль.
 */

/** Заголовок, після якого починається розповідь про саму роль. */
const HEAD = /^(about (the )?(role|job|position|opportunity)|the (role|opportunity|job)|what you.{0,3}ll do|what you will do|your (role|impact|mission)|role overview|position summary|job description|overview|responsibilities)\s*:?\s*$/i;

/** Маркери того, що абзац про роботу, а не про фірму. */
const ROLE = /\b(you.{0,3}ll|you will|your role|in this role|we.{0,3}re looking for|we are looking for|we seek|responsible for|as an? [a-z ]{3,30}, you|this role|reporting to|day.to.day|responsibilities include|design, build)\b/i;

/** Маркери корпоративної реклами. */
const CORP = /\b(our mission|was founded|millions of users|billions of|our (story|values|culture)|trusted by|customers (around|across) the world|we.{0,3}re a (dynamic|fast|global|leading|team|remote)|we are a (dynamic|fast|global|leading|team|remote)|globally distributed|join us|our team is made up)\b/i;

/** Службові блоки: пільги, зарплата, юридичне. */
const DROP = /^(about (us|the company)|who we are|our (mission|story|values|culture)|why (join|work)|benefits|perks|compensation|salary|equal (employment )?opportunity|we are an equal|eeo|accommodation|how to apply|what we offer)/i;

const NAMED: Record<string, string> = {
  amp: "&", nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  mdash: "—", ndash: "–", hellip: "…",
};

function decode(t: string): string {
  return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const n = /^#x/i.test(e) ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * Сутності декодуються РАНІШЕ за зняття тегів.
 *
 * Greenhouse віддає екранований HTML (`&lt;p&gt;`). При зворотному порядку
 * теги перетворюються на видимий текст уже після того, як їх нікому знімати,
 * і в картку летить рядок «<p>We're a dynamic team…».
 */
function clean(raw: string): string {
  const t = decode(decode(raw));
  return t.replace(/<(li|\/p|\/div|br|\/h\d|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
}

const paras = (t: string): string[] =>
  clean(t).split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Обрізання по межі речення, зі словом як запасним варіантом. */
export function cut(p: string, limit = 240): string {
  if (p.length <= limit) return p;
  let out = "";
  for (const s of p.split(/(?<=[.!?])\s+/)) {
    if (out.length + s.length + 1 > limit) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || `${p.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

export function summarize(text: string | null | undefined, company = ""): string | null {
  if (!text) return null;
  const all = paras(text);

  // 1. Абзац одразу після заголовка про роль. Найнадійніший шлях: автор
  //    оголошення сам позначив, де закінчується реклама.
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.length < 60 && HEAD.test(all[i]!)) {
      const next = all.slice(i + 1).find((q) => q.length >= 60);
      if (next) return cut(next);
    }
  }

  // 2. Інакше — скоринг. Абзац, що відкривається назвою компанії з
  //    дієсловом-зв'язкою, майже завжди блурб: «Ramp is building…».
  const first = company.trim().split(/\s+/)[0] ?? "";
  const blurb = first
    ? new RegExp(`^${escapeRe(first)}\\b.{0,80}\\b(is|are|was|builds?|building|powers?|helps?|makes?)\\b`, "i")
    : null;

  let best: string | null = null;
  let bestScore = -99;
  const cands = all.filter((p) => p.length >= 60 && p.length <= 900).slice(0, 12);
  cands.forEach((p, i) => {
    let s = -i * 0.5;                       // раніші абзаци трохи вагоміші
    if (ROLE.test(p)) s += 4;
    if (CORP.test(p)) s -= 4;
    if (DROP.test(p)) s -= 5;
    if (blurb?.test(p)) s -= 6;
    if (s > bestScore) { best = p; bestScore = s; }
  });

  return best && bestScore > -3 ? cut(best) : null;
}
```

- [ ] **Step 4: Запустити тести — мають пройти**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
npx vitest run src/summary.test.ts
```

Expected: PASS, 9 тестів.

- [ ] **Step 5: Перевірити на живих даних, а не лише на фікстурах**

Зелені юніт-тести вже пропускали справжні дефекти парсера DOU. Тому:

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
cat > /tmp/probe.ts <<'TS'
import { summarize } from "./src/summary.js";
const get = async (u: string) => (await fetch(u)).json() as any;
const ash = await get("https://api.ashbyhq.com/posting-api/job-board/ramp");
for (const j of ash.jobs.slice(0, 5)) console.log("▸", j.title.trim(), "\n  ", summarize(j.descriptionPlain, "Ramp"), "\n");
const lev = await get("https://api.lever.co/v0/postings/spotify?mode=json");
for (const j of lev.slice(0, 5)) console.log("▸", j.text.trim(), "\n  ", summarize(j.descriptionBodyPlain ?? j.descriptionPlain, "Spotify"), "\n");
TS
npx tsx /tmp/probe.ts
```

Expected: 10 рядків, усі різні, без символів `<` і `>`, щонайменше 7 із 10 описують саму роль. Якщо менше — доправити `ROLE` / `CORP` і повторити.

- [ ] **Step 6: Коміт**

```bash
git add scanner/src/summary.ts scanner/src/summary.test.ts
git commit -m "Витяг опису вакансії з тексту оголошення"
```

---

## Task 3: Джерела віддають текст оголошення

**Files:**
- Modify: `scanner/src/types.ts` (інтерфейс `RawJob`)
- Modify: `scanner/src/sources/ats.ts` (`fetchAshby`, `fetchLever`)
- Test: `scanner/src/sources/ats.test.ts` (створити)

Ashby і Lever віддають текст **у тій самій відповіді**, яку сканер уже отримує. Жодного додаткового запиту. Greenhouse тут не чіпаємо: `?content=true` роздуває відповідь у 21 раз (42 КБ → 910 КБ на 69 вакансій), тому він піде лінивим шляхом у Task 5.

- [ ] **Step 1: Додати поле в `RawJob`**

У `scanner/src/types.ts`, після поля `commitment`:

```ts
  /**
   * Сирий текст оголошення. У базу НЕ потрапляє: із нього роблять витяг
   * (`summary.ts`) і зберігають лише його. Заповнюють ті джерела, що
   * віддають текст разом зі списком — Ashby, Lever.
   */
  description?: string | null;
```

- [ ] **Step 2: Написати падаючі тести**

```ts
import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

const asJson = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) as Response);

describe("fetchAshby", () => {
  it("бере descriptionPlain із того самого виклику", async () => {
    asJson({ jobs: [{ title: "Ops Associate", location: "Remote", isRemote: true,
      jobUrl: "https://jobs.ashbyhq.com/acme/1", publishedAt: "2026-08-01T00:00:00Z",
      descriptionPlain: "You will own the trade lifecycle." }] });
    const { fetchAshby } = await import("./ats.js");
    const jobs = await fetchAshby("acme", "Acme");
    expect(jobs[0]!.description).toBe("You will own the trade lifecycle.");
  });
});

describe("fetchLever", () => {
  it("віддає перевагу descriptionBodyPlain перед descriptionPlain", async () => {
    // openingPlain у Lever — це часто загальний маркетинг компанії, який
    // не має стосунку до ролі. Тіло опису точніше.
    asJson([{ text: "Android Engineer", hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { location: "Berlin" }, createdAt: 1_700_000_000_000,
      descriptionPlain: "Sell what you love.",
      descriptionBodyPlain: "You will build and evolve mobile experiences." }]);
    const { fetchLever } = await import("./ats.js");
    const jobs = await fetchLever("acme", "Acme");
    expect(jobs[0]!.description).toBe("You will build and evolve mobile experiences.");
  });

  it("падає назад на descriptionPlain, коли тіла немає", async () => {
    asJson([{ text: "Android Engineer", hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { location: "Berlin" }, createdAt: 1_700_000_000_000,
      descriptionPlain: "You will build mobile experiences." }]);
    const { fetchLever } = await import("./ats.js");
    const jobs = await fetchLever("acme", "Acme");
    expect(jobs[0]!.description).toBe("You will build mobile experiences.");
  });
});
```

- [ ] **Step 3: Запустити — мають упасти**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
npx vitest run src/sources/ats.test.ts
```

Expected: FAIL — `expected undefined to be 'You will own the trade lifecycle.'`

- [ ] **Step 4: Реалізувати**

У `fetchAshby` додати `descriptionPlain?: string` у тип відповіді й `description: j.descriptionPlain ?? null` у результат:

```ts
export async function fetchAshby(slug: string, name: string, o: FetchOptions = {}): Promise<RawJob[]> {
  const p = await fetchJson<{ jobs?: Array<{ title: string; location?: string; isRemote?: boolean; publishedAt?: string; jobUrl: string; isListed?: boolean; descriptionPlain?: string }> }>(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}`, {}, o);
  return (p.jobs ?? []).filter((j) => j.isListed !== false).map((j) => ({
    url: j.jobUrl, company: name, title: j.title, location: j.location ?? null,
    remote: j.isRemote === true || REMOTE.test(j.location ?? ""),
    postedAt: iso(j.publishedAt), source: `ashby:${slug}`,
    description: j.descriptionPlain ?? null }));
}
```

У `fetchLever` додати `descriptionPlain?: string; descriptionBodyPlain?: string` у тип і в результат:

```ts
      description: j.descriptionBodyPlain ?? j.descriptionPlain ?? null,
```

- [ ] **Step 5: Запустити — мають пройти**

```bash
npx vitest run src/sources/ats.test.ts
```

Expected: PASS, 3 тести.

- [ ] **Step 6: Коміт**

```bash
git add scanner/src/types.ts scanner/src/sources/ats.ts scanner/src/sources/ats.test.ts
git commit -m "Ashby і Lever віддають текст оголошення, який ми досі викидали"
```

---

## Task 4: Запис витягу в кеш

**Files:**
- Modify: `scanner/src/repo.ts:21-38` (`upsertJobs`)
- Modify: `scanner/src/normalize.ts` (пронести `description` крізь нормалізацію)
- Test: `scanner/src/repo.test.ts` (створити)

- [ ] **Step 1: Перевірити, чи `normalize` не губить поле**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
grep -n "return {\|\.\.\.j\|\.\.\.raw" src/normalize.ts | head
```

Якщо нормалізація будує об'єкт через `{ ...job, ... }` — поле проходить саме, нічого не змінюємо. Якщо перелічує поля вручну — додати `description: j.description ?? null`.

- [ ] **Step 2: Написати падаючий тест**

```ts
import { describe, expect, it, vi } from "vitest";
import { Repo } from "./repo.js";
import type { NormalizedJob } from "./types.js";

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  url: "https://jobs.ashbyhq.com/acme/1", company: "Acme", companyKey: "acme",
  title: "Ops Associate", location: "Remote", remote: true, postedAt: null,
  source: "ashby:acme", tags: [], dedupeKey: "acme|ops", fetchedAt: "2026-08-28T00:00:00Z",
  ...over,
});

describe("upsertJobs", () => {
  it("зберігає витяг, а не сирий текст оголошення", async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo({ batch } as never);
    const raw = "About the Role\n\nYou will own the trade lifecycle for equities and crypto every day.";
    await repo.upsertJobs([job({ description: raw })]);

    const [stmt] = batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    expect(stmt!.sql).toMatch(/summary/);
    const summary = stmt!.params.find((p) => typeof p === "string" && p.startsWith("You will own"));
    expect(summary).toBeDefined();
    expect(stmt!.params).not.toContain(raw);      // сирий текст у базу не летить
  });

  it("лишає summary порожнім, коли тексту немає", async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo({ batch } as never);
    await repo.upsertJobs([job()]);
    const [stmt] = batch.mock.calls[0]![0] as Array<{ params: unknown[] }>;
    expect(stmt!.params.filter((p) => p === null).length).toBeGreaterThan(0);
  });
});
```

> Якщо клас у `repo.ts` називається інакше за `Repo`, підставити справжню назву — перевірити через `grep -n "^export class" src/repo.ts`.

- [ ] **Step 3: Запустити — має впасти**

```bash
npx vitest run src/repo.test.ts
```

Expected: FAIL — `expected sql to match /summary/`.

- [ ] **Step 4: Реалізувати**

У `scanner/src/repo.ts` імпортувати витяг і додати два стовпці:

```ts
import { summarize } from "./summary.js";
```

```ts
  async upsertJobs(jobs: NormalizedJob[]): Promise<void> {
    if (jobs.length === 0) return;
    const statements: D1Statement[] = jobs.map((j) => {
      // Сирий текст оголошення в базу не пишемо ніколи — лише витяг.
      const summary = summarize(j.description, j.company);
      return {
        sql: `INSERT INTO jobs_cache
                (id,url,company,company_key,title,location,remote,salary_min,salary_max,salary_currency,source,tags,dedupe_key,posted_at,fetched_at,summary,summary_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(url) DO UPDATE SET
                company=excluded.company, title=excluded.title, location=excluded.location,
                remote=excluded.remote, source=excluded.source, tags=excluded.tags,
                posted_at=excluded.posted_at, fetched_at=excluded.fetched_at,
                -- Наявний опис не затираємо порожнім: джерело могло
                -- цього разу не віддати текст.
                summary=COALESCE(excluded.summary, jobs_cache.summary),
                summary_at=COALESCE(excluded.summary_at, jobs_cache.summary_at)`,
        params: [
          crypto.randomUUID(), j.url, j.company, j.companyKey, j.title, j.location,
          j.remote ? 1 : 0, j.salaryMin ?? null, j.salaryMax ?? null, j.salaryCurrency ?? null,
          j.source, JSON.stringify(j.tags), j.dedupeKey, j.postedAt, j.fetchedAt,
          summary, summary ? j.fetchedAt : null,
        ],
      };
    });
    await this.d1.batch(statements);
  }
```

- [ ] **Step 5: Запустити — мають пройти**

```bash
npx vitest run src/repo.test.ts
```

Expected: PASS, 2 тести.

- [ ] **Step 6: Коміт**

```bash
git add scanner/src/repo.ts scanner/src/normalize.ts scanner/src/repo.test.ts
git commit -m "Кеш зберігає витяг опису, сирий текст не зберігається"
```

---

## Task 5: Структуровані причини збігу

**Files:**
- Modify: `scanner/src/match.ts` (`ScoredJob`, `scoreJob`)
- Modify: `scanner/src/match.test.ts`

`ScoredJob.reasons: string[]` замінюється на `facts: MatchFact[]`. Перевірено: `reasons` не читає ніхто за межами `match.ts`, тож заміна безпечна.

- [ ] **Step 1: Написати падаючі тести**

Додати в `scanner/src/match.test.ts`:

```ts
import { scoreJob, type MatchFact, type CandidateJob, type Profile } from "./match.js";

const prof = (over: Partial<Profile> = {}): Profile => ({
  userId: "u1", spheres: ["operations"], industries: ["fintech"],
  seniority: "senior", remoteMode: "remote_only", location: null, salaryMin: null, ...over,
});

const cand = (over: Partial<CandidateJob> = {}): CandidateJob => ({
  id: "j1", company: "Acme", companyKey: "acme", title: "Ops Associate",
  location: "Remote", remote: true, url: "https://acme.com/1",
  tags: ["operations", "fintech", "senior"], postedAt: null,
  salaryMin: null, salaryCurrency: null, ...over,
});

describe("facts", () => {
  it("пише ідентифікатори, а не готовий текст", () => {
    const f = scoreJob(cand(), prof()).facts;
    expect(f).toContainEqual({ k: "sphere", v: "operations" } satisfies MatchFact);
    expect(f).toContainEqual({ k: "industry", v: "fintech" } satisfies MatchFact);
    expect(f).toContainEqual({ k: "level" } satisfies MatchFact);
    expect(f).toContainEqual({ k: "remote" } satisfies MatchFact);
  });

  it("тримає порядок від сильнішого до слабшого", () => {
    const ks = scoreJob(cand({ postedAt: new Date().toISOString() }), prof()).facts.map((x) => x.k);
    expect(ks.indexOf("sphere")).toBeLessThan(ks.indexOf("industry"));
    expect(ks.indexOf("industry")).toBeLessThan(ks.indexOf("level"));
    expect(ks.indexOf("level")).toBeLessThan(ks.indexOf("remote"));
    expect(ks.at(-1)).toBe("fresh");
  });

  it("дає різні факти різним вакансіям — саме цього бракувало", () => {
    const a = scoreJob(cand(), prof()).facts;
    const b = scoreJob(cand({ id: "j2", remote: false, location: "Berlin",
      tags: ["operations"] }), prof({ remoteMode: "relocate" })).facts;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("своя роль дає факт role, а не sphere", () => {
    const f = scoreJob(cand({ tags: [], title: "Solidity Auditor" }),
      prof({ spheres: [], customRole: "solidity audit" })).facts;
    expect(f).toContainEqual({ k: "role", v: "solidity audit" } satisfies MatchFact);
  });
});
```

- [ ] **Step 2: Запустити — мають упасти**

```bash
npx vitest run src/match.test.ts
```

Expected: FAIL — `facts` не існує.

- [ ] **Step 3: Реалізувати**

У `scanner/src/match.ts` додати тип і замінити `reasons` на `facts`:

```ts
/**
 * Причина збігу як дані, а не як речення.
 *
 * Сканер — окремий пакет і навмисно не бачить web/src/lib/vocab.ts, тому
 * контракт між ними — саме цей JSON. Сканер пише ідентифікатори, сайт
 * розкриває їх у назви за локаллю. Побічний виграш: у добірці більше не
 * стоїть сире «operations» замість «Операції та проєкти».
 */
export type MatchFact =
  | { k: "sphere"; v: string }
  | { k: "role"; v: string }
  | { k: "industry"; v: string }
  | { k: "place"; v: string }
  | { k: "level" }
  | { k: "remote" }
  | { k: "salary" }
  | { k: "fresh" };
```

В `ScoredJob` замінити `reasons: string[]` на `facts: MatchFact[]`.

У `scoreJob` замінити тіло: `const reasons: string[] = []` → `const facts: MatchFact[] = []`, і кожен `reasons.push(...)` на відповідний факт:

| Було | Стало |
|---|---|
| `reasons.push(\`сфера: ${sphereHits.join(", ")}\`)` | `for (const s of sphereHits) facts.push({ k: "sphere", v: s })` |
| `reasons.push(\`роль: ${p.customRole}\`)` | `facts.push({ k: "role", v: p.customRole! })` |
| `reasons.push(\`індустрія: ${industryHits.join(", ")}\`)` | `for (const i of industryHits) facts.push({ k: "industry", v: i })` |
| `reasons.push("рівень збігається")` | `facts.push({ k: "level" })` |
| `reasons.push("віддалено")` | `facts.push({ k: "remote" })` |
| `reasons.push(\`локація: ${p.location}\`)` | `facts.push({ k: "place", v: p.location })` |
| `reasons.push("зарплата підходить")` | `facts.push({ k: "salary" })` |
| `reasons.push("свіжа")` | `facts.push({ k: "fresh" })` |

Останній рядок: `return { ...job, score, facts };`

`explainLocally()` **лишається без змін** — його результат далі пишеться в `why_fits` як запасний варіант для старих рядків.

- [ ] **Step 4: Запустити всі тести сканера**

```bash
npx vitest run
```

Expected: PASS. Якщо десь падає через `reasons` — це і є той код, який треба перевести на `facts`.

- [ ] **Step 5: Коміт**

```bash
git add scanner/src/match.ts scanner/src/match.test.ts
git commit -m "Причини збігу як дані, а не як склеєний рядок"
```

---

## Task 6: Добірка пише факти й ліниво добирає опис

**Files:**
- Modify: `scanner/src/digest.ts:205-270` (вибірка кандидатів, INSERT у `sent`)
- Modify: `scanner/src/digest-copy.ts` (рядок опису в повідомленні)
- Test: `scanner/src/digest.test.ts` (доповнити)

- [ ] **Step 1: Написати падаючий тест на лінивий добір**

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { fillMissingSummaries } from "./digest.js";

afterEach(() => vi.restoreAllMocks());

describe("fillMissingSummaries", () => {
  it("не ходить у мережу, коли опис уже є", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const out = await fillMissingSummaries([
      { id: "1", url: "https://boards.greenhouse.io/acme/jobs/7", company: "Acme", summary: "Already here." },
    ] as never);
    expect(f).not.toHaveBeenCalled();
    expect(out.get("1")).toBe("Already here.");
  });

  it("довантажує Greenhouse поштучно і робить витяг", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: "&lt;p&gt;You will own the ACATS transfer workflow across partners.&lt;/p&gt;" }),
        { status: 200 }) as Response);
    const out = await fillMissingSummaries([
      { id: "1", url: "https://boards.greenhouse.io/acme/jobs/7", company: "Acme", summary: null },
    ] as never);
    expect(out.get("1")).toMatch(/^You will own the ACATS/);
    expect(out.get("1")).not.toMatch(/[<>]/);
  });

  it("мовчки лишає порожньо, коли джерело впало", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const out = await fillMissingSummaries([
      { id: "1", url: "https://boards.greenhouse.io/acme/jobs/7", company: "Acme", summary: null },
    ] as never);
    expect(out.get("1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустити — має впасти**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
npx vitest run src/digest.test.ts
```

Expected: FAIL — `fillMissingSummaries` не експортується.

- [ ] **Step 3: Реалізувати лінивий добір**

Додати в `scanner/src/digest.ts`:

```ts
import { summarize } from "./summary.js";

/**
 * Опис для тих вакансій, у яких його ще немає.
 *
 * Ashby і Lever віддають текст разом зі списком, тому в них summary вже
 * заповнений на скані. Greenhouse віддає його лише за ?content=true, що
 * роздуває масовий скан у 21 раз — тому платимо поштучно і лише за ті
 * ≤5 вакансій, які справді йдуть людині.
 *
 * Джерело впало — лишаємо порожньо. Картка просто буде без опису.
 */
export async function fillMissingSummaries(
  jobs: Array<{ id: string; url: string; company: string; summary: string | null }>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const j of jobs) {
    if (j.summary) { out.set(j.id, j.summary); continue; }

    const gh = /^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/.exec(j.url);
    if (!gh) continue;
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`,
        { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { content?: string };
      const s = summarize(body.content, j.company);
      if (s) out.set(j.id, s);
    } catch { /* мовчки далі: опис не критичний */ }
  }
  return out;
}
```

- [ ] **Step 4: Пронести опис і факти в `sent`**

У вибірці кандидатів (`digest.ts:205`) додати `summary` до `SELECT` з `jobs_cache`. Далі, перед `INSERT`:

```ts
    const summaries = await fillMissingSummaries(
      top.map((j) => ({ id: j.id, url: j.url, company: j.company, summary: j.summary ?? null })));

    // Новий опис варто покласти назад у спільний кеш: наступній людині
    // ця сама вакансія дістанеться вже з описом і без зайвого запиту.
    const fresh = [...summaries.entries()].filter(([id]) => !top.find((j) => j.id === id)?.summary);
    if (fresh.length > 0) {
      await d1.batch(fresh.map(([id, s]) => ({
        sql: "UPDATE jobs_cache SET summary=?, summary_at=datetime('now') WHERE id=? AND summary IS NULL",
        params: [s, id],
      })));
    }
```

І в `INSERT INTO sent` додати стовпець `match_facts`:

```ts
    await d1.batch(withWhy.map((j) => ({
      sql: `INSERT INTO sent (id,user_id,job_id,digest_id,why_fits,match_facts,status,sent_at,dedupe_key)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(user_id,job_id) DO NOTHING`,
      params: [crypto.randomUUID(), u.id, j.id, digestId, j.why, JSON.stringify(j.facts),
               u.telegram_chat_id && botToken ? "sent" : "pending",
               u.telegram_chat_id && botToken ? now.toISOString() : null,
               dedupeById.get(j.id) ?? null],
    })));
```

- [ ] **Step 5: Опис у повідомленні Telegram**

У `scanner/src/digest.ts`, у побудові рядків повідомлення (близько рядка 65), замінити блок «чому ти» на опис:

```ts
    // Опис самої вакансії. Рядок «чому ти» був однаковий на всі п'ять
    // позицій, бо будувався з профілю, а профіль один.
    if (j.summary) { lines.push(j.summary); lines.push(""); }
```

Тип `jobs` у сигнатурі функції побудови повідомлення (`digest.ts:40`) змінити з `Array<CandidateJob & { why: string }>` на `Array<CandidateJob & { why: string; summary?: string | null }>`.

Ключ `why` у `scanner/src/digest-copy.ts` **лишити** — він ще потрібен для повторної доставки старих `pending`-добірок, де опису немає.

- [ ] **Step 6: Запустити всі тести сканера**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Коміт**

```bash
git add scanner/src/digest.ts scanner/src/digest-copy.ts scanner/src/digest.test.ts
git commit -m "Добірка несе опис вакансії та структуровані факти"
```

---

## Task 7: Чіпи збігу на сайті

**Files:**
- Create: `web/src/lib/facts.ts`
- Test: `web/src/lib/facts.test.ts`

- [ ] **Step 1: Написати падаючі тести**

```ts
import { describe, expect, it } from "vitest";
import { parseFacts, factLabels } from "./facts";

describe("parseFacts", () => {
  it("розбирає JSON зі сканера", () => {
    expect(parseFacts('[{"k":"sphere","v":"operations"},{"k":"remote"}]'))
      .toEqual([{ k: "sphere", v: "operations" }, { k: "remote" }]);
  });

  it("не валиться на сміттi", () => {
    expect(parseFacts("не json")).toEqual([]);
    expect(parseFacts(null)).toEqual([]);
    expect(parseFacts('{"k":"sphere"}')).toEqual([]);   // не масив
    expect(parseFacts('[1,2,"x"]')).toEqual([]);        // не факти
  });
});

describe("factLabels", () => {
  it("розкриває ідентифікатори в назви за локаллю", () => {
    const f = [{ k: "sphere" as const, v: "operations" }, { k: "industry" as const, v: "fintech" }];
    expect(factLabels(f, "uk")).toEqual(["Операції та проєкти", "Фінтех"]);
    expect(factLabels(f, "en")).toEqual(["Operations & Programs", "Fintech"]);
  });

  it("не показує більше за п'ять", () => {
    const f = [
      { k: "sphere" as const, v: "operations" }, { k: "industry" as const, v: "fintech" },
      { k: "level" as const }, { k: "remote" as const }, { k: "salary" as const }, { k: "fresh" as const },
    ];
    expect(factLabels(f, "uk")).toHaveLength(5);
  });

  it("невідомий ідентифікатор не валить рендер", () => {
    expect(factLabels([{ k: "sphere", v: "квантова-телепатія" }], "uk")).toEqual(["квантова-телепатія"]);
  });

  it("своя роль показується як написала людина", () => {
    expect(factLabels([{ k: "role", v: "solidity audit" }], "uk")).toEqual(["solidity audit"]);
  });
});
```

- [ ] **Step 2: Запустити — мають упасти**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
npx vitest run src/lib/facts.test.ts
```

Expected: FAIL — модуля немає.

- [ ] **Step 3: Реалізувати**

```ts
/**
 * Читання причин збігу, які записав сканер.
 *
 * Сканер — окремий пакет і спільного коду з сайтом не має, тому контракт
 * між ними — JSON у sent.match_facts. Тут його розкривають у назви за
 * локаллю через той самий словник, який бачила людина в онбордингу.
 */
import { INDUSTRIES, SPHERES, label, type Locale } from "./vocab";
import { t } from "./i18n";

export type MatchFact =
  | { k: "sphere"; v: string }
  | { k: "role"; v: string }
  | { k: "industry"; v: string }
  | { k: "place"; v: string }
  | { k: "level" }
  | { k: "remote" }
  | { k: "salary" }
  | { k: "fresh" };

const KINDS = new Set(["sphere", "role", "industry", "place", "level", "remote", "salary", "fresh"]);

const isFact = (x: unknown): x is MatchFact =>
  typeof x === "object" && x !== null && KINDS.has((x as { k?: unknown }).k as string);

export function parseFacts(raw: string | null | undefined): MatchFact[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isFact) : [];
  } catch {
    return [];
  }
}

const named = (src: readonly { id: string; en: string; uk: string; fr: string; ru: string }[],
               id: string, locale: Locale): string => {
  const it = src.find((x) => x.id === id);
  // Невідомий ідентифікатор показуємо як є: краще сире слово, ніж порожня
  // картка або виняток на сервері.
  return it ? label(it, locale) : id;
};

/** Підписи чіпів, від сильнішого до слабшого. Максимум п'ять. */
export function factLabels(facts: MatchFact[], locale: Locale, max = 5): string[] {
  return facts.slice(0, max).map((f) => {
    switch (f.k) {
      case "sphere":   return named(SPHERES, f.v, locale);
      case "industry": return named(INDUSTRIES, f.v, locale);
      case "role":     return f.v;
      case "place":    return f.v;
      case "level":    return t(locale, "fact.level");
      case "remote":   return t(locale, "fact.remote");
      case "salary":   return t(locale, "fact.salary");
      case "fresh":    return t(locale, "fact.fresh");
    }
  });
}
```

- [ ] **Step 4: Додати рядки в `web/src/lib/i18n.ts`**

Чотири ключі в кожен із чотирьох блоків мов, поруч із наявними `dash.*`:

```
en: "fact.level": "your level",  "fact.remote": "remote",     "fact.salary": "pays your range", "fact.fresh": "fresh"
uk: "fact.level": "твій рівень", "fact.remote": "віддалено",  "fact.salary": "вилка підходить", "fact.fresh": "свіжа"
fr: "fact.level": "votre niveau","fact.remote": "à distance", "fact.salary": "salaire adapté",  "fact.fresh": "récente"
ru: "fact.level": "твой уровень","fact.remote": "удалённо",   "fact.salary": "вилка подходит",  "fact.fresh": "свежая"
```

- [ ] **Step 5: Запустити — мають пройти**

```bash
npx vitest run src/lib/facts.test.ts
```

Expected: PASS, 6 тестів.

- [ ] **Step 6: Коміт**

```bash
git add web/src/lib/facts.ts web/src/lib/facts.test.ts web/src/lib/i18n.ts
git commit -m "Чіпи збігу: ідентифікатори зі сканера розкриваються за локаллю"
```

---

## Task 8: Заголовки добірок із часом

**Files:**
- Create: `web/src/lib/digest-time.ts`
- Test: `web/src/lib/digest-time.test.ts`

- [ ] **Step 1: Написати падаючі тести**

```ts
import { describe, expect, it } from "vitest";
import { dayLabel } from "./digest-time";

const now = new Date("2026-08-28T12:00:00Z");

describe("dayLabel", () => {
  it("сьогодні з часом у зоні людини", () => {
    expect(dayLabel("2026-08-28T06:00:00Z", "Europe/Kyiv", "uk", now)).toBe("Сьогодні, 09:00");
  });

  it("дві добірки за добу різняться часом", () => {
    const a = dayLabel("2026-08-28T06:00:00Z", "Europe/Kyiv", "uk", now);
    const b = dayLabel("2026-08-28T11:00:00Z", "Europe/Kyiv", "uk", now);
    expect(a).not.toBe(b);
  });

  it("вчора", () => {
    expect(dayLabel("2026-08-27T06:00:00Z", "Europe/Kyiv", "uk", now)).toBe("Вчора, 09:00");
  });

  it("давніше — дата словами", () => {
    expect(dayLabel("2026-08-24T06:00:00Z", "Europe/Kyiv", "uk", now)).toBe("24 серпня, 09:00");
  });

  it("зона людини вирішує, який це день", () => {
    // 23:30 UTC — це вже наступний день у Києві, але ще той самий у Нью-Йорку.
    expect(dayLabel("2026-08-27T23:30:00Z", "Europe/Kyiv", "uk", now)).toMatch(/^Сьогодні/);
    expect(dayLabel("2026-08-27T23:30:00Z", "America/New_York", "uk", now)).toMatch(/^Вчора/);
  });

  it("невідома зона не валить сторінку", () => {
    expect(() => dayLabel("2026-08-28T06:00:00Z", "Марс/Олімп", "uk", now)).not.toThrow();
  });
});
```

- [ ] **Step 2: Запустити — мають упасти**

```bash
npx vitest run src/lib/digest-time.test.ts
```

Expected: FAIL — модуля немає.

- [ ] **Step 3: Реалізувати**

```ts
/**
 * Заголовок добірки.
 *
 * Дві добірки за одну добу мали однаковий заголовок «2026-08-28» і
 * розрізнити їх було неможливо. Тепер день називається словом, а час
 * рахується в зоні людини — той самий момент є «сьогодні» в Києві й
 * «вчора» в Нью-Йорку.
 */
import { t } from "./i18n";
import type { Locale } from "./vocab";

const intlOf = (locale: Locale): string => (locale === "en" ? "en-GB" : locale);

/** Невідома зона не має валити сторінку кабінету. */
const safe = (timezone: string): string => {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); return timezone; }
  catch { return "UTC"; }
};

export function dayLabel(createdAt: string, timezone: string, locale: Locale, now = new Date()): string {
  const tz = safe(timezone);
  const d = new Date(createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`);

  const ymd = (x: Date): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  const today = ymd(now);
  const yesterday = ymd(new Date(now.getTime() - 86_400_000));

  const day =
    ymd(d) === today ? t(locale, "time.today")
    : ymd(d) === yesterday ? t(locale, "time.yesterday")
    : new Intl.DateTimeFormat(intlOf(locale), { timeZone: tz, day: "numeric", month: "long" }).format(d);

  return `${day}, ${time}`;
}
```

- [ ] **Step 4: Додати рядки в `web/src/lib/i18n.ts`**

```
en: "time.today": "Today", "time.yesterday": "Yesterday"
uk: "time.today": "Сьогодні", "time.yesterday": "Вчора"
fr: "time.today": "Aujourd'hui", "time.yesterday": "Hier"
ru: "time.today": "Сегодня", "time.yesterday": "Вчера"
```

- [ ] **Step 5: Запустити — мають пройти**

```bash
npx vitest run src/lib/digest-time.test.ts
```

Expected: PASS, 6 тестів.

- [ ] **Step 6: Коміт**

```bash
git add web/src/lib/digest-time.ts web/src/lib/digest-time.test.ts web/src/lib/i18n.ts
git commit -m "Заголовок добірки: день словом і час у зоні людини"
```

---

## Task 9: Дії кабінету

**Files:**
- Modify: `web/src/app/actions.ts` (`listMatches`, `saveProfile`, три нові дії)

- [ ] **Step 1: Розширити `listMatches`**

Замінити наявну функцію (`actions.ts:178`):

```ts
export const listMatches = async (userId: string) =>
  all<{ id: string; company: string; title: string; location: string | null; url: string;
        why_fits: string; match_facts: string; summary: string | null;
        salary_min: number | null; salary_currency: string | null;
        applied_at: string | null; hidden_at: string | null;
        created_at: string; digest_id: string }>(
    `SELECT s.id,j.company,j.title,j.location,j.url,s.why_fits,s.match_facts,
            j.summary,j.salary_min,j.salary_currency,
            s.applied_at,s.hidden_at,s.created_at,s.digest_id
     FROM sent s JOIN jobs_cache j ON j.id = s.job_id
     WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 50`, userId);
```

- [ ] **Step 2: Три дії стану**

Додати в кінець `actions.ts`:

```ts
/**
 * Стан вакансії в кабінеті.
 *
 * Кожна дія звіряє власника: id рядка sent приходить із форми, тож без
 * умови user_id людина могла б змінити чужий запис, підмінивши id.
 */
async function setMatchState(formData: FormData, column: "applied_at" | "hidden_at", value: "now" | null): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await run(
    `UPDATE sent SET ${column} = ${value === "now" ? "datetime('now')" : "NULL"}
      WHERE id=? AND user_id=?`, id, user.id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
  redirect("/dashboard");
}

// Кожен експорт у файлі "use server" мусить бути саме async-функцією.
// Стрілка, що просто повертає проміс, збірку не пройде.
export async function hideMatch(f: FormData): Promise<void>   { await setMatchState(f, "hidden_at", "now"); }
export async function unhideMatch(f: FormData): Promise<void> { await setMatchState(f, "hidden_at", null); }
export async function undoApplied(f: FormData): Promise<void> { await setMatchState(f, "applied_at", null); }
```

> Стовпець підставляється з літерального об'єднання типів, а не з даних форми — рядок SQL лишається замкненим.

- [ ] **Step 3: Перша добірка одразу**

У `persistProfile` (`actions.ts:95`), після наявного `INSERT INTO profiles`, додати:

```ts
  // Перша добірка поза розкладом. Умова NOT EXISTS принципова: без неї
  // кожне редагування профілю замовляло б позачергову доставку.
  // Таблиця й погодинний розгрібач уже існують (scanner/src/digest.ts).
  await run(
    `INSERT INTO delivery_requests (id,user_id)
     SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM sent WHERE user_id=?)
                  AND NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=?)`,
    uuid(), userId, userId, userId);
```

- [ ] **Step 4: Перевірити збірку типів**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
npx tsc --noEmit
```

Expected: без помилок.

- [ ] **Step 5: Коміт**

```bash
git add web/src/app/actions.ts
git commit -m "Дії кабінету: подача, приховування, перша добірка одразу"
```

---

## Task 10: Маршрут подачі

**Files:**
- Create: `web/src/app/apply/[id]/route.ts`
- Test: `web/src/app/apply/apply.test.ts`

- [ ] **Step 1: Написати падаючі тести**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const one = vi.fn();
const run = vi.fn();
const currentUser = vi.fn();

vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));
vi.mock("@/lib/auth", () => ({ currentUser: () => currentUser() }));

beforeEach(() => { one.mockReset(); run.mockReset(); currentUser.mockReset(); });

const call = async (id: string) => {
  const { GET } = await import("./[id]/route");
  return GET(new Request(`https://nextrole.info/apply/${id}`), { params: Promise.resolve({ id }) });
};

describe("GET /apply/:id", () => {
  it("веде на вакансію і позначає подачу", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    one.mockResolvedValue({ url: "https://jobs.ashbyhq.com/acme/1" });
    const res = await call("s1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://jobs.ashbyhq.com/acme/1");
    expect(run).toHaveBeenCalled();
  });

  it("чужий рядок не веде на вакансію і нічого не пише", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    one.mockResolvedValue(null);                 // умова user_id відсікла
    const res = await call("чужий");
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(run).not.toHaveBeenCalled();
  });

  it("без сесії — на вхід", async () => {
    currentUser.mockResolvedValue(null);
    const res = await call("s1");
    expect(res.headers.get("location")).toContain("/login");
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустити — мають упасти**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
npx vitest run src/app/apply/apply.test.ts
```

Expected: FAIL — маршруту немає.

- [ ] **Step 3: Реалізувати**

```ts
/**
 * Подача на вакансію.
 *
 * Одне натискання робить дві речі: веде людину на сторінку роботодавця і
 * лишає слід у кабінеті. Тому це маршрут, а не форма — так кнопка може
 * бути звичайним посиланням у нову вкладку й працює без JavaScript.
 *
 * Адресу беремо З БАЗИ за id рядка, ніколи з параметра запиту. Інакше це
 * був би відкритий редирект: будь-хто міг би підсунути свою адресу.
 */
import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const base = new URL(req.url).origin;

  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${base}/login`, 302);

  // Умова user_id — це і є перевірка власності. Чужий id просто не знайдеться.
  const row = await one<{ url: string }>(
    `SELECT j.url FROM sent s JOIN jobs_cache j ON j.id = s.job_id
      WHERE s.id=? AND s.user_id=?`, id, user.id);
  if (!row) return NextResponse.redirect(`${base}/dashboard`, 302);

  await run(
    "UPDATE sent SET applied_at=COALESCE(applied_at, datetime('now')) WHERE id=? AND user_id=?",
    id, user.id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);

  return NextResponse.redirect(row.url, 302);
}
```

- [ ] **Step 4: Запустити — мають пройти**

```bash
npx vitest run src/app/apply/apply.test.ts
```

Expected: PASS, 3 тести.

- [ ] **Step 5: Коміт**

```bash
git add web/src/app/apply
git commit -m "Маршрут подачі: власність перевіряється, адреса лише з бази"
```

---

## Task 11: Ширина оболонки й стилі картки

**Files:**
- Modify: `web/src/app/shell.tsx:5-16`
- Modify: `web/src/app/dashboard/page.tsx:24` та `web/src/app/sources/page.tsx:49`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Три ширини замість двох**

У `shell.tsx` замінити проп `wide?: boolean` на `width`:

```tsx
export default async function Shell({
  locale, eyebrow, title, lede, width = "narrow", center = false, children,
}: {
  locale: Locale; eyebrow?: string; title: string; lede?: string;
  width?: "narrow" | "roomy" | "wide"; center?: boolean; children: React.ReactNode;
}) {
  const max = width === "wide" ? "max-w-5xl" : width === "roomy" ? "max-w-3xl" : "max-w-2xl";
  return (
    <>
      <Nav locale={locale} />
      <main className={`mx-auto w-full flex-1 px-6 py-14 ${max}` +
                       (center ? " flex flex-col justify-center pb-24" : "")}>
```

Далі в `sources/page.tsx:49` замінити `wide` на `width="wide"`. У `dashboard/page.tsx` буде `width="roomy"` (Task 12).

- [ ] **Step 2: Стилі чіпа й ховера**

Додати в кінець `web/src/app/globals.css`:

```css
/* ── Картка вакансії ────────────────────────────────────────── */

/* Дрібний факт збігу. Не чіп онбордингу: там це вибір, тут — довідка. */
.fact {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.01em;
  color: var(--muted);
}
.fact + .fact::before { content: " · "; color: var(--rule-2); }

/* Дії картки завжди в потоці. display:none зробив би кнопку недосяжною
   з телефона й з клавіатури, тому лише приглушуємо. */
.row-actions { opacity: 0.5; transition: opacity 0.15s ease; }
.match:hover .row-actions,
.match:focus-within .row-actions { opacity: 1; }
@media (hover: none) { .row-actions { opacity: 1; } }

.match-done { opacity: 0.55; }
```

- [ ] **Step 3: Перевірити збірку**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

Expected: збірка проходить.

- [ ] **Step 4: Коміт**

```bash
git add web/src/app/shell.tsx web/src/app/sources/page.tsx web/src/app/globals.css
git commit -m "Третя ширина оболонки, стилі фактів і дій картки"
```

---

## Task 12: Кабінет

**Files:**
- Create: `web/src/app/dashboard/apply-button.tsx`
- Rewrite: `web/src/app/dashboard/page.tsx`
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 1: Кнопка подачі**

```tsx
"use client";

import { useRouter } from "next/navigation";

/**
 * Посилання, а не форма: браузер має відкрити вакансію в новій вкладці, а
 * маршрут /apply — лишити слід. Без JavaScript це працює так само, просто
 * мітка «Подано» з'явиться лише після оновлення сторінки; router.refresh()
 * прибирає цю затримку.
 */
export default function ApplyButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <a href={`/apply/${id}`} target="_blank" rel="noreferrer"
       onClick={() => setTimeout(() => router.refresh(), 400)}
       className="btn btn-quiet whitespace-nowrap px-3 py-1.5 text-xs">
      {label} ↗
    </a>
  );
}
```

- [ ] **Step 2: Переписати сторінку**

```tsx
import { redirect } from "next/navigation";
import Shell from "../shell";
import ApplyButton from "./apply-button";
import { detectLocale, hideMatch, listMatches, recordFeedback, undoApplied, unhideMatch } from "../actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";
import { factLabels, parseFacts } from "@/lib/facts";
import { dayLabel } from "@/lib/digest-time";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ queued?: string }> }) {
  const { queued } = await searchParams;
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");

  const matches = await listMatches(user.id);
  const me = await one<{ timezone: string; delivery_hour: number }>(
    "SELECT timezone,delivery_hour FROM users WHERE id=?", user.id);
  const tz = me?.timezone ?? "UTC";

  // Ранкова пачка — одна одиниця, а не п'ять карток.
  const digests = new Map<string, typeof matches>();
  for (const m of matches) {
    const list = digests.get(m.digest_id) ?? [];
    list.push(m);
    digests.set(m.digest_id, list);
  }

  const money = (m: typeof matches[number]): string | null =>
    m.salary_min ? `${m.salary_min.toLocaleString(locale === "en" ? "en-GB" : locale)} ${m.salary_currency ?? ""}`.trim() : null;

  return (
    <Shell locale={locale} title={t(locale, "dash.title")} width="roomy">
      {queued && <p className="tag tag-ok mb-6 inline-block">{t(locale, "dash.queued")}</p>}

      {matches.length === 0 ? (
        <FirstRun locale={locale} hour={me?.delivery_hour ?? 9} connected={Boolean(user.telegramChatId)} />
      ) : (
        <div className="flex flex-col gap-12">
          {[...digests.entries()].map(([digestId, group]) => {
            const applied = group.filter((m) => m.applied_at).length;
            return (
              <section key={digestId}>
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-2"
                     style={{ borderColor: "var(--rule-2)" }}>
                  <h2 className="mono text-sm" style={{ color: "var(--ember)" }}>
                    {dayLabel(group[0]!.created_at, tz, locale)}
                    <span style={{ color: "var(--muted)" }}>
                      {" · "}{t(locale, "dash.count").replace("{n}", String(group.length))}
                      {applied > 0 && ` · ${t(locale, "dash.applied").replace("{n}", String(applied))}`}
                    </span>
                  </h2>
                  <form action={recordFeedback} className="flex gap-2">
                    <input type="hidden" name="digestId" value={digestId} />
                    <button name="reaction" value="not_relevant" className="btn btn-quiet px-2 py-1 text-xs">
                      {t(locale, "dash.notRelevant")}
                    </button>
                    <button name="reaction" value="more" className="btn btn-quiet px-2 py-1 text-xs">
                      {t(locale, "dash.more")}
                    </button>
                  </form>
                </div>

                <ol className="ruled card mt-4">
                  {group.map((m, i) => {
                    if (m.hidden_at) return (
                      <li key={m.id} className="flex items-center justify-between gap-4 px-6 py-3 text-xs"
                          style={{ color: "var(--muted)" }}>
                        <span>{t(locale, "dash.hidden")}</span>
                        <form action={unhideMatch}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="link text-xs">{t(locale, "dash.unhide")}</button>
                        </form>
                      </li>
                    );

                    const facts = factLabels(parseFacts(m.match_facts), locale);
                    return (
                      <li key={m.id} className={`match grid grid-cols-[2.5rem_1fr] gap-4 px-6 py-6${m.applied_at ? " match-done" : ""}`}>
                        <span className="mono pt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="font-medium leading-snug">
                                {m.company} <span style={{ color: "var(--muted)" }}>·</span> {m.title}
                              </h3>
                              <p className="mono mt-1 text-xs" style={{ color: "var(--muted)" }}>
                                {[m.location, money(m)].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </div>
                            {!m.applied_at && (
                              <div className="row-actions flex shrink-0 items-center gap-2">
                                <ApplyButton id={m.id} label={t(locale, "dash.apply")} />
                                <form action={hideMatch}>
                                  <input type="hidden" name="id" value={m.id} />
                                  <button aria-label={t(locale, "dash.hide")} title={t(locale, "dash.hide")}
                                          className="btn btn-quiet px-2 py-1 text-xs">✕</button>
                                </form>
                              </div>
                            )}
                          </div>

                          {/* Опис самої вакансії. Раніше тут стояв переказ
                              профілю, однаковий на всі п'ять позицій. */}
                          {m.summary ? (
                            <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{m.summary}</p>
                          ) : m.why_fits ? (
                            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{m.why_fits}</p>
                          ) : null}

                          {facts.length > 0 && (
                            <p className="mt-2">{facts.map((f) => <span key={f} className="fact">{f}</span>)}</p>
                          )}

                          {m.applied_at && (
                            {/* div, не p: <form> усередині <p> — недійсний
                                HTML, і React зривається на гідратації. */}
                            <div className="mono mt-3 flex items-center gap-3 text-xs" style={{ color: "var(--ok)" }}>
                              <span>✓ {t(locale, "dash.appliedOn").replace("{d}", m.applied_at.slice(0, 10))}</span>
                              <form action={undoApplied}>
                                <input type="hidden" name="id" value={m.id} />
                                <button className="link text-xs">{t(locale, "dash.undo")}</button>
                              </form>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

/** Що відбувається після онбордингу. Раніше тут був глухий кут. */
function FirstRun({ locale, hour, connected }: { locale: string; hour: number; connected: boolean }) {
  const l = locale as Parameters<typeof t>[0];
  const rows = [
    { mark: "✓", text: t(l, "first.profile"), done: true },
    { mark: "●", text: t(l, "first.soon"), done: false },
    { mark: "○", text: t(l, "first.daily").replace("{h}", `${String(hour).padStart(2, "0")}:00`), done: false },
  ];
  return (
    <div className="card px-8 py-12">
      <p className="display text-2xl">{t(l, "first.title")}</p>
      <ul className="mt-8 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.text} className="flex gap-3 text-sm" style={{ color: r.done ? "var(--ok)" : "var(--ink-2)" }}>
            <span className="mono">{r.mark}</span>{r.text}
          </li>
        ))}
      </ul>
      <div className="mt-9 flex flex-wrap items-center gap-4">
        {!connected && <a href="/telegram" className="btn">{t(l, "telegram.button")}</a>}
        <a href="/onboarding" className="link text-sm">{t(l, "first.edit")}</a>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Додати рядки в `web/src/lib/i18n.ts`**

```
en: "dash.apply":"Apply", "dash.hide":"Not interested", "dash.hidden":"Hidden",
    "dash.unhide":"Bring back", "dash.undo":"Undo", "dash.appliedOn":"Applied {d}",
    "dash.count":"{n} roles", "dash.applied":"{n} applied",
    "first.title":"You are set.", "first.profile":"Profile saved",
    "first.soon":"First batch — within the hour", "first.daily":"Then — every day at {h}",
    "first.edit":"Edit profile"
uk: "dash.apply":"Податися", "dash.hide":"Не цікавить", "dash.hidden":"Приховано",
    "dash.unhide":"Повернути", "dash.undo":"Скасувати", "dash.appliedOn":"Подано {d}",
    "dash.count":"{n} вакансій", "dash.applied":"{n} подано",
    "first.title":"Готово.", "first.profile":"Профіль збережено",
    "first.soon":"Перша добірка — протягом години", "first.daily":"Далі — щодня о {h}",
    "first.edit":"Змінити профіль"
fr: "dash.apply":"Postuler", "dash.hide":"Pas intéressé", "dash.hidden":"Masquée",
    "dash.unhide":"Restaurer", "dash.undo":"Annuler", "dash.appliedOn":"Postulé le {d}",
    "dash.count":"{n} offres", "dash.applied":"{n} envoyées",
    "first.title":"C'est prêt.", "first.profile":"Profil enregistré",
    "first.soon":"Première sélection — dans l'heure", "first.daily":"Ensuite — chaque jour à {h}",
    "first.edit":"Modifier le profil"
ru: "dash.apply":"Откликнуться", "dash.hide":"Не интересно", "dash.hidden":"Скрыто",
    "dash.unhide":"Вернуть", "dash.undo":"Отменить", "dash.appliedOn":"Отклик {d}",
    "dash.count":"{n} вакансий", "dash.applied":"{n} откликов",
    "first.title":"Готово.", "first.profile":"Профиль сохранён",
    "first.soon":"Первая подборка — в течение часа", "first.daily":"Дальше — каждый день в {h}",
    "first.edit":"Изменить профиль"
```

- [ ] **Step 4: Зібрати**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
npx tsc --noEmit && npx vitest run && npm run build 2>&1 | tail -5
```

Expected: типи чисті, тести проходять, збірка проходить.

- [ ] **Step 5: Коміт**

```bash
git add web/src/app/dashboard web/src/lib/i18n.ts
git commit -m "Кабінет: опис вакансії, подача зі станом, розрізнені добірки"
```

---

## Task 13: Онбординг у боті

**Files:**
- Modify: `web/src/lib/bot.ts` (кінець онбордингу, `/start`)
- Modify: `web/src/lib/bot-onboarding.ts` (`readyText`)

- [ ] **Step 1: Перша добірка з бота**

Знайти місце, де бот зберігає профіль після останнього кроку:

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
grep -n "INSERT INTO profiles\|readyText" src/lib/bot.ts
```

Одразу після збереження профілю додати той самий захищений запит, що й на сайті:

```ts
      // Та сама умова, що й у actions.ts: замовляємо лише першу добірку.
      await run(
        `INSERT INTO delivery_requests (id,user_id)
         SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM sent WHERE user_id=?)
                      AND NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=?)`,
        crypto.randomUUID(), userId, userId, userId);
```

- [ ] **Step 2: Три кроки замість голої готовності**

У `bot-onboarding.ts` замінити `readyText`:

```ts
const NEXT: Phrase = {
  en: "You are set.\n\n✓ Profile saved\n● First batch — within the hour\n○ Then — every day at your time",
  uk: "Готово.\n\n✓ Профіль збережено\n● Перша добірка — протягом години\n○ Далі — щодня у твій час",
  fr: "C'est prêt.\n\n✓ Profil enregistré\n● Première sélection — dans l'heure\n○ Ensuite — chaque jour à votre heure",
  ru: "Готово.\n\n✓ Профиль сохранён\n● Первая подборка — в течение часа\n○ Дальше — каждый день в твоё время",
};

export const readyText = (locale: Locale): string =>
  `${say(NEXT, locale)}\n\n${say(WORD.commands, locale)}`;
```

- [ ] **Step 3: Два рядки контексту перед першим питанням**

У `bot.ts`, у гілці `/start` для людини без профілю, надіслати перед першим питанням:

```ts
const INTRO: Record<Locale, string> = {
  en: "I send five job openings a day, picked for you. Free.\nFour questions and we start.",
  uk: "Щодня надсилаю п'ять вакансій, підібраних під тебе. Безкоштовно.\nЧотири питання — і почнемо.",
  fr: "J'envoie cinq offres par jour, choisies pour vous. Gratuit.\nQuatre questions et on commence.",
  ru: "Каждый день присылаю пять вакансий, подобранных под тебя. Бесплатно.\nЧетыре вопроса — и начнём.",
};
```

Надіслати його **одним повідомленням перед** першим питанням — там, де `/start`
для людини без рядка в `users` уже викликає `questionText("spheres", locale)`:

```ts
      await send(env, chatId, INTRO[locale]);
      await send(env, chatId, questionText("spheres", locale), keyboard("spheres", emptyDraft(), locale));
```

Не більше двох рядків: далі одразу перше питання з кнопками.

- [ ] **Step 4: Зібрати й прогнати тести**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: PASS. `bot-onboarding.test.ts` може перевіряти старий текст `readyText` — тоді оновити очікування в тесті.

- [ ] **Step 5: Коміт**

```bash
git add web/src/lib/bot.ts web/src/lib/bot-onboarding.ts web/src/lib/bot-onboarding.test.ts
git commit -m "Бот: перша добірка одразу і три кроки замість голої готовності"
```

---

## Task 14: Перевірка на живому

Юніт-тести тут недостатні: зелені тести вже пропускали справжні дефекти парсера DOU, бо перевіряли функцію, а не записаний рядок.

- [ ] **Step 1: Прогнати весь набір**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding
(cd scanner && npx vitest run) && (cd web && npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -3)
```

Expected: усе зелене.

- [ ] **Step 2: Застосувати міграцію (робить людина, не агент)**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/web
npx wrangler d1 execute crypto-jobs-agent --remote \
  --file=../db/migrations/0011_job_summary_and_match_state.sql
```

- [ ] **Step 3: Скан і перевірка ЗАПИСАНИХ рядків**

```bash
cd ~/Projects/crypto-jobs-agent/.claude/worktrees/dashboard-onboarding/scanner
npm run build && npm run scan

cd ../web
npx wrangler d1 execute crypto-jobs-agent --remote --command \
  "SELECT company, substr(summary,1,90) FROM jobs_cache WHERE summary IS NOT NULL ORDER BY random() LIMIT 12"
npx wrangler d1 execute crypto-jobs-agent --remote --command \
  "SELECT COUNT(*) total, SUM(summary IS NOT NULL) with_summary FROM jobs_cache"
```

Очима перевірити: описи різні, тегів `<` `>` немає, порожніх рядків немає. Частка `with_summary` для Ashby/Lever має бути близька до повної.

- [ ] **Step 4: Прогнати добірку на собі**

```bash
cd ../scanner && node dist/digest.js --user <твій id> --force
```

Перевірити в Telegram: п'ять різних описів, не п'ять однакових.

- [ ] **Step 5: Розгорнути сайт**

```bash
cd ../web && npm run cf:deploy
```

> Саме `npm run cf:deploy`, не голий `wrangler deploy` — інакше збірка OpenNext не оновиться.

- [ ] **Step 6: Перевірити кабінет у браузері**

- описи різні на всіх п'яти картках;
- дві добірки за одну добу мають різні заголовки з часом;
- `Податися` відкриває вакансію в новій вкладці й лишає мітку «Подано»;
- `Скасувати` знімає мітку;
- `✕` ховає картку, `Повернути` — повертає;
- на телефоні кнопки видно без наведення.

---

## Ризики

| Ризик | Що робити |
|---|---|
| Витяг дає блурб про компанію частіше, ніж 1 із 5 | Доправити `CORP` і `ROLE` у `summary.ts`, повторити Step 5 Task 2. Правило про назву компанії дало найбільший приріст |
| Greenhouse обмежує поштучні запити | ≤5 запитів на людину на добу. Якщо все ж ловитиме 429 — додати паузу між запитами у `fillMissingSummaries` |
| Старі рядки `sent` без `match_facts` і без `summary` | Передбачено: чіпів немає, показується `why_fits` прозою без зламаного підпису |
| `router.refresh()` не спрацює без JS | Передбачено: маршрут `/apply` усе одно позначить подачу, мітка з'явиться після оновлення |
