import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanUrl, fetchBoard, parseBoardTitle } from "./boards.js";

afterEach(() => vi.restoreAllMocks());

describe("parseBoardTitle", () => {
  // Справжні заголовки з DOU, узяті зі стрічки під час розвідки.
  it("розбирає формат DOU", () => {
    expect(parseBoardTitle("Full-Stack Python Engineer в Artkai, віддалено")).toMatchObject({
      company: "Artkai", title: "Full-Stack Python Engineer", location: null, remote: true,
    });
    expect(parseBoardTitle("Full Stack engineer (Python/React) в Web Legends, Лісабон (Португалія), віддалено")).toMatchObject({
      company: "Web Legends", title: "Full Stack engineer (Python/React)",
      location: "Лісабон (Португалія)", remote: true,
    });
  });

  it("не вважає віддаленою вакансію без такої позначки", () => {
    expect(parseBoardTitle("QA Engineer в SoftServe, Львів")).toMatchObject({
      company: "SoftServe", title: "QA Engineer", location: "Львів", remote: false,
    });
  });

  // Поділ по ПЕРШОМУ « в » дав би компанію «команду платежів».
  it("ділить по останньому « в », бо роль теж його містить", () => {
    expect(parseBoardTitle("Розробник в команду платежів в Monobank, Київ")).toMatchObject({
      company: "Monobank", title: "Розробник в команду платежів",
    });
  });

  // Живі рядки DOU: вилка стоїть у тому самому хвості, що й місто. Перша
  // перевірка на справжній стрічці дала вакансію з локацією «$1000–2000».
  it("забирає вилку із хвоста, а не кладе її в локацію", () => {
    expect(parseBoardTitle("B2B Sales Manager в UNILIME, $1000–2000, віддалено")).toMatchObject({
      company: "UNILIME", location: null, remote: true,
      salaryMin: 1000, salaryMax: 2000, salaryCurrency: "USD",
    });
    expect(parseBoardTitle("Junior Legal Councel в FLEXIFAI, $800–1200, Київ, віддалено")).toMatchObject({
      company: "FLEXIFAI", location: "Київ", salaryMin: 800, salaryMax: 1200,
    });
    expect(parseBoardTitle("Розробник в Acme, від $1500, Київ")).toMatchObject({
      salaryMin: 1500, salaryMax: null, location: "Київ",
    });
  });

  // У базі лежало п'ять таких рядків, і в усіх зарплата стояла в локації.
  // «до» — це стеля: записати її як підлогу означало б підняти людині поріг.
  it("розуміє «до» як стелю, а не підлогу", () => {
    expect(parseBoardTitle("Senior Golang Developer в Acme, до $5000")).toMatchObject({
      salaryMin: null, salaryMax: 5000, salaryCurrency: "USD", location: null,
    });
    expect(parseBoardTitle("HR-менеджер в Acme, до $900, Львів")).toMatchObject({
      salaryMin: null, salaryMax: 900, location: "Львів",
    });
    expect(parseBoardTitle("Full Stack Developer в Acme, до $3000, за кордоном")).toMatchObject({
      salaryMax: 3000, location: "за кордоном",
    });
  });

  it("не бачить зарплати там, де її немає", () => {
    expect(parseBoardTitle("QA Engineer в SoftServe, Львів")).toMatchObject({
      salaryMin: null, salaryCurrency: null,
    });
  });

  it("розуміє два формати агрегаторів", () => {
    expect(parseBoardTitle("Senior Designer at Figma")).toMatchObject({ company: "Figma", title: "Senior Designer" });
    expect(parseBoardTitle("Stripe: Backend Engineer")).toMatchObject({ company: "Stripe", title: "Backend Engineer" });
  });

  it("мовчить, коли компанії не видно", () => {
    expect(parseBoardTitle("Backend Engineer")).toBeNull();
    expect(parseBoardTitle("")).toBeNull();
    expect(parseBoardTitle("   ")).toBeNull();
  });
});

describe("cleanUrl", () => {
  // Без цього та сама вакансія з двох прогонів лягає в кеш двічі.
  it("прибирає мітки переходів", () => {
    expect(cleanUrl("https://jobs.dou.ua/companies/artkai/vacancies/371389/?utm_source=jobsrss"))
      .toBe("https://jobs.dou.ua/companies/artkai/vacancies/371389/");
  });

  it("лишає корисні параметри", () => {
    expect(cleanUrl("https://x.com/j?id=7&utm_medium=rss")).toBe("https://x.com/j?id=7");
  });

  it("не ламається на кривій адресі", () => {
    expect(cleanUrl("не адреса")).toBe("не адреса");
  });
});

import { parseBoardTitle as parseTitleGuard } from "./boards.js";

describe("захист від чужої стрічки", () => {
  it("сутність поза Unicode не валить розбір", () => {
    const p = parseTitleGuard("Python Developer&#99999999; в Acme, Київ");
    expect(p?.company).toBe("Acme");
  });
  it("довжелезний заголовок розбирається швидко", () => {
    const evil = "$" + "1 ".repeat(20_000) + "x";
    const t0 = Date.now();
    parseTitleGuard(`Роль в Компанія, ${evil}`);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe("fetchBoard", () => {
  const FEED = `<rss><channel>
    <item><title>QA Engineer в SoftServe, Львів</title>
          <link>https://dou.ua/vacancies/1/</link><pubDate>Mon, 25 Aug 2026 10:00:00 +0300</pubDate></item>
  </channel></rss>`;

  const serve = () =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(FEED, { status: 200, headers: { "content-type": "application/xml" } }) as Response);

  it("ставить країну дошки кожній вакансії", async () => {
    serve();
    const jobs = await fetchBoard(
      { name: "board:ua-dou", label: "DOU", country: "UA", feedUrl: "https://dou.ua/f", kind: "rss" });
    expect(jobs[0]!.country).toBe("UA");
  });

  /**
   * Зірочка — домовленість адмінки: «стрічка є, країни немає». Порожня країна
   * у вакансії означає «видно всім». Якби зірочка доїхала до бази як є, такі
   * вакансії не побачив би НІХТО: жодна людина не має країни «*».
   */
  it("глобальна стрічка лишає країну порожньою, а не зірочкою", async () => {
    serve();
    const jobs = await fetchBoard(
      { name: "board:global-remoteok", label: "RemoteOK", country: "*", feedUrl: "https://remoteok.com/f", kind: "rss" });
    expect(jobs[0]!.country).toBeNull();
  });
});
