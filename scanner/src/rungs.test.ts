import { describe, expect, it } from "vitest";
import { slugify, harvestAtsFromJobs } from "./rungs.js";
import type { RawJob } from "./types.js";

const j = (url: string, company = "Acme"): RawJob => ({
  url, company, title: "Engineer", location: null, remote: false, postedAt: null, source: "getro:858" });

describe("slugify", () => {
  it("прибирає юридичні суфікси й розділові", () => {
    expect(slugify("Black Semiconductor GmbH")).toBe("blacksemiconductor");
    expect(slugify("Remote.com")).toBe("remote.com".replace(/[^a-z0-9]+/g, ""));
  });
});

describe("harvestAtsFromJobs — 80% лінків Getro ведуть в ATS", () => {
  it("витягує слаг із посилань різних провайдерів", () => {
    const found = harvestAtsFromJobs([
      j("https://boards.greenhouse.io/ondofinance/jobs/4382521009", "Ondo Finance"),
      j("https://jobs.ashbyhq.com/alchemy/abc", "Alchemy"),
      j("https://jobs.lever.co/sphere-laboratories/x", "Sphere"),
      j("https://example.com/careers/1", "Нікуди"),
    ]);
    expect(found.map((f) => f.provider).sort()).toEqual(["ashby", "greenhouse", "lever"]);
    expect(found.find((f) => f.provider === "greenhouse")!.slug).toBe("ondofinance");
  });
  it("не дублює ту саму компанію", () => {
    expect(harvestAtsFromJobs([
      j("https://jobs.ashbyhq.com/alchemy/1"), j("https://jobs.ashbyhq.com/alchemy/2"),
    ])).toHaveLength(1);
  });
});
