import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanUrl, fetchBoard, isJunk, jobLinks, parseBoardTitle, parseJobPostings, parseNextPayload } from "./boards.js";

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

  // Живі заголовки з germantechjobs.de. Стрічка віддає 753 позиції, і до
  // цього правила компанією ставало «IT-Service-Performance-Spezialist:in».
  it("розбирає німецький формат «Роль @ Компанія [вилка €]»", () => {
    expect(parseBoardTitle("SAP Entwickler / Consultant (RE-FX / FI-CO) (m/w/d) @ Vonovia [60.000 - 85.000 €]"))
      .toMatchObject({
        company: "Vonovia", title: "SAP Entwickler / Consultant (RE-FX / FI-CO) (m/w/d)",
        salaryMin: 60000, salaryMax: 85000, salaryCurrency: "EUR",
      });
    // Крапка в німецькому числі — роздільник тисяч. «31.500» це не 31,5.
    expect(parseBoardTitle("Cloud Data Architect AWS (all genders) - Düsseldorf @ adesso SE [31.500 - 52.500 €]"))
      .toMatchObject({ company: "adesso SE", salaryMin: 31500, salaryMax: 52500 });
    // Довга назва компанії з комами всередині — не привід ділити її далі.
    expect(parseBoardTitle("Linux Systems Engineer (m/w/d) @ Lürssen Werft Bremen GmbH & Co. KG [55.000 - 85.000 €]"))
      .toMatchObject({ company: "Lürssen Werft Bremen GmbH & Co. KG" });
  });

  it("розбирає формат «Роль job by Компанія | Місто | Дошка»", () => {
    expect(parseBoardTitle("Senior Product Manager job by Bolt | Remote: Worldwide | Remotech"))
      .toMatchObject({ company: "Bolt", title: "Senior Product Manager", location: null, remote: true });
    expect(parseBoardTitle("Senior Data Engineer - Global Team (India) job by YipitData | India Remote | Remotech"))
      .toMatchObject({ company: "YipitData", title: "Senior Data Engineer - Global Team (India)",
                       location: "India Remote", remote: true });
  });

  // WeLoveProduct дописує «job» до кожної назви посади.
  it("не лишає службове «job» у назві посади", () => {
    expect(parseBoardTitle("Product Manager, Multi-Cloud Trust & Safety job at Anthropic"))
      .toMatchObject({ company: "Anthropic", title: "Product Manager, Multi-Cloud Trust & Safety" });
  });

  // Живий рядок Remote3. Поділ по ПЕРШОМУ « at » давав компанію
  // «Bybit at Bybit» — п'ять таких рядків лежали в кеші.
  it("ділить по останньому « at » і не лишає компанію в назві двічі", () => {
    expect(parseBoardTitle("Job Application for P2P BD Assistant at Bybit at Bybit"))
      .toMatchObject({ company: "Bybit", title: "Job Application for P2P BD Assistant" });
  });

  it("мовчить, коли компанії не видно", () => {
    expect(parseBoardTitle("Backend Engineer")).toBeNull();
    expect(parseBoardTitle("")).toBeNull();
    expect(parseBoardTitle("   ")).toBeNull();
  });
});

describe("isJunk", () => {
  // Усі приклади — зі справжньої стрічки https://remote3.co/api/rss,
  // і два перші лежали в живому кеші, видимі людині.
  it("впізнає службові записи чужої дошки", () => {
    expect(isJunk("__probe_job__ at undefined", "https://remote3.co/remote-jobs/null")).toBe(true);
    expect(isJunk("__repro2_job__ at undefined", "")).toBe(true);
    expect(isJunk("__xsschain_job__ at __xsschain__", "")).toBe(true);
    expect(isJunk("undefined", "")).toBe(true);
    expect(isJunk("", "")).toBe(true);
  });

  it("впізнає посилання в нікуди", () => {
    expect(isJunk("Backend Engineer at Acme", "https://remote3.co/remote-jobs/null")).toBe(true);
  });

  it("не чіпає справжні вакансії", () => {
    expect(isJunk("Senior Designer at Figma", "https://figma.com/jobs/1")).toBe(false);
    expect(isJunk("Розробник в Acme, Київ", "https://jobs.dou.ua/1")).toBe(false);
    // Подвійне підкреслення всередині назви — не привід викидати рядок.
    expect(isJunk("C++ Engineer (__init__ maintainer) at Acme", "https://acme.com/1")).toBe(false);
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

describe("parseJobPostings", () => {
  const wrap = (obj: unknown) =>
    `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
  const posting = (extra: Record<string, unknown> = {}) => ({
    "@type": "JobPosting", title: "Office Manager",
    hiringOrganization: { "@type": "Organization", name: "Ellipsis Labs" },
    datePosted: "2026-08-29", ...extra,
  });

  /**
   * Справжня розмітка з web3.career: свого `url` у JobPosting немає ЖОДНОГО
   * разу — ні на восьми перевірених дошках, ні на сторінці окремої вакансії.
   * Там адреса відома інакше: вакансія і є ця сторінка.
   */
  it("бере адресу сторінки, коли розмітка своєї не має", () => {
    const jobs = parseJobPostings(wrap(posting()), "board:x", null,
      "https://web3.career/office-manager-ellipsislabs/153443");
    expect(jobs[0]!.url).toBe("https://web3.career/office-manager-ellipsislabs/153443");
    expect(jobs[0]!.company).toBe("Ellipsis Labs");
  });

  /**
   * Жива суперечність: web3.career ставить TELECOMMUTE геть усьому, разом із
   * конкретною адресою в Нью-Йорку.
   */
  it("вірить конкретному місту, а не прапорцю TELECOMMUTE", () => {
    const jobs = parseJobPostings(wrap(posting({
      jobLocationType: "TELECOMMUTE",
      jobLocation: { address: { addressLocality: "New York", addressRegion: "NY",
                                addressCountry: "United States" } },
    })), "board:x", null, "https://x/1");
    expect(jobs[0]!.location).toBe("New York, NY, United States");
    expect(jobs[0]!.remote).toBe(false);
  });

  it("без міста прапорець лишається єдиним свідченням", () => {
    expect(parseJobPostings(wrap(posting({ jobLocationType: "TELECOMMUTE" })),
      "board:x", null, "https://x/1")[0]!.remote).toBe(true);
  });

  it("один зіпсований блок не валить решту сторінки", () => {
    const html = `<script type="application/ld+json">{зіпсовано,}</script>` + wrap(posting());
    expect(parseJobPostings(html, "board:x", null, "https://x/1")).toHaveLength(1);
  });

  it("вакансію без адреси взагалі не бере — людину нікуди вести", () => {
    expect(parseJobPostings(wrap(posting()), "board:x", null)).toHaveLength(0);
  });
});

describe("jobLinks", () => {
  it("бере лише свій домен і числовий хвіст", () => {
    const html = `
      <a href="/office-manager-ellipsislabs/153443">a</a>
      <a href="/about">про нас</a>
      <a href="/pricing">ціни</a>
      <a href="https://twitter.com/other-board/12345">чужий</a>`;
    expect(jobLinks(html, "https://web3.career/")).toEqual(
      ["https://web3.career/office-manager-ellipsislabs/153443"]);
  });
});

describe("parseNextPayload", () => {
  /** Так шле сторінку Next.js: рядки JS із екранованим вмістом. */
  const stream = (...objs: unknown[]) => objs
    .map((o) => `self.__next_f.push([1,"${JSON.stringify(JSON.stringify(o)).slice(1, -1)}"])`)
    .join("\n");

  /** Справжня форма запису jobstash.xyz, скорочена. */
  const job = {
    id: "ZhNDJw", title: "Software Engineer C++",
    href: "/software-engineer-c-akuna-capital/ZhNDJw",
    location: "Sydney", locationType: "ONSITE",
    addresses: [{ country: "Australia", countryCode: "AU", isRemote: false, locality: "Sydney" }],
    organization: { name: "Akuna Capital", websiteUrl: "https://akunacapital.com/" },
    summary: "Design and build complex trading systems.", datePosted: "2026-08-30T09:00:00Z",
  };

  it("витягує вакансію з потоку й робить адресу повною", () => {
    const jobs = parseNextPayload(stream(job), "board:x", null, "https://jobstash.xyz/");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      url: "https://jobstash.xyz/software-engineer-c-akuna-capital/ZhNDJw",
      company: "Akuna Capital", title: "Software Engineer C++",
      location: "Sydney", remote: false,
    });
  });

  it("вірить прапорцю isRemote у самій адресі", () => {
    const remote = { ...job, addresses: [{ country: "Germany", isRemote: true, locality: "" }],
                     location: "Remote, Germany" };
    expect(parseNextPayload(stream(remote), "board:x", null, "https://x/")[0]!.remote).toBe(true);
  });

  /**
   * Запис без компанії пропускаємо: підбір і дедуплікація тримаються на парі
   * «компанія + роль», тож половина запису гірша за його відсутність.
   */
  it("не бере запис без компанії", () => {
    const { organization: _drop, ...bare } = job;
    expect(parseNextPayload(stream(bare), "board:x", null, "https://x/")).toHaveLength(0);
  });

  it("один і той самий запис двічі не подвоюється", () => {
    expect(parseNextPayload(stream(job, job), "board:x", null, "https://x/")).toHaveLength(1);
  });

  /**
   * Дужка всередині тексту вакансії не має обривати запис — саме тому пошук
   * закривної дужки пропускає рядки цілком.
   */
  it("дужка в тексті опису не ламає розбір", () => {
    const tricky = { ...job, summary: "Ми шукаємо { того, хто } любить C++ }{" };
    const jobs = parseNextPayload(stream(tricky), "board:x", null, "https://x/");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.description).toContain("любить C++");
  });

  it("сторінка без потоку Next.js дає порожній список, а не помилку", () => {
    expect(parseNextPayload("<html><body>нічого</body></html>", "board:x", null, "https://x/"))
      .toEqual([]);
  });
});

describe("розбір списку web3.career", () => {
  const wrap = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const post = (title: string, org: string, extra: Record<string, unknown> = {}) => ({
    "@type": "JobPosting", title,
    hiringOrganization: { "@type": "Organization", name: org },
    datePosted: "2026-08-29", ...extra,
  });
  const link = (path: string) => `<a href="${path}">x</a>`;

  /**
   * Живий випадок: розмітка в списку адрес не має, але адреса складається з
   * назви вакансії та компанії. Зшивання за слагом дає повну вакансію без
   * ЖОДНОГО додаткового запиту — сторінка коштує один запит замість вісімнадцяти.
   */
  it("зшиває розмітку з посиланням за слагом", async () => {
    const html = wrap(post("Investment Analyst", "Kakao Ventures"))
               + link("/investment-analyst-kakao-ventures/153281");
    const jobs = await fetchBoard(
      { name: "b", label: "L", country: "*", feedUrl: "https://web3.career/", kind: "jsonld" },
      { fetchImpl: async () => new Response(html, { status: 200 }) });
    expect(jobs[0]).toMatchObject({
      url: "https://web3.career/investment-analyst-kakao-ventures/153281",
      company: "Kakao Ventures", title: "Investment Analyst",
    });
  });

  /**
   * Дві вакансії з однаковою назвою в різних компаній — саме тому правило
   * вимагає збігу И назви, И компанії. Інакше людина пішла б за чужим
   * посиланням.
   */
  it("не плутає однакові назви в різних компаній", async () => {
    const html = wrap(post("Founding Engineer", "Ihsan")) + wrap(post("Founding Engineer", "Fomo"))
               + link("/founding-engineer-ihsan/1111") + link("/founding-engineer-fomo/2222");
    const jobs = await fetchBoard(
      { name: "b", label: "L", country: "*", feedUrl: "https://web3.career/", kind: "jsonld" },
      { fetchImpl: async () => new Response(html, { status: 200 }) });
    const byCompany = Object.fromEntries(jobs.map((j) => [j.company, j.url]));
    expect(byCompany["Ihsan"]).toContain("founding-engineer-ihsan");
    expect(byCompany["Fomo"]).toContain("founding-engineer-fomo");
  });

  /** У живих назвах трапляється «&amp;», а в адресі його немає взагалі. */
  it("зшиває назву із сутністю HTML", async () => {
    const html = wrap(post("Payments Engineer &amp; Backend", "Ihsan"))
               + link("/payments-engineer-backend-ihsan/153410");
    const jobs = await fetchBoard(
      { name: "b", label: "L", country: "*", feedUrl: "https://web3.career/", kind: "jsonld" },
      { fetchImpl: async () => new Response(html, { status: 200 }) });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.title).toBe("Payments Engineer & Backend");
  });

  it("бере річну вилку й ігнорує погодинну", async () => {
    const yearly = { baseSalary: { "@type": "MonetaryAmount", currency: "USD",
      value: { minValue: 135050, maxValue: 300000, unitText: "YEAR" } } };
    const hourly = { baseSalary: { "@type": "MonetaryAmount", currency: "USD",
      value: { minValue: 45, maxValue: 70, unitText: "HOUR" } } };
    const html = wrap(post("Analyst", "Ondo", yearly)) + link("/analyst-ondo/1001")
               + wrap(post("Designer", "Fomo", hourly)) + link("/designer-fomo/1002");
    const jobs = await fetchBoard(
      { name: "b", label: "L", country: "*", feedUrl: "https://web3.career/", kind: "jsonld" },
      { fetchImpl: async () => new Response(html, { status: 200 }) });
    const a = jobs.find((j) => j.title === "Analyst")!;
    const d = jobs.find((j) => j.title === "Designer")!;
    expect(a).toMatchObject({ salaryMin: 135050, salaryMax: 300000, salaryCurrency: "USD" });
    expect(d.salaryMin ?? null).toBeNull();
  });
});

describe("період зарплати на дошці", () => {
  const feed = (title: string) => `<rss><channel><item>
      <title>${title}</title><link>https://jobs.dou.ua/vacancies/1234/</link>
      <pubDate>Fri, 29 Aug 2026 10:00:00 +0300</pubDate></item></channel></rss>`;
  const serve = (xml: string) =>
    ({ fetchImpl: async () => new Response(xml, { status: 200 }) });

  /**
   * Живий заголовок DOU. Суми там місячні — 350–4500 у кеші проти
   * 12 000–163 000 у німецької дошки, — але в заголовку про це ні слова.
   */
  it("місячну суму дошки зводить до річної", async () => {
    const jobs = await fetchBoard(
      { name: "board:dou-python", label: "DOU", country: "UA",
        feedUrl: "https://jobs.dou.ua/f", kind: "rss", salaryPeriod: "month" },
      serve(feed("Lead Python Developer в Motorsport Network, $2000–3000, віддалено")));
    expect(jobs[0]).toMatchObject({ salaryMin: 24000, salaryMax: 36000 });
  });

  /** Замовчування «рік» означає «нічого не змінюється». */
  it("річну лишає як є", async () => {
    const jobs = await fetchBoard(
      { name: "board:de-x", label: "X", country: "DE",
        feedUrl: "https://x.de/f", kind: "rss" },
      serve(feed("Backend Engineer в Acme, $90000–120000, Берлін")));
    expect(jobs[0]).toMatchObject({ salaryMin: 90000, salaryMax: 120000 });
  });

  /**
   * Помножена нісенітниця лишається нісенітницею: 25 мільйонів на рік
   * з'їдають увесь верх сортування за зарплатою.
   */
  it("суму поза межами здорового глузду не бере взагалі", async () => {
    const jobs = await fetchBoard(
      { name: "board:x", label: "X", country: "*",
        feedUrl: "https://x.com/f", kind: "rss", salaryPeriod: "month" },
      serve(feed("Engineer в Acme, $9000000, віддалено")));
    expect(jobs[0]!.salaryMin).toBeNull();
  });
});
