import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAshby, fetchGreenhouse, fetchLever } from "./ats.js";
import { extractAts, fetchGetro } from "./getro.js";
import { fetchSpeedrunCompanyJobs, withAgentUtm } from "./speedrun.js";

/**
 * Парсери проти СПРАВЖНІХ відповідей, знятих 13.09.2026 (sources/fixtures,
 * кожен файл каже, звідки й скільки вакансій із відповіді залишено). Юніт-тести
 * на вигаданих формах уже раз пропустили вилку, загорнуту не туди
 * (speedrun, 05.09), тож тут форма та, яку віддає сервер.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

afterEach(() => vi.restoreAllMocks());

/** fetch, що на будь-яку адресу віддає файл і запам'ятовує адресу. */
function serve(name: string) {
  const urls: string[] = [];
  const body = fixture(name);
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(String(url));
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  return { urls, o: { fetchImpl: fetchImpl as unknown as typeof fetch } };
}

describe("Greenhouse з pay_transparency (Coinbase)", () => {
  it("просить вилку й читає річну, погодинну й рупії", async () => {
    const { urls, o } = serve("greenhouse-coinbase-pay.json");
    const jobs = await fetchGreenhouse("coinbase", "Coinbase", o);
    expect(urls[0]).toContain("pay_transparency=true");
    expect(jobs.map((j) => [j.salaryMin, j.salaryMax, j.salaryCurrency])).toEqual([
      [166_345, 195_700, "USD"],
      [83_200, 83_200, "USD"],          // «Hourly Rate:» 40 USD × 2080
      [2_755_300, 2_755_300, "INR"],
      [null, null, null],
    ]);
  });

  it("ATS_PAY=0 повертає старий запит", async () => {
    vi.stubEnv("ATS_PAY", "0");
    const { urls, o } = serve("greenhouse-coinbase-pay.json");
    await fetchGreenhouse("coinbase", "Coinbase", o);
    expect(urls[0]).not.toContain("pay_transparency");
    vi.unstubAllEnvs();
  });
});

describe("Ashby з includeCompensation (Kraken)", () => {
  it("бере Salary, пропускає частку й порожній бонус", async () => {
    const { urls, o } = serve("ashby-kraken-comp.json");
    const jobs = await fetchAshby("kraken.com", "Kraken", o);
    expect(urls[0]).toBe("https://api.ashbyhq.com/posting-api/job-board/kraken.com?includeCompensation=true");
    expect(jobs.map((j) => [j.salaryMin, j.salaryMax, j.salaryCurrency])).toEqual([
      [175_800, 351_600, "USD"],
      [83_400, 166_800, "USD"],
      [null, null, null],
    ]);
    expect(jobs[0]!.source).toBe("ashby:kraken.com");
  });
});

describe("Lever salaryRange (Crypto.com)", () => {
  it("річна вилка з поля, без вилки порожньо", async () => {
    const { o } = serve("lever-crypto-salary.json");
    const jobs = await fetchLever("crypto", "Crypto.com", o);
    expect(jobs.map((j) => [j.salaryMin, j.salaryMax, j.salaryCurrency])).toEqual([
      [70_000, 110_000, "USD"],
      [null, null, null],
    ]);
  });
});

describe("Getro compensation_* (колекція Coinbase Ventures)", () => {
  it("центи в річні, валюта як є, ніша з галузі організації", async () => {
    const { o } = serve("getro-1625-page.json");
    const jobs = await fetchGetro(1625, o, 1, 0);
    const byCompany = new Map(jobs.map((j) => [j.company, j]));
    expect(byCompany.get("Tactic")).toMatchObject({ salaryMin: 170_000, salaryMax: 250_000, salaryCurrency: "USD" });
    expect(byCompany.get("BVNK")).toMatchObject({ salaryMin: 25_000, salaryMax: 35_000, salaryCurrency: "EUR" });
    expect(byCompany.get("VALR")!.salaryMin).toBeNull();
    // Notion у крипто-колекції: галузь каже «не крипто», і тег не ставиться.
    expect(byCompany.get("Notion")!.inheritedTags ?? []).not.toContain("web3");
    expect(byCompany.get("Tactic")!.inheritedTags).toContain("web3");
  });

  it("з живих посилань ATS витягується там, де він публічний", async () => {
    const { o } = serve("getro-1625-page.json");
    const jobs = await fetchGetro(1625, o, 1, 0);
    expect(jobs.map((j) => extractAts(j.url))).toEqual([
      { provider: "greenhouse", slug: "taxbit" },
      { provider: "greenhouse", slug: "bvnk" },
      null,                                  // HiBob: публічного API немає
      { provider: "ashby", slug: "notion" },
    ]);
  });
});

describe("extractAts: поправки 13.09", () => {
  it("Ashby зі крапкою в слагу (Kraken)", () => {
    expect(extractAts("https://jobs.ashbyhq.com/kraken.com/0b9a1b2c-1111-2222-3333-444455556666"))
      .toEqual({ provider: "ashby", slug: "kraken.com" });
  });
  it("Ashby без хвоста", () => {
    expect(extractAts("https://jobs.ashbyhq.com/rain")).toEqual({ provider: "ashby", slug: "rain" });
  });
  it("вбудована форма Greenhouse: слаг у for=, а не «embed»", () => {
    expect(extractAts("https://boards.greenhouse.io/embed/job_app?for=coinbase&token=123"))
      .toEqual({ provider: "greenhouse", slug: "coinbase" });
  });
  it("Recruitee", () => {
    expect(extractAts("https://acme.recruitee.com/o/senior-engineer"))
      .toEqual({ provider: "recruitee", slug: "acme" });
  });
});

describe("speedrun: деталь компанії (Anchorage)", () => {
  it("ролі компанії з назвою компанії, тегом web3 і тією ж адресою, що в списку", async () => {
    const { o } = serve("speedrun-company-anchorage.json");
    const jobs = await fetchSpeedrunCompanyJobs("anchorage", "Anchorage", 400, o);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ company: "Anchorage", source: "aggregator:speedrun", inheritedTags: ["web3"] });
    expect(jobs[0]!.url).toBe(
      "https://speedrun-talent-network.com/jobs/member-of-legal-brokerage-and-trading-solutions-anchorage-efe55693" +
      "?utm_source=nextrole&utm_medium=agent");
  });

  it("вікно відсікає старші ролі", async () => {
    const { o } = serve("speedrun-company-anchorage.json");
    // У знімку ролі від 29.07 до 12.08; межа посередині лишає лише свіжу.
    const days = (Date.now() - Date.parse("2026-08-05T00:00:00Z")) / 86_400_000;
    const jobs = await fetchSpeedrunCompanyJobs("anchorage", "Anchorage", days, o);
    expect(jobs.map((j) => j.title)).toEqual(["Member of Legal, Brokerage and Trading Solutions"]);
  });

  it("адресу зі списку не чіпає", () => {
    const u = "https://speedrun-talent-network.com/jobs/x-1?utm_source=nextrole&utm_medium=agent";
    expect(withAgentUtm(u)).toBe(u);
  });
});

describe("Recruitee salary", () => {
  it("місяць множиться, порожній період із малою сумою не вигадується", async () => {
    // Форма з живої відповіді cordesconsulting.recruitee.com 13.09: сусідні
    // вакансії одного роботодавця мають і `month`, і `null`.
    const body = JSON.stringify({ offers: [
      { title: "Vertrieb A", careers_url: "https://x.recruitee.com/o/a", status: "published",
        salary: { max: null, min: "5500", period: "month", currency: "EUR" } },
      { title: "Vertrieb B", careers_url: "https://x.recruitee.com/o/b", status: "published",
        salary: { max: null, min: "4500", period: null, currency: "EUR" } },
    ] });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const { fetchRecruitee } = await import("./ats.js");
    const jobs = await fetchRecruitee("x", "X", { fetchImpl });
    expect(jobs.map((j) => [j.salaryMin, j.salaryCurrency])).toEqual([[66_000, "EUR"], [null, null]]);
  });
});
