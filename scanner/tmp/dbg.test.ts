import { describe, expect, it } from "vitest";
import { pickTop, inCountries, type CandidateJob, type Profile } from "../src/match.js";
const p: Profile = { userId: "u1", spheres: ["partnerships","devrel"], industries: ["web3"],
  remoteMode: "remote_only", location: null, salaryMin: 80_000 } as Profile;
const job = (o: Partial<CandidateJob> = {}): CandidateJob => ({
  id: "j1", company: "Acme", companyKey: "acme", title: "Partnerships Manager",
  location: "Remote", remote: true, url: "https://x.test/1",
  tags: ["partnerships","web3","senior"], postedAt: null,
  salaryMin: null, salaryCurrency: null, ...o } as CandidateJob);
describe("dbg", () => { it("x", () => {
  const fr = { ...p, country: "FR" } as Profile;
  const paris = job({ id: "p1", companyKey: "fr-1", company: "FR 1", location: "Paris, France", postedAt: "2026-01-01T00:00:00Z" });
  console.log("inCountries:", inCountries(paris, ["FR"]));
  const jobs = [...Array.from({length:8},(_,i)=>job({id:`g${i}`,companyKey:`gl-${i}`,company:`G${i}`,postedAt:new Date().toISOString()})), paris];
  console.log(pickTop(jobs, fr, 5).map(j=>`${j.id}:${j.score}`));
  expect(1).toBe(1);
}); });
