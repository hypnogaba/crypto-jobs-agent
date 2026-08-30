import { describe, expect, it } from "vitest";
import { atsApi, atsListInPage, boardName, classify, countJobs, countryOf, feedInPage, labelOf, tidy } from "./source-link.js";

describe("tidy", () => {
  it("додає схему, бо люди копіюють домен без неї", () => {
    expect(tidy("dou.ua/vacancies/")).toBe("https://dou.ua/vacancies/");
  });

  it("зрізає лапки й кому, з якими адреса приїжджає з листа", () => {
    expect(tidy('"https://jobs.lever.co/deel",')).toBe("https://jobs.lever.co/deel");
  });

  it("відкидає те, що адресою не є", () => {
    expect(tidy("додай будь ласка ще джерел")).toBeNull();
    expect(tidy("")).toBeNull();
  });
});

describe("classify", () => {
  it("упізнає ATS і слаг компанії", () => {
    expect(classify("https://boards.greenhouse.io/deepl")).toMatchObject(
      { kind: "ats", provider: "greenhouse", slug: "deepl" });
    expect(classify("https://jobs.ashbyhq.com/Ramp/abc-123")).toMatchObject(
      { kind: "ats", provider: "ashby", slug: "ramp" });
    expect(classify("https://acme.breezy.hr/p/xyz")).toMatchObject(
      { kind: "ats", provider: "breezy", slug: "acme" });
  });

  /**
   * Половина мертвих джерел у базі — це службові хвости, взяті за назву
   * компанії. Компанія «embed» опитувалась би щодня й ніколи нічого не дала б.
   */
  it("не бере службовий хвіст за компанію", () => {
    expect(classify("https://boards.greenhouse.io/embed/job_board?for=deepl")?.kind).toBe("page");
  });

  it("вакансія на ATS глобальна, навіть коли домен національний", () => {
    // Компанія у Франції на Greenhouse наймає не лише французів.
    expect(classify("https://jobs.lever.co/qonto")?.country).toBe("*");
  });

  it("бачить стрічку за адресою", () => {
    expect(classify("https://dou.ua/vacancies/feeds/?category=Python")?.kind).toBe("feed");
    expect(classify("https://weworkremotely.com/remote-jobs.rss")?.kind).toBe("feed");
    expect(classify("https://jobspresso.co/?feed=job_feed")?.kind).toBe("feed");
  });

  it("решта — просто сторінка, яку доведеться відкрити", () => {
    expect(classify("https://stripe.com/jobs")?.kind).toBe("page");
  });
});

describe("countryOf", () => {
  it("бере країну з однозначного ccTLD", () => {
    expect(countryOf("https://dou.ua/vacancies/")).toBe("UA");
    expect(countryOf("https://www.apec.fr/candidat")).toBe("FR");
  });

  it("знає дошки, чия країна не написана в домені", () => {
    expect(countryOf("https://djinni.co/jobs/")).toBe("UA");
    expect(countryOf("https://justjoin.it/api/offers")).toBe("PL");
  });

  /**
   * Країна у вакансії означає «показувати ЛИШЕ звідти». Помилковий здогад
   * ховає джерело від усіх; порожній — лише показує всім.
   */
  it("не вважає .io та .co країнами", () => {
    expect(countryOf("https://remoteok.com/api")).toBe("*");
    expect(countryOf("https://cryptocurrencyjobs.co/index.xml")).toBe("*");
  });
});

describe("countJobs", () => {
  it("рахує елементи RSS і Atom", () => {
    expect(countJobs("<rss><item><title>a</title></item><item/></rss>")).toBe(2);
    expect(countJobs("<feed><entry/><entry/><entry/></feed>")).toBe(3);
  });

  it("рахує масив на будь-якому зі звичних ключів", () => {
    expect(countJobs('{"jobs":[{"a":1},{"a":2}]}')).toBe(2);
    expect(countJobs('{"content":[{"a":1}]}')).toBe(1);
    expect(countJobs("[{},{},{}]")).toBe(3);
  });

  it("порожня відповідь — це нуль, а не помилка", () => {
    expect(countJobs('{"jobs":[]}')).toBe(0);
    expect(countJobs("<html><body>Not found</body></html>")).toBe(0);
    expect(countJobs("")).toBe(0);
  });
});

describe("feedInPage", () => {
  it("знаходить стрічку, яку сторінка оголошує сама", () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="/vacancies/feeds/"></head>`;
    expect(feedInPage(html, "https://dou.ua/vacancies/")).toBe("https://dou.ua/vacancies/feeds/");
  });

  it("ігнорує alternate, який не є стрічкою", () => {
    const html = `<link rel="alternate" hreflang="fr" href="/fr/">`;
    expect(feedInPage(html, "https://x.com/")).toBeNull();
  });

  /**
   * На живій сторінці DOU оголошеного тега немає взагалі — стрічка стоїть у
   * футері звичайним посиланням. Правило «тільки <link rel=alternate>»
   * ламалось би саме на нашій найбільшій дошці.
   */
  it("знаходить стрічку у звичайному посиланні, коли тега немає", () => {
    const html = `<footer><a href="https://jobs.dou.ua/vacancies/feeds/">RSS</a></footer>`;
    expect(feedInPage(html, "https://jobs.dou.ua/")).toBe("https://jobs.dou.ua/vacancies/feeds/");
  });

  /**
   * Живий випадок: cryptocurrencyjobs.co пише тег без лапок —
   * `<link rel=alternate href=/index.xml ...>`. Вимога лапок ховала від нас
   * стрічку, яку сканер і так читає.
   */
  it("читає тег без лапок навколо атрибутів", () => {
    const html = `<link rel=alternate href=/index.xml type=application/rss+xml title="Cryptocurrency Jobs">`;
    expect(feedInPage(html, "https://cryptocurrencyjobs.co/"))
      .toBe("https://cryptocurrencyjobs.co/index.xml");
  });

  it("не бере чужу стрічку з чужого домену", () => {
    const html = `<a href="https://someoneelse.com/feed/">Their RSS</a>`;
    expect(feedInPage(html, "https://jobs.dou.ua/")).toBeNull();
  });
});

describe("atsListInPage", () => {
  it("витягує ATS зі сторінки «Careers»", () => {
    const html = `<a href="https://job-boards.greenhouse.io/monzo/jobs/1">Open roles</a>`;
    expect(atsListInPage(html)).toEqual([{ provider: "greenhouse", slug: "monzo" }]);
  });

  /**
   * Живий випадок, на якому попередня версія помилилась: cryptojobslist.com —
   * агрегатор, і ми мовчки підписались на випадкову компанію з його оголошень.
   * Кількість і є відповіддю: одна — «Careers», кілька — дошка компаній.
   */
  it("віддає ВСІ компанії дошки, а не першу-ліпшу", () => {
    const html = `
      <a href="https://jobs.ashbyhq.com/Coinflow/1">a</a>
      <a href="https://jobs.lever.co/ondofinance/2">b</a>
      <a href="https://boards.greenhouse.io/nansen/3">c</a>
      <a href="https://jobs.ashbyhq.com/Coinflow/4">повтор</a>`;
    expect(atsListInPage(html)).toHaveLength(3);
  });

  it("не бере службовий хвіст за компанію", () => {
    expect(atsListInPage(`<a href="https://boards.greenhouse.io/embed/job_board?for=x">e</a>`))
      .toEqual([]);
  });
});

describe("labelOf", () => {
  /**
   * Живий заголовок стрічки DOU — «Вакансії в категорії Python на DOU.ua».
   * Мітка мусить лишитись міткою: адмінка групує дошки за тим, що стоїть до
   * « · », тож речення в цьому полі зробило б із кожної рубрики окрему дошку.
   */
  it("бере бренд із домену, а рубрику — із запиту", () => {
    expect(labelOf("https://jobs.dou.ua/vacancies/feeds/?category=Python", "jobs.dou.ua"))
      .toBe("DOU · Python");
  });

  it("без рубрики лишається сам бренд", () => {
    expect(labelOf("https://weworkremotely.com/remote-jobs.rss", "weworkremotely.com"))
      .toBe("Weworkremotely");
  });

  it("не бере за рубрику номер сторінки чи речення", () => {
    expect(labelOf("https://jobs.dou.ua/f?category=2", "jobs.dou.ua")).toBe("DOU");
    expect(labelOf("https://x.fr/f?q=je+cherche+un+emploi+a+paris", "x.fr")).toBe("X");
  });
});

describe("boardName", () => {
  it("глобальна стрічка не прикидається країною", () => {
    expect(boardName("*", "RemoteOK")).toBe("board:global-remoteok");
    expect(boardName("UA", "DOU")).toBe("board:ua-dou");
  });
});

describe("atsApi", () => {
  it("веде на той самий відкритий API, що читає сканер", () => {
    expect(atsApi("greenhouse", "deepl")).toContain("boards-api.greenhouse.io/v1/boards/deepl");
    expect(atsApi("lever", "deel")).toContain("api.lever.co/v0/postings/deel");
  });
});
