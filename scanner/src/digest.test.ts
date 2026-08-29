import { describe, expect, it } from "vitest";
import { parseArgs } from "./digest.js";

describe("parseArgs", () => {
  it("без прапорців не звужує добірку ні до кого", () => {
    // Саме тут ховалась поломка: argv.indexOf("--user") дає −1, і наївне
    // argv[i + 1] повертало argv[0] — шлях до node. Значення непорожнє, тож
    // кожен плановий прогін шукав користувача з id '/usr/local/bin/node'.
    expect(parseArgs([])).toEqual({ force: false, onlyUser: null });
  });

  it("--force сам по собі не робить із чогось onlyUser", () => {
    expect(parseArgs(["--force"])).toEqual({ force: true, onlyUser: null });
  });

  it("читає --user, коли він справді є", () => {
    expect(parseArgs(["--user", "u1"])).toEqual({ force: false, onlyUser: "u1" });
    expect(parseArgs(["--force", "--user", "u1"])).toEqual({ force: true, onlyUser: "u1" });
  });

  it("--user без значення не вигадує його", () => {
    expect(parseArgs(["--user"])).toEqual({ force: false, onlyUser: null });
  });
});

// ── Лінивий добір опису ───────────────────────────────────────
import { fillMissingSummaries } from "./digest.js";
import { vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("fillMissingSummaries", () => {
  it("не ходить у мережу, коли опис уже є", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const out = await fillMissingSummaries([
      { id: "1", url: "https://boards.greenhouse.io/acme/jobs/7", company: "Acme", summary: "Already here." },
    ]);
    expect(f).not.toHaveBeenCalled();
    expect(out.get("1")).toBe("Already here.");
  });

  it("довантажує Greenhouse поштучно і робить витяг", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        content: "&lt;p&gt;You will own the ACATS transfer workflow across our partner ecosystem every day.&lt;/p&gt;",
      }), { status: 200 }) as Response);
    const out = await fillMissingSummaries([
      { id: "1", url: "https://boards.greenhouse.io/acme/jobs/7", company: "Acme", summary: null },
    ]);
    expect(out.get("1")).toMatch(/^You will own the ACATS/);
    expect(out.get("1")).not.toMatch(/[<>]/);
  });

  it("мовчки лишає порожньо, коли джерело впало", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const out = await fillMissingSummaries([
      { id: "1", url: "https://boards.greenhouse.io/acme/jobs/7", company: "Acme", summary: null },
    ]);
    expect(out.get("1")).toBeUndefined();
  });

  it("Rippling: бере опис із поштучного виклику", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      // Rippling віддає description об'єктом { company, role }, не рядком.
      new Response(JSON.stringify({
        description: {
          company: "Perle is a fast-growing global leader trusted by customers around the world.",
          role: "<p>You will own the localisation pipeline for our partner network every day.</p>",
        },
      }), { status: 200 }) as Response);
    const out = await fillMissingSummaries([
      { id: "1", url: "https://ats.rippling.com/perle/jobs/ecee9768-c116-44e7-9b60-4afe0945687f",
        company: "Perle", summary: null },
    ]);
    expect(out.get("1")).toMatch(/^You will own the localisation/);
    expect(out.get("1")).not.toMatch(/fast-growing global leader/);
  });

  it("SmartRecruiters: бере jobDescription, а не блурб компанії", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        jobAd: { sections: {
          companyDescription: { text: "Savant is a fast-growing global leader trusted by customers around the world." },
          jobDescription: { text: "In this role you will run the analytics platform and its data contracts." },
        } },
      }), { status: 200 }) as Response);
    const out = await fillMissingSummaries([
      { id: "1", url: "https://jobs.smartrecruiters.com/savant1/744000012345678",
        company: "Savant", summary: null },
    ]);
    expect(out.get("1")).toMatch(/^In this role you will run the analytics/);
    expect(out.get("1")).not.toMatch(/fast-growing global leader/);
  });

  it("не чіпає джерела, з яких поштучно не візьмеш", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const out = await fillMissingSummaries([
      { id: "1", url: "https://jobs.ashbyhq.com/acme/uuid", company: "Acme", summary: null },
    ]);
    expect(f).not.toHaveBeenCalled();
    expect(out.size).toBe(0);
  });
});

// ── Доставка в Telegram ───────────────────────────────────────
import { clampSummary, fitTelegram, formatDigest, isBlocked, sendTelegram, TELEGRAM_MAX, describeError } from "./digest.js";

describe("sendTelegram", () => {
  it("обрив мережі — це false, а не виняток на весь прогін", async () => {
    const f = vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), { cause: new Error("ECONNRESET") }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendTelegram("t", "123456789", "hi", "d1", "en", f as never))
      .resolves.toEqual({ ok: false, status: null });
  });

  it("403 від Telegram — false і статус, щоб розпізнати блокування", async () => {
    const f = vi.fn().mockResolvedValue(new Response("Forbidden: bot was blocked", { status: 403 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await sendTelegram("t", "123456789", "hi", "d1", "en", f as never);
    expect(r).toEqual({ ok: false, status: 403 });
    expect(isBlocked(r)).toBe(true);
    expect(isBlocked({ ok: false, status: 500 })).toBe(false);
    expect(isBlocked({ ok: false, status: null })).toBe(false);
  });

  it("200 OK — true, і текст не довший за 4096", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const long = "x".repeat(TELEGRAM_MAX + 500);
    await expect(sendTelegram("t", "123456789", long, "d1", "en", f as never)).resolves.toEqual({ ok: true, status: 200 });
    const body = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as { text: string };
    expect(body.text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
  });
});

describe("describeError", () => {
  it("витягує причину з e.cause", () => {
    expect(describeError(Object.assign(new Error("fetch failed"), { cause: new Error("ENOTFOUND") })))
      .toBe("fetch failed (ENOTFOUND)");
    expect(describeError(new Error("plain"))).toBe("plain");
  });
});

describe("стеля 4096", () => {
  const job = (i: number, summary: string) => ({
    id: `j${i}`, company: `Company ${i}`, companyKey: `c${i}`, title: "Senior Engineer",
    location: "Paris", remote: true, url: `https://x.test/${i}`, tags: [], postedAt: null,
    salaryMin: null, salaryCurrency: null, why: "why", summary });

  it("clampSummary ріже по слову і ставить трикрапку", () => {
    expect(clampSummary("short")).toBe("short");
    expect(clampSummary(null)).toBeNull();
    const cut = clampSummary("word ".repeat(300), 100)!;
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("п'ять довгих описів усе одно влазять у повідомлення", () => {
    const jobs = Array.from({ length: 5 }, (_, i) => job(i, "lorem ipsum ".repeat(120)));
    const text = formatDigest(jobs, { jobs: 12_345, companies: 678 }, "uk");
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    expect(fitTelegram(text)).toBe(text);
  });

  it("fitTelegram — останній запобіжник", () => {
    expect(fitTelegram("a".repeat(5000)).length).toBe(TELEGRAM_MAX);
  });
});

// ── Розклад і відкладені добірки ─────────────────────────────
import { hadDigestToday, isDue, localDate, parseDbTime, pendingIsStale } from "./digest.js";

describe("isDue", () => {
  // 2026-08-29T07:30Z = 09:30 у Парижі, 10:30 у Києві
  const now = new Date("2026-08-29T07:30:00Z");
  const paris = { timezone: "Europe/Paris", delivery_hour: 9 };

  it("рівно в обрану годину — завжди", () => {
    expect(isDue(paris, now, false)).toBe(true);
    expect(isDue(paris, now, true)).toBe(true);
  });
  it("пізніше того ж дня — лише якщо добірки сьогодні ще не було", () => {
    const kyiv = { timezone: "Europe/Kyiv", delivery_hour: 9 };
    expect(isDue(kyiv, now, false)).toBe(true);
    expect(isDue(kyiv, now, true)).toBe(false);
  });
  it("до обраної години — ніколи", () => {
    expect(isDue({ timezone: "Europe/Paris", delivery_hour: 12 }, now, false)).toBe(false);
  });
});

describe("hadDigestToday", () => {
  const now = new Date("2026-08-29T07:30:00Z");
  it("читає час D1 без літери Z як UTC", () => {
    expect(parseDbTime("2026-08-29 06:00:00").toISOString()).toBe("2026-08-29T06:00:00.000Z");
  });
  it("дата рахується в поясі людини, а не в UTC", () => {
    // 2026-08-28 23:30Z — це вже 29-те в Києві, але ще 28-ме за UTC
    expect(hadDigestToday("Europe/Kyiv", now, ["2026-08-28 23:30:00"])).toBe(true);
    expect(hadDigestToday("UTC", now, ["2026-08-28 23:30:00"])).toBe(false);
    expect(hadDigestToday("Europe/Kyiv", now, [])).toBe(false);
  });
  it("localDate переживає невідомий пояс", () => {
    expect(localDate("Mars/Olympus", now)).toBe("2026-08-29");
  });
});

describe("pendingIsStale", () => {
  const now = new Date("2026-08-29T07:30:00Z");
  it("свіжий pending ще дотискаємо", () => {
    expect(pendingIsStale("2026-08-28 09:00:00", now)).toBe(false);
  });
  it("старший за два дні — здаємось", () => {
    expect(pendingIsStale("2026-08-26 09:00:00", now)).toBe(true);
  });
});

// ── Порядок кроків deliverTo ─────────────────────────────────
import { deliverTo, type RunContext, type UserRow } from "./digest.js";

/** Мінімальна підробка D1: відповідає за фрагментом SQL, пам'ятає execute. */
function fakeD1(answers: Array<[RegExp, unknown[]]>) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    d1: {
      query: async (sql: string) => answers.find(([re]) => re.test(sql))?.[1] ?? [],
      execute: async (sql: string, params: unknown[] = []) => { executed.push({ sql, params }); },
      batch: async () => {},
    },
  };
}

const user = (o: Partial<UserRow> = {}): UserRow => ({
  id: "user-1", telegram_chat_id: "123456789", locale: "en", timezone: "Europe/Paris", delivery_hour: 9,
  status: "active", last_interaction_at: null, spheres: "[]", industries: "[]", seniority: null,
  remote_mode: "any", location: null, salary_min: null, country: null, custom_role: null,
  seniority_weight: null, location_weight: null, salary_weight: null, ...o });

const ctxOf = (d1: unknown, o: Partial<RunContext> = {}): RunContext => ({
  d1: d1 as RunContext["d1"], cfg: { anthropicApiKey: null } as RunContext["cfg"],
  now: new Date("2026-08-29T10:05:00Z"), // 12:05 у Парижі — година 9 вже минула
  botToken: "tok", force: false, scanned: { jobs: 1, companies: 1 }, requested: new Set(), delivered: 0, ...o });

const pendingRows = [
  [/status='pending'/, [{ digest_id: "dg-1", created_at: "2026-08-29 09:00:00" }]],
  [/FROM sent s JOIN jobs_cache/, [{ company: "Acme", title: "Eng", location: null, remote: 1,
    url: "https://x.test/1", why_fits: "why", salary_min: null, salary_currency: null, summary: null }]],
  [/created_at >= datetime/, [{ created_at: "2026-08-29 09:00:00" }]],
] as Array<[RegExp, unknown[]]>;

describe("deliverTo", () => {
  it("відкладену добірку дотискає навіть якщо «сьогодні вже було»", async () => {
    // Сайт зробив pending об 11:00, людина прив'язала Telegram — о 12:00 має отримати.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, executed } = fakeD1(pendingRows);
    const ctx = ctxOf(d1);
    await deliverTo(user(), ctx);
    expect(ctx.delivered).toBe(1);
    expect(executed.some((e) => /SET status='sent'/.test(e.sql) && e.params.includes("dg-1"))).toBe(true);
    expect(executed.some((e) => /delivery_requests/.test(e.sql))).toBe(false);
  });

  it("на запит «ще» відкладена добірка закриває запит, а не породжує другу", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, executed } = fakeD1(pendingRows);
    await deliverTo(user(), ctxOf(d1, { requested: new Set(["user-1"]) }));
    expect(executed.some((e) => /UPDATE delivery_requests SET handled_at/.test(e.sql))).toBe(true);
  });

  it("403 від Telegram ставить людину на паузу з причиною blocked", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, executed } = fakeD1(pendingRows);
    const ctx = ctxOf(d1);
    await deliverTo(user(), ctx);
    expect(ctx.delivered).toBe(0);
    const pause = executed.find((e) => /UPDATE users SET status='paused'/.test(e.sql));
    expect(pause?.sql).toMatch(/paused_reason='blocked'/);
    expect(pause?.params).toEqual(["user-1"]);
    expect(executed.some((e) => /INSERT/.test(e.sql))).toBe(false);
  });

  it("без Telegram pending — кінцевий стан, і «сьогодні вже було» не породжує нову", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const { d1, executed } = fakeD1(pendingRows);
    const ctx = ctxOf(d1);
    await deliverTo(user({ telegram_chat_id: null }), ctx);
    expect(f).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
  });
});
