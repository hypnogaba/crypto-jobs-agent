import { describe, expect, it } from "vitest";
import { parseArgs } from "./digest.js";

describe("parseArgs", () => {
  it("без прапорців не звужує добірку ні до кого", () => {
    // Саме тут ховалась поломка: argv.indexOf("--user") дає −1, і наївне
    // argv[i + 1] повертало argv[0] — шлях до node. Значення непорожнє, тож
    // кожен плановий прогін шукав користувача з id '/usr/local/bin/node'.
    expect(parseArgs([])).toEqual({ force: false, onlyUser: null, requestsOnly: false });
  });

  it("--force сам по собі не робить із чогось onlyUser", () => {
    expect(parseArgs(["--force"])).toEqual({ force: true, onlyUser: null, requestsOnly: false });
  });

  it("читає --user, коли він справді є", () => {
    expect(parseArgs(["--user", "u1"])).toEqual({ force: false, onlyUser: "u1", requestsOnly: false });
    expect(parseArgs(["--force", "--user", "u1"])).toEqual({ force: true, onlyUser: "u1", requestsOnly: false });
  });

  it("--requests-only вмикає швидкий шлях", () => {
    expect(parseArgs(["--requests-only"]).requestsOnly).toBe(true);
  });

  it("--user без значення не вигадує його", () => {
    expect(parseArgs(["--user"])).toEqual({ force: false, onlyUser: null, requestsOnly: false });
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
import { clampSummary, fitTelegram, fitDigest, formatDigest, isBlocked, sendTelegram, TELEGRAM_MAX, DIGEST_MAX, describeError, escapeHtml, stripHtml } from "./digest.js";

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
    const body = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as { text: string; parse_mode: string };
    expect(body.text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    expect(body.parse_mode).toBe("HTML");
  });

  it("кнопка «Уточнити» зберігає callback_data not_relevant", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendTelegram("t", "123456789", "hi", "d1", "uk", f as never);
    const body = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } };
    expect(body.reply_markup.inline_keyboard[0]![0]).toEqual({ text: "Уточнити", callback_data: "fb:d1:not_relevant" });
  });

  it("Telegram не розібрав HTML — повторює без тегів", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("Bad Request: can't parse entities", { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendTelegram("t", "123456789", "<b>x</b> &amp; y", "d1", "en", f as never)).resolves.toEqual({ ok: true, status: 200 });
    const body = JSON.parse((f.mock.calls[1]![1] as { body: string }).body) as { text: string; parse_mode?: string };
    expect(body.text).toBe("x & y");
    expect(body.parse_mode).toBeUndefined();
  });
});

describe("escapeHtml", () => {
  it("екранує все, що Telegram сприйняв би за тег", () => {
    expect(escapeHtml('<C++ & "Go">')).toBe("&lt;C++ &amp; &quot;Go&quot;&gt;");
    expect(escapeHtml(null)).toBe("");
    expect(stripHtml("<a href=\"x\">A &amp; B</a>")).toBe("A & B");
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
  const job = (i: number, summary: string, why = "why") => ({
    id: `j${i}`, company: `Company ${i}`, companyKey: `c${i}`, title: "Senior Engineer",
    location: "Paris", remote: true, url: `https://x.test/${i}`, tags: [], postedAt: null,
    salaryMin: null, salaryCurrency: null, why, summary, sentId: `sent-${i}` });

  it("clampSummary ріже по слову і ставить трикрапку", () => {
    expect(clampSummary("short")).toBe("short");
    expect(clampSummary(null)).toBeNull();
    const cut = clampSummary("word ".repeat(300), 100)!;
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("п'ять довгих описів усе одно влазять у повідомлення", () => {
    const jobs = Array.from({ length: 5 }, (_, i) => job(i, "lorem ipsum ".repeat(120)));
    const text = fitDigest(jobs, "uk");
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(fitTelegram(text)).toBe(text);
  });

  it("довше за 3900 — спершу зникають описи, потім хвіст", () => {
    // Описи по 500 після clampSummary плюс довгі назви — п'ять карток не влазять у 3900.
    const jobs = Array.from({ length: 5 }, (_, i) =>
      ({ ...job(i, "lorem ipsum ".repeat(200), "w".repeat(700)), title: "Senior Engineer ".repeat(25) }));
    const text = fitDigest(jobs, "en");
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(text).not.toContain("lorem ipsum");
    expect(text).toContain("Why you: ");
    // Без описів усе ще задовго (5 × 700 «чому ти») — карток стає менше, але
    // жоден тег не розірваний.
    expect(text.match(/<a /g)!.length).toBeLessThan(5);
    expect(text.match(/<a /g)!.length).toBe(text.match(/<\/a>/g)!.length);
  });

  it("картка: HTML-екранування, посилання «Податися» на /go/<sentId>, без рядка «Переглянуто»", () => {
    const j = { ...job(1, "Own the <ACATS> flow & more."), company: "A&B <Labs>", title: "C++ Dev" };
    const text = formatDigest([j], "uk");
    expect(text).toContain("<b>A&amp;B &lt;Labs&gt;</b>");
    expect(text).toContain("Own the &lt;ACATS&gt; flow &amp; more.");
    expect(text).toContain('<a href="https://nextrole.info/go/sent-1">Податися</a>');
    expect(text).not.toContain("https://x.test/1");
    expect(text).not.toMatch(/Переглянуто/);
    expect(formatDigest([j], "fr")).toContain(">Postuler</a>");
    expect(formatDigest([j], "ru")).toContain(">Откликнуться</a>");
    expect(formatDigest([j], "en")).toContain(">Apply</a>");
  });

  it("вилка у фактах: від–до, лише підлога, лише стеля, нічого", () => {
    const j = (o: object) => ({ ...job(1, "Own it."), ...o });
    // Intl ставить між тисячами нерозривний пробіл — тому \s у зразках.
    expect(formatDigest([j({ salaryMin: 120_000, salaryMax: 150_000, salaryCurrency: "USD" })], "uk"))
      .toMatch(/від 120\s000 до 150\s000 USD/);
    expect(formatDigest([j({ salaryMin: 120_000, salaryMax: 150_000, salaryCurrency: "USD" })], "en"))
      .toContain("120,000–150,000 USD");
    expect(formatDigest([j({ salaryMin: 120_000, salaryMax: 150_000, salaryCurrency: "EUR" })], "fr"))
      .toMatch(/à partir de 120\s000 jusqu'à 150\s000 EUR/);
    expect(formatDigest([j({ salaryMin: 90_000, salaryMax: null, salaryCurrency: "EUR" })], "ru"))
      .toMatch(/от 90\s000 EUR/);
    expect(formatDigest([j({ salaryMin: null, salaryMax: 150_000, salaryCurrency: "GBP" })], "uk"))
      .toMatch(/до 150\s000 GBP/);
    expect(formatDigest([j({ salaryMin: null, salaryMax: null, salaryCurrency: "GBP" })], "uk"))
      .not.toMatch(/від \d|до \d|GBP/);
    // Старі виклики без salaryMax поводяться як досі.
    expect(formatDigest([j({ salaryMin: 90_000, salaryCurrency: "USD" })], "uk")).toMatch(/від 90\s000 USD/);
  });

  it("стеля дня: замість «менше ніж зазвичай» — «це останні на сьогодні»", () => {
    const two = [job(1, "a"), job(2, "b")];
    expect(formatDigest(two, "uk")).toContain("Сьогодні менше ніж зазвичай — 2 замість 5");
    const capped = formatDigest(two, "uk", { capped: true });
    expect(capped).toContain("Це останні на сьогодні — стеля 20 вакансій на день. Решта завтра.");
    expect(capped).not.toContain("менше ніж зазвичай");
    expect(formatDigest(two, "en", { capped: true })).toContain("cap is 20 jobs a day");
    expect(fitDigest(two, "fr", DIGEST_MAX, { capped: true })).toContain("le plafond est de 20 offres par jour");
    // П'ять із п'яти — жодного хвоста навіть зі стелею.
    expect(formatDigest(Array.from({ length: 5 }, (_, i) => job(i, "x")), "uk", { capped: true })).not.toContain("останні на сьогодні");
  });

  it("fitTelegram — останній запобіжник", () => {
    expect(fitTelegram("a".repeat(5000)).length).toBe(TELEGRAM_MAX);
  });
});

// ── Розклад і відкладені добірки ─────────────────────────────
import { hadDigestToday, isDue, isWeekdayIn, localDate, parseDbTime, pendingIsStale, remainingToday, scheduledServedToday, sentToday, DAILY_CAP } from "./digest.js";

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

describe("isWeekdayIn", () => {
  it("день тижня рахується в поясі людини", () => {
    // 2026-08-29 — субота. 2026-08-28T22:30Z: у Києві вже субота 01:30,
    // а в Лос-Анджелесі ще п'ятниця 15:30.
    const now = new Date("2026-08-28T22:30:00Z");
    expect(isWeekdayIn("Europe/Kyiv", now)).toBe(false);
    expect(isWeekdayIn("America/Los_Angeles", now)).toBe(true);
    // Неділя 2026-08-30 — теж вихідний.
    expect(isWeekdayIn("UTC", new Date("2026-08-30T12:00:00Z"))).toBe(false);
    expect(isWeekdayIn("UTC", new Date("2026-08-31T12:00:00Z"))).toBe(true);
  });
  it("невідомий пояс — за UTC, без винятку", () => {
    expect(isWeekdayIn("Mars/Olympus", new Date("2026-08-31T12:00:00Z"))).toBe(true);
  });
});

describe("денна стеля", () => {
  const now = new Date("2026-08-31T10:00:00Z");
  const sent = (t: string, status = "sent") => ({ sent_at: t, status });

  it("рахує лише доставлене локального сьогодні", () => {
    const rows = [
      sent("2026-08-31T07:05:00.000Z"),
      sent("2026-08-30 23:30:00"),            // у Києві це вже 31-ше
      sent("2026-08-30T07:05:00.000Z"),       // учора всюди
      { sent_at: null, status: "pending" },
      sent("2026-08-31T08:00:00.000Z", "failed"),
    ];
    expect(sentToday("Europe/Kyiv", now, rows)).toHaveLength(2);
    expect(sentToday("UTC", now, rows)).toHaveLength(1);
  });

  it("remainingToday не йде нижче нуля", () => {
    expect(remainingToday(0)).toBe(DAILY_CAP);
    expect(remainingToday(17)).toBe(3);
    expect(remainingToday(25)).toBe(0);
  });
});

describe("scheduledServedToday", () => {
  const now = new Date("2026-08-31T10:00:00Z");
  it("планова добірка вже була — другої не буде", () => {
    expect(scheduledServedToday("UTC", now, [{ sent_at: "2026-08-31T07:05:00.000Z", status: "sent" }], [])).toBe(true);
  });
  it("доставка на запит «ще» плановою не вважається", () => {
    // handled_at запиту стоїть за секунди від sent_at — це одна операція.
    expect(scheduledServedToday("UTC", now,
      [{ sent_at: "2026-08-31T01:00:03.000Z", status: "sent" }], ["2026-08-31 01:00:05"])).toBe(false);
  });
  it("учорашня, pending і failed — не рахуються", () => {
    expect(scheduledServedToday("UTC", now, [
      { sent_at: "2026-08-30T07:05:00.000Z", status: "sent" },
      { sent_at: null, status: "pending" },
      { sent_at: "2026-08-31T07:05:00.000Z", status: "failed" },
    ], [])).toBe(false);
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
  remote_mode: "any", location: null, salary_min: null, country: null, custom_role: null, wishes: null,
  seniority_weight: null, location_weight: null, salary_weight: null, ...o });

const ctxOf = (d1: unknown, o: Partial<RunContext> = {}): RunContext => ({
  d1: d1 as RunContext["d1"], cfg: { anthropicApiKey: null } as RunContext["cfg"],
  now: new Date("2026-08-28T10:05:00Z"), // п'ятниця, 12:05 у Парижі — година 9 вже минула
  botToken: "tok", force: false, requested: new Set(), delivered: 0, ...o });

const pendingRows = [
  [/status='pending'/, [{ digest_id: "dg-1", created_at: "2026-08-28 09:00:00" }]],
  [/FROM sent s JOIN jobs_cache/, [{ sent_id: "s-1", company: "Acme", title: "Eng", location: null, remote: 1,
    url: "https://x.test/1", why_fits: "why", salary_min: null, salary_currency: null, summary: null }]],
  [/created_at >= datetime/, [{ created_at: "2026-08-28 09:00:00", sent_at: null, status: "pending" }]],
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, executed } = fakeD1(pendingRows);
    const ctx = ctxOf(d1);
    await deliverTo(user({ telegram_chat_id: null }), ctx);
    expect(f).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
  });

  it("у вихідний планова добірка не йде, а запит «ще» — йде", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const saturday = new Date("2026-08-29T10:05:00Z");
    const { d1, executed } = fakeD1([[/created_at >= datetime/, []]]);
    await deliverTo(user(), ctxOf(d1, { now: saturday }));
    expect(executed).toEqual([]);
    // На запит без кандидатів: запит закривається, а «нічого нового» іде.
    await deliverTo(user(), ctxOf(d1, { now: saturday, requested: new Set(["user-1"]) }));
    expect(executed.some((e) => /UPDATE delivery_requests SET handled_at/.test(e.sql))).toBe(true);
  });

  it("на запит понад 20 за день — коротке повідомлення і закритий запит", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const today = Array.from({ length: 20 }, (_, i) =>
      ({ created_at: "2026-08-28 07:00:00", sent_at: `2026-08-28T07:00:${String(i).padStart(2, "0")}.000Z`, status: "sent" }));
    const { d1, executed } = fakeD1([[/created_at >= datetime/, today]]);
    await deliverTo(user(), ctxOf(d1, { requested: new Set(["user-1"]) }));
    expect(executed.some((e) => /UPDATE delivery_requests SET handled_at/.test(e.sql))).toBe(true);
    expect(executed.some((e) => /INSERT/.test(e.sql))).toBe(false);
    const body = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as { text: string };
    expect(body.text).toContain("20");
  });
});
