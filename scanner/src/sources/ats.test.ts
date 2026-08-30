import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

const asJson = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) as Response);

describe("fetchAshby", () => {
  it("бере descriptionPlain із того самого виклику", async () => {
    asJson({ jobs: [{ title: "Ops Associate", location: "Remote", isRemote: true,
      jobUrl: "https://jobs.ashbyhq.com/acme/1", publishedAt: "2026-08-01T00:00:00Z",
      descriptionPlain: "You will own the trade lifecycle." }] });
    const { fetchAshby } = await import("./ats.js");
    const jobs = await fetchAshby("acme", "Acme");
    expect(jobs[0]!.description).toBe("You will own the trade lifecycle.");
  });
});

describe("fetchLever", () => {
  it("віддає перевагу descriptionBodyPlain перед descriptionPlain", async () => {
    // openingPlain у Lever — це загальний маркетинг компанії, який не має
    // стосунку до ролі. Тіло опису точніше.
    asJson([{ text: "Android Engineer", hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { location: "Berlin" }, createdAt: 1_700_000_000_000,
      descriptionPlain: "Sell what you love.",
      descriptionBodyPlain: "You will build and evolve mobile experiences." }]);
    const { fetchLever } = await import("./ats.js");
    const jobs = await fetchLever("acme", "Acme");
    expect(jobs[0]!.description).toBe("You will build and evolve mobile experiences.");
  });

  it("додає lists: у третини вакансій це єдиний конкретний текст", async () => {
    asJson([{ text: "Android Engineer", hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { location: "Berlin" }, createdAt: 1_700_000_000_000,
      lists: [{ text: "What you'll do", content: "<li>Design, build, and evolve mobile experiences.</li>" }] }]);
    const { fetchLever } = await import("./ats.js");
    const jobs = await fetchLever("acme", "Acme");
    expect(jobs[0]!.description).toContain("Design, build, and evolve mobile experiences.");
  });

  it("лишає порожньо, коли тексту немає взагалі", async () => {
    asJson([{ text: "Android Engineer", hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { location: "Berlin" }, createdAt: 1_700_000_000_000 }]);
    const { fetchLever } = await import("./ats.js");
    const jobs = await fetchLever("acme", "Acme");
    expect(jobs[0]!.description).toBeNull();
  });
});

import { hostSlug, fetchBreezy } from "./ats.js";

describe("slug у хості", () => {
  it("звичайний slug проходить", () => expect(hostSlug("acme-corp", "breezy")).toBe("acme-corp"));
  it.each(["evil.com/x?", "a b", "", "acme.breezy.hr", "../x"])("«%s» відкидається", (s) => {
    expect(() => hostSlug(s, "breezy")).toThrow(/slug/);
  });
  it("fetchBreezy не робить запиту з поганим slug-ом", async () => {
    const fetchImpl = (async () => new Response("[]")) as unknown as typeof fetch;
    await expect(fetchBreezy("evil.com/x?", "Acme", { fetchImpl })).rejects.toThrow(/slug/);
  });
});

describe("fetchRecruitee", () => {
  // Форма відповіді знята з живого тенанта logex.recruitee.com, а не вигадана.
  const offer = (o: Record<string, unknown> = {}) => ({
    title: "Business Controller", slug: "business-controller",
    careers_url: "https://logex.recruitee.com/o/business-controller",
    location: "Amsterdam, Noord-Holland, Netherlands", city: "Amsterdam",
    country_code: "NL", remote: false, status: "published",
    published_at: "2026-08-17 13:06:10 UTC",
    department: "Finance", employment_type_code: "fulltime",
    description: "<p>You will own the reporting cycle.</p>",
    requirements: "<p>Five years in controlling.</p>", ...o });

  it("бере посилання на роботодавця, опис і вимоги разом", async () => {
    asJson({ offers: [offer()] });
    const { fetchRecruitee } = await import("./ats.js");
    const jobs = await fetchRecruitee("logex", "LOGEX");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.url).toBe("https://logex.recruitee.com/o/business-controller");
    expect(jobs[0]!.source).toBe("recruitee:logex");
    expect(jobs[0]!.location).toBe("Amsterdam, Noord-Holland, Netherlands");
    expect(jobs[0]!.team).toBe("Finance");
    // Опис і вимоги — два поля; витягові потрібні обидва.
    expect(jobs[0]!.description).toContain("reporting cycle");
    expect(jobs[0]!.description).toContain("controlling");
  });

  it("country_code НЕ стає country: інакше вакансію не побачить ніхто", async () => {
    // country означає «показувати лише своїм» і належить національним дошкам.
    // У жодної живої людини країна зараз не заповнена, тож NL сховало б рядок.
    asJson({ offers: [offer()] });
    const { fetchRecruitee } = await import("./ats.js");
    const jobs = await fetchRecruitee("logex", "LOGEX");
    expect(jobs[0]!.country).toBeUndefined();
  });

  it("чернетки й закриті позиції не беремо", async () => {
    asJson({ offers: [offer({ status: "draft" }), offer({ status: "closed" }), offer()] });
    const { fetchRecruitee } = await import("./ats.js");
    expect(await fetchRecruitee("logex", "LOGEX")).toHaveLength(1);
  });

  it("рядок без назви або без посилання пропускаємо", async () => {
    asJson({ offers: [offer({ title: "" }), offer({ careers_url: null, slug: null })] });
    const { fetchRecruitee } = await import("./ats.js");
    expect(await fetchRecruitee("logex", "LOGEX")).toEqual([]);
  });

  it("віддалену роботу впізнає і з поля, і з назви", async () => {
    asJson({ offers: [
      offer({ remote: true, location: "Amsterdam" }),
      offer({ remote: false, location: "Remote, Europe", slug: "b", careers_url: "https://logex.recruitee.com/o/b" }),
    ] });
    const { fetchRecruitee } = await import("./ats.js");
    const jobs = await fetchRecruitee("logex", "LOGEX");
    expect(jobs.map((j) => j.remote)).toEqual([true, true]);
  });

  it("порожня відповідь — це порожній список, не виняток", async () => {
    asJson({});
    const { fetchRecruitee } = await import("./ats.js");
    expect(await fetchRecruitee("logex", "LOGEX")).toEqual([]);
  });

  it("не робить запиту з поганим slug-ом", async () => {
    const fetchImpl = (async () => new Response("{}")) as unknown as typeof fetch;
    const { fetchRecruitee } = await import("./ats.js");
    await expect(fetchRecruitee("evil.com/x?", "Acme", { fetchImpl })).rejects.toThrow(/slug/);
  });
});
