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
