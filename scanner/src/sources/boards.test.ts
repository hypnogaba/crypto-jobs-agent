import { describe, expect, it } from "vitest";
import { cleanUrl, parseBoardTitle } from "./boards.js";

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
