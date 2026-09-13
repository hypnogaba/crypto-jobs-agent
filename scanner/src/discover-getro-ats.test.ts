import { describe, expect, it } from "vitest";
import { collectionYield, discoveryTags, unionTags } from "./discover-getro-ats.js";
import { harvestAtsFromJobs } from "./rungs.js";
import type { RawJob } from "./types.js";

const job = (o: Partial<RawJob>): RawJob => ({
  url: "https://jobs.ashbyhq.com/acme/1", company: "Acme", title: "Engineer",
  location: null, remote: false, postedAt: null, source: "getro:1625", ...o });

describe("discoveryTags: ніша з галузі організації, колекція лише запас", () => {
  it("галузь організації перемагає тег колекції", () => {
    // Notion у колекції Coinbase Ventures: галузь «Productivity», не крипто.
    const [j] = discoveryTags([job({ company: "Notion", inheritedTags: ["ai"] })], ["web3"]);
    expect(j!.inheritedTags).toEqual(["ai"]);
  });
  it("організація без галузі бере тег колекції", () => {
    const [j] = discoveryTags([job({})], ["web3"]);
    expect(j!.inheritedTags).toEqual(["web3"]);
  });
  it("нетегована колекція нічого не вигадує", () => {
    const [j] = discoveryTags([job({})], []);
    expect(j!.inheritedTags).toBeUndefined();
  });
  it("збір компаній бере саме ці теги", () => {
    const found = harvestAtsFromJobs(discoveryTags([
      job({ url: "https://jobs.ashbyhq.com/notion/1", company: "Notion", inheritedTags: ["ai"] }),
      job({ url: "https://boards.greenhouse.io/taxbit/jobs/2", company: "Tactic", inheritedTags: ["web3", "fintech"] }),
    ], ["web3"]));
    expect(found.map((c) => [c.slug, c.tags])).toEqual([["notion", ["ai"]], ["taxbit", ["web3", "fintech"]]]);
  });
});

describe("unionTags: теги наявної компанії лише доповнюються", () => {
  it("не стирає поставлене руками", () => expect(unionTags(["web3"], [])).toEqual(["web3"]));
  it("додає нове без повторів", () => expect(unionTags(["web3"], ["fintech", "web3"])).toEqual(["web3", "fintech"]));
});

describe("collectionYield", () => {
  it("рахує частку вакансій з публічним ATS", () => {
    const y = collectionYield(1, [job({}), job({ url: "https://valr.careers.hibob.com/jobs/1" })],
      [{ tags: ["web3"] }]);
    expect(y).toEqual({ id: 1, jobs: 2, withAts: 1, companies: 1, web3Companies: 1 });
  });
});
