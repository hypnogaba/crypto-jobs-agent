import { describe, it, expect } from "vitest";
import { costUsd, PRICES } from "./pricing.js";

describe("costUsd", () => {
  it("рахує haiku за 1$/5$ на мільйон", () => {
    expect(costUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
    expect(costUsd("claude-haiku-4-5", 500, 700)).toBeCloseTo(0.0005 + 0.0035, 9);
  });
  it("розуміє snapshot-суфікси й невідомі моделі", () => {
    expect(costUsd("claude-opus-5", 1_000_000, 0)).toBe(5);
    expect(costUsd(null, 1000, 1000)).toBe(0);
    expect(costUsd("gpt-whatever", 1000, 1000)).toBe(0);
  });
  it("таблиця має всі моделі, що згадуються в коді", () => {
    for (const m of ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]) expect(PRICES[m]).toBeDefined();
  });
});
