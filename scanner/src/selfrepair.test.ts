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
