import { describe, expect, it, vi } from "vitest";
import { climbLadder } from "./ladder.js";
import type { RawJob } from "./types.js";

const job = (company: string, n = 1): RawJob => ({
  url: `https://x.test/${company}/${n}`, company, title: `Role ${n}`,
  location: null, remote: true, postedAt: null, source: "test" });

const many = (n: number): RawJob[] => Array.from({ length: n }, (_, i) => job(`Company${i}`));
const out = (jobs: RawJob[] = [], broken: string[] = []) => ({
  jobs, results: broken.map((s) => ({ source: s, ok: false, jobs: [], broken: true })) });

describe("climbLadder", () => {
  it("зупиняється на R1, щойно ціль досягнута", async () => {
    const r = { R1: vi.fn(async () => out(many(8))), R2: vi.fn(async () => out()),
      R3: vi.fn(async () => out()), R4: vi.fn(async () => out()), R5: vi.fn(async () => out()) };
    const o = await climbLadder(r, { distinctCompanyTarget: 7, freshnessDays: 14 });
    expect(o.reached).toBe("R1");
    expect(o.distinctCompanies).toBe(8);
    expect(r.R2).not.toHaveBeenCalled();
  });

  it("лізе далі, поки день бідний", async () => {
    const r = { R1: vi.fn(async () => out(many(2))), R2: vi.fn(async () => out([job("E1")])),
      R3: vi.fn(async () => out([job("E2")])), R4: vi.fn(async () => out([job("E3")])),
      R5: vi.fn(async () => out([job("E4"), job("E5")])) };
    const o = await climbLadder(r, { distinctCompanyTarget: 7, freshnessDays: 14 });
    expect(o.reached).toBe("R5");
    expect(o.distinctCompanies).toBe(7);
  });

  it("порожній рівень не є підставою зупинитись", async () => {
    const r = { R1: vi.fn(async () => out()), R2: vi.fn(async () => out(many(9))),
      R3: vi.fn(async () => out()), R4: vi.fn(async () => out()), R5: vi.fn(async () => out()) };
    const o = await climbLadder(r, { distinctCompanyTarget: 7, freshnessDays: 14 });
    expect(r.R2).toHaveBeenCalled();
    expect(o.reached).toBe("R2");
  });

  it("п'ять геоклонів рахуються як одна компанія", async () => {
    const clones = ["Berlin", "Vienna", "Madrid", "Rome", "Lisbon"].map((city, i) => ({
      ...job("CloneCo", i), title: "Partnerships Manager", location: city, url: `https://x.test/c/${i}` }));
    const r = { R1: vi.fn(async () => out(clones)), R2: vi.fn(async () => out()),
      R3: vi.fn(async () => out()), R4: vi.fn(async () => out()), R5: vi.fn(async () => out()) };
    const o = await climbLadder(r, { distinctCompanyTarget: 7, freshnessDays: 14 });
    expect(o.jobs).toHaveLength(1);
    expect(o.distinctCompanies).toBe(1);
  });

  it("називає недоступні джерела у доказі роботи", async () => {
    const r = { R1: vi.fn(async () => out([], ["greenhouse:acme"])),
      R2: vi.fn(async () => out([], ["aggregator:remoteok"])), R3: vi.fn(async () => out()),
      R4: vi.fn(async () => out()), R5: vi.fn(async () => out()) };
    const o = await climbLadder(r, { distinctCompanyTarget: 7, freshnessDays: 14 });
    expect(o.proofOfWork).toContain("greenhouse:acme");
    expect(o.proofOfWork).toContain("aggregator:remoteok");
    expect(o.reached).toBe("R5");
  });

  it("передає в R4 усе, що зібрано раніше", async () => {
    const R4 = vi.fn(async () => out());
    const r = { R1: vi.fn(async () => out([job("A")])), R2: vi.fn(async () => out([job("B")])),
      R3: vi.fn(async () => out([job("C")])), R4, R5: vi.fn(async () => out()) };
    await climbLadder(r, { distinctCompanyTarget: 99, freshnessDays: 14 });
    expect(R4.mock.calls[0]![0]).toHaveLength(3);
  });
});
