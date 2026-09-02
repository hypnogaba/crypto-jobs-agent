import { describe, expect, it, vi } from "vitest";
import { Repo } from "./repo.js";
import type { NormalizedJob } from "./types.js";

/**
 * Подвійник D1. `query` тут не декорація: `upsertJobs` читає ніші компаній
 * перед записом, і тест без цього методу падав би на порожньому каталозі.
 */
const d1 = (batch: unknown, companies: Array<{ slug: string; tags: string }> = []) =>
  ({ batch, query: async () => companies } as never);

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  url: "https://jobs.ashbyhq.com/acme/1", company: "Acme", companyKey: "acme",
  title: "Ops Associate", location: "Remote", remote: true, postedAt: null,
  source: "ashby:acme", tags: [], dedupeKey: "acme|ops", fetchedAt: "2026-08-28T00:00:00Z",
  ...over,
});

describe("upsertJobs", () => {
  it("зберігає витяг, а не сирий текст оголошення", async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo(d1(batch));
    const raw = "About the Role\n\nYou will own the trade lifecycle for equities and crypto every day.";
    await repo.upsertJobs([job({ description: raw })]);

    const [stmt] = batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    expect(stmt!.sql).toMatch(/summary/);
    const summary = stmt!.params.find((p) => typeof p === "string" && p.startsWith("You will own"));
    expect(summary).toBeDefined();
    expect(stmt!.params).not.toContain(raw);      // сирий текст у базу не летить
  });

  it("бере вилку з тексту, коли джерело не дало її полем; поле — важливіше", async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo(d1(batch));
    const raw = "About the Role\n\nYou will own the trade lifecycle.\n\nCompensation: $120,000 - $150,000 per year.";
    await repo.upsertJobs([job({ description: raw }), job({ url: "https://x.test/2", description: raw, salaryMin: 90_000, salaryCurrency: "EUR" })]);
    const [a, b] = batch.mock.calls[0]![0] as Array<{ params: unknown[] }>;
    // Параметри 8–10: salary_min, salary_max, salary_currency.
    expect(a!.params.slice(7, 10)).toEqual([120_000, 150_000, "USD"]);
    expect(b!.params.slice(7, 10)).toEqual([90_000, null, "EUR"]);
  });

  it("лишає summary порожнім, коли тексту немає", async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo(d1(batch));
    await repo.upsertJobs([job()]);
    const [stmt] = batch.mock.calls[0]![0] as Array<{ params: unknown[] }>;
    // Два останні параметри — summary і summary_at.
    expect(stmt!.params.slice(-2)).toEqual([null, null]);
  });
});

describe("startRun", () => {
  it("повтор того самого INSERT після таймауту D1 не валить прогін", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo({ execute } as never);
    await repo.startRun("run-1", "2026-08-29T00:00:00Z");
    expect(execute.mock.calls[0]![0]).toMatch(/INSERT OR IGNORE INTO scan_runs/);
  });
});

describe("rememberGetroCollection", () => {
  /**
   * Найважливіше тут — не перезаписати. У таблиці лежать колекції, вимкнені
   * руками: людина подивилась і вирішила їх не читати. Розвідка ходить
   * щотижня й побачить їх знову — звичайний upsert повертав би їх до життя,
   * і рішення людини скасовувалось би саме собою.
   */
  it("не чіпає наявний рядок — ні мітку, ні enabled", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo({ execute } as never);
    await repo.rememberGetroCollection(858, "Solana Network Opportunities", "https://jobs.solana.com");

    const [sql] = execute.mock.calls[0]! as [string, unknown[]];
    expect(sql).toMatch(/INSERT OR IGNORE/);
    expect(sql).not.toMatch(/ON CONFLICT/);
    expect(sql).not.toMatch(/UPDATE/);
  });

  it("нова колекція записується вимкненою", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo({ execute } as never);
    await repo.rememberGetroCollection(619, "Basis Set", null);

    const [sql, params] = execute.mock.calls[0]! as [string, unknown[]];
    // Живих колекцій сотні; увімкнути всі означало б розтягнути щоденний
    // скан на години. Вмикає людина, і тепер вона бачить назву.
    expect(sql).toMatch(/enabled\)\s*\n?\s*VALUES \(\?, \?, \?, \?, 0\)/);
    expect(params).toEqual(["getro-619", 619, "Basis Set", null]);
  });

  it("без назви лишає впізнаваний підпис, а не порожнечу", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo({ execute } as never);
    await repo.rememberGetroCollection(321, null, null);
    const [, params] = execute.mock.calls[0]! as [string, unknown[]];
    expect(params[2]).toBe("Колекція 321");
  });
});

describe("upsertJobs — ніша компанії", () => {
  it("додає нішу з каталогу, хоч джерело її не дало", async () => {
    // Живий випадок: вакансію Binance того самого дня приносить і
    // `lever:binance` з тегом ніші, і колекція Getro без тега. Другий запис
    // ставить `tags=excluded.tags` і стирає перший.
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo(d1(batch, [{ slug: "binance", tags: '["web3"]' }]));
    await repo.upsertJobs([job({ companyKey: "binance", tags: ["marketing"] })]);
    const [stmt] = batch.mock.calls[0]![0] as Array<{ params: unknown[] }>;
    expect(stmt!.params).toContain(JSON.stringify(["marketing", "web3"]));
  });

  it("чужу компанію не чіпає", async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const repo = new Repo(d1(batch, [{ slug: "binance", tags: '["web3"]' }]));
    await repo.upsertJobs([job({ companyKey: "acme", tags: ["marketing"] })]);
    const [stmt] = batch.mock.calls[0]![0] as Array<{ params: unknown[] }>;
    expect(stmt!.params).toContain(JSON.stringify(["marketing"]));
  });
});
