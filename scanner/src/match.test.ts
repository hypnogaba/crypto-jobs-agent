import { describe, expect, it } from "vitest";
import { explainLocally, linksToAggregator, pickTop, scoreJob, type CandidateJob, type Profile } from "./match.js";

const p: Profile = {
  userId: "u1", spheres: ["partnerships", "devrel"], industries: ["web3"],
  seniority: "senior", remoteMode: "remote_only", location: null, salaryMin: 80_000,
};

const job = (o: Partial<CandidateJob> = {}): CandidateJob => ({
  id: "j1", company: "Acme", companyKey: "acme", title: "Partnerships Manager",
  location: "Remote", remote: true, url: "https://x.test/1",
  tags: ["partnerships", "web3", "senior"], postedAt: null,
  salaryMin: null, salaryCurrency: null, ...o });

describe("scoreJob", () => {
  it("нагороджує збіг сфери, індустрії й рівня", () => {
    expect(scoreJob(job(), p).score).toBeGreaterThan(10);
  });
  it("сильно карає onsite для того, хто хоче лише віддалено", () => {
    expect(scoreJob(job({ remote: false }), p).score)
      .toBeLessThan(scoreJob(job(), p).score - 8);
  });
  it("карає розрив у рівні", () => {
    expect(scoreJob(job({ tags: ["partnerships", "web3", "junior"] }), p).score)
      .toBeLessThan(scoreJob(job(), p).score);
  });
  it("НЕ карає вакансію без вказаної вилки", () => {
    expect(scoreJob(job({ salaryMin: null }), p).score)
      .toBe(scoreJob(job({ salaryMin: null }), p).score);
    expect(scoreJob(job({ salaryMin: 40_000 }), p).score)
      .toBeLessThan(scoreJob(job({ salaryMin: null }), p).score);
  });
  it("додає за свіжість", () => {
    const fresh = new Date().toISOString();
    expect(scoreJob(job({ postedAt: fresh }), p).score)
      .toBeGreaterThan(scoreJob(job(), p).score);
  });
});

describe("pickTop", () => {
  it("бере не більше однієї ролі на компанію", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", title: "Ecosystem Lead" }), job({ id: "c", companyKey: "other", company: "Other" })];
    const top = pickTop(jobs, p, 5);
    expect(top).toHaveLength(2);
  });
  it("викидає вакансії з нульовим або відʼємним рахунком", () => {
    const bad = job({ tags: ["sales"], remote: false });
    expect(pickTop([bad], p, 5)).toHaveLength(0);
  });
  it("обмежує розмір добірки", () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      job({ id: `j${i}`, companyKey: `c${i}`, company: `C${i}` }));
    expect(pickTop(jobs, p, 5)).toHaveLength(5);
  });
});

describe("explainLocally", () => {
  it("пише про людину, а не переказує вакансію", () => {
    const [top] = pickTop([job()], p, 1);
    const why = explainLocally(top!, p);
    expect(why).toContain("partnerships");
    expect(why).toContain("віддалено");
  });
  it("ніколи не повертає порожній рядок", () => {
    const [top] = pickTop([job({ tags: ["partnerships"] })], p, 1);
    expect(explainLocally(top!, p).length).toBeGreaterThan(5);
  });
});

describe("сфера важливіша за індустрію", () => {
  it("робота в потрібній індустрії, але чужій сфері, програє", () => {
    const rightSphere = job({ tags: ["partnerships", "senior"] });
    const rightIndustryOnly = job({ tags: ["marketing", "web3", "senior"] });
    expect(scoreJob(rightSphere, p).score).toBeGreaterThan(scoreJob(rightIndustryOnly, p).score);
  });
  it("чужа сфера дає відʼємний рахунок і не потрапляє в добірку", () => {
    expect(pickTop([job({ tags: ["marketing", "web3"] })], p, 5)).toHaveLength(0);
  });
});

describe("посилання має вести на роботодавця", () => {
  it("впізнає хости агрегаторів, включно з піддоменами", () => {
    expect(linksToAggregator("https://jobicy.com/jobs/151908-x")).toBe(true);
    expect(linksToAggregator("https://www.workingnomads.com/job/go/1/")).toBe(true);
    expect(linksToAggregator("https://himalayas.app/companies/x/jobs/y")).toBe(true);
    expect(linksToAggregator("https://job-boards.greenhouse.io/alpaca/jobs/1")).toBe(false);
    expect(linksToAggregator("https://jobs.ashbyhq.com/sanity/abc")).toBe(false);
  });

  it("не судить те, чого не розібрав", () => {
    expect(linksToAggregator("не посилання")).toBe(false);
  });

  it("викидає їх із добірки, хоч би як добре вони набрали балів", () => {
    const top = pickTop([
      job({ id: "a", companyKey: "a", url: "https://jobicy.com/jobs/1" }),
      job({ id: "b", companyKey: "b", url: "https://jobs.lever.co/finn/1" }),
    ], p);
    expect(top.map((t) => t.id)).toEqual(["b"]);
  });
});
