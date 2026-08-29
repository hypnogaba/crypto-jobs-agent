import { describe, expect, it, vi } from "vitest";
import { applySourceOutcomes, skipSet } from "./selfrepair.js";
import type { SourceResult } from "./types.js";

const r = (o: Partial<SourceResult>): SourceResult => ({ source: "aggregator:x", ok: true, jobs: [], ...o });
const repo = () => ({ recordSourceOutcome: vi.fn(), deprecateSource: vi.fn() });

describe("applySourceOutcomes", () => {
  it("записує успіх", async () => {
    const p = repo();
    await applySourceOutcomes([r({ ok: true })], p, []);
    expect(p.recordSourceOutcome).toHaveBeenCalledWith("aggregator:x", true, 0, undefined);
  });
  it("не ховає збій за нуль вакансій", async () => {
    const p = repo();
    await applySourceOutcomes([r({ ok: false, broken: true, error: "403" })], p, []);
    expect(p.recordSourceOutcome).toHaveBeenCalledWith("aggregator:x", false, 0, "403");
  });
  it("вбиває джерело після трьох днів падінь", async () => {
    const p = repo();
    const out = await applySourceOutcomes([r({ ok: false, broken: true })], p,
      [{ source: "aggregator:x", status: "degraded", consecutiveFailDays: 2 }]);
    expect(p.deprecateSource).toHaveBeenCalledWith("aggregator:x");
    expect(out.deprecated).toEqual(["aggregator:x"]);
  });
  it("не вбиває після одного поганого дня", async () => {
    const p = repo();
    await applySourceOutcomes([r({ ok: false })], p,
      [{ source: "aggregator:x", status: "degraded", consecutiveFailDays: 1 }]);
    expect(p.deprecateSource).not.toHaveBeenCalled();
  });
  it("не засмічує таблицю здоров'я невдалими вгадуваннями", async () => {
    const p = repo();
    await applySourceOutcomes([r({ source: "guess:acme", ok: true })], p, []);
    expect(p.recordSourceOutcome).not.toHaveBeenCalled();
  });
});

describe("skipSet", () => {
  it("пропускає лише мертві", () => {
    expect([...skipSet([
      { source: "a", status: "deprecated", consecutiveFailDays: 5 },
      { source: "b", status: "degraded", consecutiveFailDays: 1 },
      { source: "c", status: "ok", consecutiveFailDays: 0 },
    ])]).toEqual(["a"]);
  });
});

describe("джерело, яке не працювало ніколи", () => {
  it("помирає з першої невдачі, а не через три дні", async () => {
    // 143 таких набралось за один прогін: зібрані з ATS-лінків Getro, дошки 404.
    const p = repo();
    const out = await applySourceOutcomes(
      [{ source: "greenhouse:turntide", ok: false, jobs: [], error: "404" }],
      p as never,
      [{ source: "greenhouse:turntide", status: "ok", consecutiveFailDays: 0, everOk: false }]);
    expect(p.deprecateSource).toHaveBeenCalledWith("greenhouse:turntide");
    expect(out.deprecated).toEqual(["greenhouse:turntide"]);
  });

  it("те, що колись працювало, зберігає запас у три дні", async () => {
    const p = repo();
    const out = await applySourceOutcomes(
      [{ source: "lever:finn", ok: false, jobs: [], error: "500" }],
      p as never,
      [{ source: "lever:finn", status: "ok", consecutiveFailDays: 0, everOk: true }]);
    expect(p.deprecateSource).not.toHaveBeenCalled();
    expect(out.deprecated).toEqual([]);
  });
});

describe("429 — це не день падіння", () => {
  it("джерело з rateLimited не записується в здоров'я і не вмирає", async () => {
    // Живе джерело, яке ми просто зачастили. Раніше два таких дні поспіль
    // ховали його назавжди.
    const p = repo();
    const out = await applySourceOutcomes(
      [r({ ok: false, rateLimited: true, error: "429 після 3 спроб" })], p,
      [{ source: "aggregator:x", status: "degraded", consecutiveFailDays: 2, everOk: true }]);
    expect(p.recordSourceOutcome).not.toHaveBeenCalled();
    expect(p.deprecateSource).not.toHaveBeenCalled();
    expect(out.deprecated).toEqual([]);
  });
});

import { skipCompanies } from "./selfrepair.js";

describe("skipCompanies", () => {
  it("мертві ATS-дошки на R1 не йдуть, компанії без ATS лишаються", () => {
    const skip = new Set(["greenhouse:dead"]);
    const cs = [
      { slug: "dead", atsProvider: "greenhouse" as const, atsSlug: "dead" },
      { slug: "alive", atsProvider: "lever" as const, atsSlug: "alive" },
      { slug: "unknown", atsProvider: null, atsSlug: null },
    ];
    expect(skipCompanies(cs, skip).map((c) => c.slug)).toEqual(["alive", "unknown"]);
  });
});
