import { describe, expect, it } from "vitest";
import { companyKey, dedupeKey, isFresh, prepare, titleKey } from "./normalize.js";
import type { RawJob } from "./types.js";

const raw = (o: Partial<RawJob> = {}): RawJob => ({
  url: "https://jobs.example.com/1", company: "Example Inc.", title: "Partnerships Manager",
  location: "Remote", remote: true, postedAt: "2026-08-20T00:00:00.000Z",
  source: "ashby:example", ...o });

describe("companyKey", () => {
  it("прибирає юридичні суфікси й регістр", () => {
    expect(companyKey("Example Inc.")).toBe("example");
    expect(companyKey("EXAMPLE  GmbH")).toBe("example");
  });
  it("не склеює різні компанії", () => {
    expect(companyKey("Solana Foundation")).not.toBe(companyKey("Solana Labs"));
  });
  it("не залишає порожній ключ", () => {
    expect(companyKey("GmbH")).not.toBe("");
  });
});

describe("titleKey", () => {
  it("ігнорує гендерні позначки в назві", () => {
    expect(titleKey("Data Analyst (m/f/d)")).toBe(titleKey("Data  Analyst"));
  });
});

describe("dedupeKey — схлопування геоклонів", () => {
  it("та сама роль у різних країнах дає один ключ", () => {
    expect(dedupeKey(raw({ location: "Berlin, Germany" })))
      .toBe(dedupeKey(raw({ location: "Lisbon, Portugal" })));
  });
  it("різні ролі не схлопуються", () => {
    expect(dedupeKey(raw({ title: "Backend Engineer" })))
      .not.toBe(dedupeKey(raw({ title: "Partnerships Manager" })));
  });
});

describe("isFresh", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  it("приймає свіже", () => expect(isFresh("2026-08-20T00:00:00.000Z", 14, now)).toBe(true));
  it("відкидає старе", () => expect(isFresh("2026-07-01T00:00:00.000Z", 14, now)).toBe(false));
  it("приймає без дати — більшість бордів її не публікують", () =>
    expect(isFresh(null, 14, now)).toBe(true));
});

describe("prepare", () => {
  it("викидає рядки без робочого посилання", () => {
    expect(prepare([raw(), raw({ url: "" }), raw({ url: "mailto:a@b.c" })], 14)).toHaveLength(1);
  });
  it("викидає рядки без назви або компанії", () => {
    expect(prepare([raw({ title: "  " }), raw({ company: "" })], 14)).toHaveLength(0);
  });
  it("схлопує п'ять геоклонів в один рядок", () => {
    const clones = ["Berlin", "Vienna", "Madrid", "Rome", "Lisbon"].map((city, i) =>
      raw({ location: city, url: `https://x.test/${i}` }));
    expect(prepare(clones, 14)).toHaveLength(1);
  });
  it("проставляє теги", () => {
    const [job] = prepare([raw({ title: "Senior Partnerships Manager" })], 14);
    expect(job!.tags).toContain("partnerships");
    expect(job!.tags).not.toContain("senior");
  });
});
