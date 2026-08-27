import { describe, expect, it } from "vitest";
import { deriveTags } from "./tags.js";
import type { RawJob } from "./types.js";

const j = (o: Partial<RawJob>): RawJob => ({
  url: "https://x.test/1", company: "Acme", title: "Engineer", location: null,
  remote: false, postedAt: null, source: "greenhouse:acme", ...o });

describe("deriveTags — маршрутизація за нішами", () => {
  it("розпізнає сферу з назви посади", () => {
    expect(deriveTags(j({ title: "Senior Backend Engineer" }))).toContain("engineering");
    expect(deriveTags(j({ title: "Developer Advocate" }))).toContain("devrel");
    expect(deriveTags(j({ title: "Head of Business Development" }))).toContain("partnerships");
  });
  it("розпізнає індустрію окремо від сфери", () => {
    const t = deriveTags(j({ title: "Solana Protocol Engineer" }));
    expect(t).toContain("web3");
    expect(t).toContain("engineering");
  });
  it("бере рівень із назви", () => {
    expect(deriveTags(j({ title: "Head of Product" }))).toContain("lead");
    expect(deriveTags(j({ title: "Junior QA Engineer" }))).toContain("junior");
  });
  it("успадковує теги від джерела", () => {
    expect(deriveTags(j({ source: "getro:858" }))).toContain("web3");
    expect(deriveTags(j({ source: "aggregator:remoteok" }))).toContain("remote");
  });
  it("ніколи не лишає порожній список", () => {
    expect(deriveTags(j({ title: "Zookeeper" })).length).toBeGreaterThan(0);
  });
});
