import { describe, expect, it } from "vitest";
import { slugify, harvestAtsFromJobs, isAggregatorBrand } from "./rungs.js";
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


describe("агрегатор — не роботодавець", () => {
  it("впізнає бренди агрегаторів за назвою й за слагом", () => {
    expect(isAggregatorBrand("Jobgether")).toBe(true);
    expect(isAggregatorBrand("jobgether")).toBe(true);
    expect(isAggregatorBrand("We Work Remotely")).toBe(true);
    expect(isAggregatorBrand("Anthropic")).toBe(false);
    expect(isAggregatorBrand("SpaceX")).toBe(false);
  });

  it("не бере агрегатор за компанію навіть із живого ATS-лінка", () => {
    // Саме це й сталось: у Jobgether є справжня дошка на Lever, тож збір
    // ATS-лінків узяв її за роботодавця, і одна «компанія» дала 1774 вакансії.
    const found = harvestAtsFromJobs([
      j("https://jobs.lever.co/jobgether/abc", "Jobgether"),
      j("https://jobs.lever.co/finn/xyz", "FINN"),
    ]);
    expect(found.map((f) => f.slug)).toEqual(["finn"]);
  });
});
