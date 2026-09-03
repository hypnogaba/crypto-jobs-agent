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
import { clampSummary, fitTelegram, fitDigest, formatDigest, greetingFor, hideRow, isBlocked, sendTelegram, TELEGRAM_MAX, DIGEST_MAX, describeError, escapeHtml, stripHtml } from "./digest.js";

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
  // Другий аргумент — рядок про роль: саме він тепер відкриває картку.
  const job = (i: number, roleLine: string, why = "why") => ({
    id: `j${i}`, company: `Company ${i}`, companyKey: `c${i}`, title: "Senior Engineer",
    location: "Paris", remote: true, url: `https://x.test/${i}`, tags: [], postedAt: null,
    salaryMin: null, salaryCurrency: null, why, roleLine, sentId: `sent-${i}` });

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

  it("довше за 3900 — спершу зникають рядки про роль, потім хвіст", () => {
    // Рядки про роль плюс довгі назви — п'ять карток не влазять у 3900.
    //
    // «Чому ти» тут РІЗНІ навмисно: однакові тепер друкуються один раз, і
    // тиску на розмір від них не було б. Різні — це і є найгірший випадок.
    const jobs = Array.from({ length: 5 }, (_, i) =>
      ({ ...job(i, "lorem ipsum ".repeat(200), `${i} ${"w".repeat(700)}`), title: "Senior Engineer ".repeat(25) }));
    const text = fitDigest(jobs, "en");
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(text).not.toContain("lorem ipsum");
    expect(text).toContain("Why it's for you: ");
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
  // Записи в sent ідуть через batch, тож без цього не видно найголовнішого —
  // з яким статусом народжується рядок добірки.
  const batched: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    batched,
    d1: {
      query: async (sql: string) => answers.find(([re]) => re.test(sql))?.[1] ?? [],
      execute: async (sql: string, params: unknown[] = []) => { executed.push({ sql, params }); },
      batch: async (st: Array<{ sql: string; params: unknown[] }>) => { batched.push(...st); },
    },
  };
}

const user = (o: Partial<UserRow> = {}): UserRow => ({
  id: "user-1", telegram_chat_id: "123456789", locale: "en", timezone: "Europe/Paris", delivery_hour: 9,
  // Сфера тут не декорація: без неї (і без своєї ролі) deliverTo виходить
  // одразу — підбирати нема за чим. Порожній профіль перевіряється окремим
  // тестом нижче, а решті потрібна людина, яка щось про себе сказала.
  status: "active", last_interaction_at: null, spheres: "[\"engineering\"]", industries: "[]",
  remote_mode: "any", location: null, salary_min: null, country: null, custom_role: null, wishes: null,
  location_weight: null, salary_weight: null, ...o });

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

  it("без Telegram залежаний pending лікується: кабінет і є доставкою", async () => {
    // Це той самий глухий кут, через який людина з сайту отримувала добірку
    // РІВНО ОДИН РАЗ. Рядок лишався pending назавжди (перевести його в sent
    // не було кому), і гілка «відкладена вже лежить у кабінеті» щогодини
    // виходила з функції — назавжди.
    const f = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, executed } = fakeD1([
      // Специфічне правило мусить стояти перед загальним /status='pending'/.
      [/COUNT\(\*\) AS n FROM sent WHERE user_id=\? AND status='pending'/, [{ n: 5 }]],
      ...pendingRows,
    ]);
    await deliverTo(user({ telegram_chat_id: null }), ctxOf(d1));
    expect(f).not.toHaveBeenCalled();
    const heal = executed.find((e) => /SET status='sent', sent_at=created_at/.test(e.sql));
    expect(heal?.params).toEqual(["user-1"]);
  });

  it("без Telegram нова добірка народжується одразу як sent", async () => {
    // Кабінет — це і є канал доставки. Народжений pending рядок глушив би
    // усі наступні добірки цієї людини.
    const f = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, batched } = fakeD1([
      [/FROM jobs_cache j/, [{
        id: "j1", company: "Acme", company_key: "acme", title: "Backend Engineer",
        location: null, remote: 1, url: "https://acme.test/1", tags: '["engineering"]',
        posted_at: "2026-08-28T06:00:00.000Z", salary_min: null, salary_max: null,
        salary_currency: null, dedupe_key: "acme|backend", summary: "A job.",
        source: "ashby:acme", country: null,
      }]],
    ]);
    const ctx = ctxOf(d1);
    await deliverTo(user({ telegram_chat_id: null }), ctx);
    expect(f).not.toHaveBeenCalled();
    const insert = batched.find((b) => /INSERT OR IGNORE INTO sent/.test(b.sql));
    expect(insert).toBeDefined();
    // ...,status,sent_at,dedupe_key — статус сьомий параметр, час восьмий.
    expect(insert!.params[6]).toBe("sent");
    expect(insert!.params[7]).not.toBeNull();
    // Доставка в кабінет рахується прогоном нарівні з Telegram.
    expect(ctx.delivered).toBe(1);
  });

  it("з Telegram добірка й далі народжується pending — до 200 OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, batched } = fakeD1([
      [/FROM jobs_cache j/, [{
        id: "j1", company: "Acme", company_key: "acme", title: "Backend Engineer",
        location: null, remote: 1, url: "https://acme.test/1", tags: '["engineering"]',
        posted_at: "2026-08-28T06:00:00.000Z", salary_min: null, salary_max: null,
        salary_currency: null, dedupe_key: "acme|backend", summary: "A job.",
        source: "ashby:acme", country: null,
      }]],
    ]);
    await deliverTo(user(), ctxOf(d1));
    const insert = batched.find((b) => /INSERT OR IGNORE INTO sent/.test(b.sql));
    expect(insert!.params[6]).toBe("pending");
    expect(insert!.params[7]).toBeNull();
  });

  it("профіль без сфери й без своєї ролі: нічого не пишемо, кажемо чому", async () => {
    // Раніше scoreJob не карав нікого (штраф −8 стоїть під умовою «людина
    // щось назвала»), тож кожна віддалена вакансія набирала +5 з нічого — і
    // людина отримувала п'ять випадкових вакансій із упевненим поясненням.
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1, executed, batched } = fakeD1([]);
    // 10:05 UTC — це 12:05 у Парижі, тобто НЕ година доставки: нагадування
    // не має ходити щогодини.
    await deliverTo(user({ spheres: "[]", custom_role: null }), ctxOf(d1));
    expect(batched).toEqual([]);
    expect(executed).toEqual([]);
    expect(f).not.toHaveBeenCalled();

    // А в її годину — рівно одне нагадування.
    await deliverTo(user({ spheres: "[]", custom_role: null }),
      ctxOf(d1, { now: new Date("2026-08-28T07:05:00Z") }));
    const body = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as { text: string };
    expect(body.text).toMatch(/profile/i);
    expect(batched).toEqual([]);
  });

  it("своя роль без жодної галочки — це теж пошук", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d1 } = fakeD1([]);
    const ctx = ctxOf(d1);
    await deliverTo(user({ spheres: "[]", custom_role: "solidity auditor" }), ctx);
    // Кандидатів фейк не дав, тож добірки немає — але й виходу «нема за чим
    // шукати» теж: далі пішов звичайний шлях.
    expect(ctx.delivered).toBe(0);
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

import { nextDelivery, formatWhen } from "./digest-copy.js";

describe("nextDelivery / formatWhen", () => {
  const sat = new Date("2026-08-29T11:00:00Z"); // субота 13:00 Париж
  it("із суботи — понеділок о 9 за Парижем", () => {
    expect(nextDelivery("Europe/Paris", 9, sat).toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });
  it("у робочий день до години — сьогодні; після — наступний робочий", () => {
    expect(nextDelivery("Europe/Paris", 9, new Date("2026-08-31T06:00:00Z")).toISOString()).toBe("2026-08-31T07:00:00.000Z");
    expect(nextDelivery("Europe/Paris", 9, new Date("2026-08-28T08:00:00Z")).toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });
  it("Київ", () => {
    expect(nextDelivery("Europe/Kyiv", 9, sat).toISOString()).toBe("2026-08-31T06:00:00.000Z");
  });
  it("формат мовою людини", () => {
    const d = new Date("2026-08-31T07:00:00Z");
    expect(formatWhen(d, "Europe/Paris", "uk")).toMatch(/понеділок.*31 серпня.*09:00/);
    expect(formatWhen(d, "Europe/Paris", "en")).toMatch(/Monday.*31 August.*09:00/);
    expect(formatWhen(d, "Europe/Paris", "fr")).toMatch(/lundi.*31 août.*09:00/);
  });
});

describe("футер першої добірки", () => {
  const five = [1, 2, 3, 4, 5].map((i) => ({
    id: `j${i}`, company: `Company ${i}`, companyKey: `c${i}`, title: "Senior Engineer",
    location: "Paris", remote: true, url: `https://x.test/${i}`, tags: [], postedAt: null,
    salaryMin: null, salaryCurrency: null, why: "why", summary: "Plain summary.", sentId: `sent-${i}` }));
  it("на першу доставку на запит — пояснення з датою наприкінці", () => {
    const text = formatDigest(five, "uk", { trialWhen: "понеділок, 31 серпня, 09:00" });
    expect(text).toMatch(/Ось так працює бот.*понеділок, 31 серпня, 09:00\.$/s);
  });
  it("звичайна — без нього", () => {
    expect(formatDigest(five, "uk")).not.toContain("Ось так працює бот");
  });
});

// ── Вікно кандидатів: спершу своє, потім свіже ────────────────
import { fetchCandidateRows, onTopicSql, roleSql } from "./digest.js";

describe("onTopicSql", () => {
  it("сфери шукаються з лапками, щоб не збігатись частиною чужого тега", () => {
    const r = onTopicSql({ spheres: ["qa", "design"], customRole: null });
    expect(r.sql).toBe("(CASE WHEN j.tags LIKE ? OR j.tags LIKE ? THEN 1 ELSE 0 END)");
    expect(r.params).toEqual(['%"qa"%', '%"design"%']);
  });

  it("своя роль — усі слова разом, і кожне значуще окремо", () => {
    // Повний збіг і частковий — це два різні бали (role+12 і rolePart+5), тож
    // у вікно мають заходити обидва. «auditor» тут значуще, «solidity» теж.
    const r = onTopicSql({ spheres: [], customRole: "solidity auditor" });
    expect(r.sql).toBe("(CASE WHEN (LOWER(j.title) LIKE ? AND LOWER(j.title) LIKE ?)" +
      " OR LOWER(j.title) LIKE ? OR LOWER(j.title) LIKE ? THEN 1 ELSE 0 END)");
    expect(r.params).toEqual(["%solidity%", "%auditor%", "%solidity%", "%auditor%"]);
  });

  it("загальне слово окремо у вікно не тягне", () => {
    // «manager» саме по собі затягнув би половину кеша, тож окремим АБО він
    // не стає — лишається тільки в парі з «community».
    const r = onTopicSql({ spheres: [], customRole: "community manager" });
    expect(r.params).toEqual(["%community%", "%manager%", "%community%"]);
  });

  it("короткі слова відкидаються так само, як у матчері", () => {
    // «ai» ловило б усе підряд — roleWords лишає слова довші за два символи.
    expect(onTopicSql({ spheres: [], customRole: "ai" })).toEqual({ sql: "0", params: [] });
  });

  it("нема за чим сортувати — вікно поводиться як раніше", () => {
    expect(onTopicSql({ spheres: [], customRole: null })).toEqual({ sql: "0", params: [] });
  });

  it("сфери й роль разом — це АБО, а не І", () => {
    const r = onTopicSql({ spheres: ["devrel"], customRole: "community lead" });
    expect(r.sql).toMatch(/j\.tags LIKE \? OR \(LOWER/);
    // «lead» — загальне слово, тож окремим АБО стає лише «community».
    expect(r.params).toEqual(['%"devrel"%', "%community%", "%lead%", "%community%"]);
  });
});

describe("roleSql — вікно спершу набирає роль", () => {
  it("віддає ту саму умову, що й роль усередині onTopicSql", () => {
    const r = roleSql({ customRole: "community manager" });
    expect(r.sql).toBe("(CASE WHEN (LOWER(j.title) LIKE ? AND LOWER(j.title) LIKE ?)" +
      " OR LOWER(j.title) LIKE ? THEN 1 ELSE 0 END)");
    expect(r.params).toEqual(["%community%", "%manager%", "%community%"]);
  });

  it("без своєї ролі це просто нуль, і сортування нічого не міняє", () => {
    expect(roleSql({ customRole: null })).toEqual({ sql: "0", params: [] });
  });
});

describe("fetchCandidateRows — порядок параметрів", () => {
  /**
   * Ці два тести стережуть саме те, що ламається мовчки. Умова ролі стоїть у
   * запиті ТРИЧІ (у списку колонок, у вікні над company_key і всередині
   * умови теми), і параметри до них ідуть одним пласким списком. Помилка в
   * порядку не дає ні помилки SQL, ні порожньої відповіді — вона дає ЧУЖУ
   * добірку, і помітити це можна лише очима на живих даних.
   */
  const profile = { spheres: ["engineering"], customRole: "community manager",
                    customRoleEn: null, country: null } as never;

  it("роль іде першою в сортуванні й у стелі на компанію", async () => {
    let sql = "";
    const d1 = { query: async (q: string) => { sql = q; return []; } } as never;
    await fetchCandidateRows(d1, profile, "u1");
    expect(sql).toMatch(/ORDER BY by_role DESC, posted_at DESC/);
    expect(sql).toMatch(/PARTITION BY j\.company_key\s+ORDER BY \(CASE WHEN/);
  });

  it("параметрів рівно стільки, скільки знаків питання", async () => {
    let sql = "", params: unknown[] = [];
    const d1 = { query: async (q: string, p: unknown[]) => { sql = q; params = p; return []; } } as never;
    await fetchCandidateRows(d1, profile, "u1");
    expect(params).toHaveLength((sql.match(/\?/g) ?? []).length);
    // Двічі роль (колонка й вікно), потім тема, потім двічі користувач.
    expect(params).toEqual([
      "%community%", "%manager%", "%community%",
      "%community%", "%manager%", "%community%",
      '%"engineering"%', "%community%", "%manager%", "%community%",
      "u1", "u1",
    ]);
  });
});

describe("привітання за часом доби", () => {
  it("ранок до одинадцятої — планова добірка в будь-якому поясі", () => {
    expect(greetingFor(6)).toBe("greeting");
    expect(greetingFor(10)).toBe("greeting");
  });

  /**
   * Саме цей випадок і був вадою: людина налаштувала бота о третій дня,
   * натиснула «показати зараз» і першою фразою почула «Доброго ранку».
   */
  it("удень вітається нейтрально", () => {
    expect(greetingFor(15)).toBe("greetingDay");
  });

  it("після сімнадцятої — вечір", () => {
    expect(greetingFor(17)).toBe("greetingEvening");
    expect(greetingFor(23)).toBe("greetingEvening");
  });

  /** Без години лишається ранкове — так поводився код завжди. */
  it("без години нічого не змінюється", () => {
    expect(greetingFor(undefined)).toBe("greeting");
  });

  it("текст добірки справді змінюється", () => {
    const j = { id: "1", url: "https://x/1", company: "Acme", title: "Engineer",
      location: null, salaryMin: null, salaryMax: null, salaryCurrency: null,
      why: "бо так", facts: [], summary: null, source: "x", score: 1 };
    expect(formatDigest([j as never], "uk", { hour: 15 })).toContain("Привіт");
    expect(formatDigest([j as never], "uk", { hour: 8 })).toContain("Доброго ранку");
  });
});

describe("hideRow", () => {
  /**
   * Рядок прибрано навмисно, і тест стереже саме це.
   *
   * «Не ц…» плюс рівний ряд «1 2 3 4 5» на телефоні читається як прохання
   * поставити добірці оцінку від одного до п'яти. Власник прочитав його саме
   * так. Ховати вакансію лишилось у кабінеті, де видно, що саме ховаєш.
   */
  it("під добіркою немає ряду з номерами: він читався як оцінка", () => {
    expect(hideRow(["a1", "b2", "c3"], "uk")).toEqual([]);
    expect(hideRow([], "uk")).toEqual([]);
  });
});

// ── Тіло картки: рядок про роль і рядок про людину ────────────
import { tidyCompany, tidyLocation } from "./digest.js";

describe("тіло картки", () => {
  const card = (o: object = {}) => ({
    id: "j1", company: "Acme", companyKey: "acme", title: "Partnerships Manager",
    location: "Paris", remote: true, url: "https://x.test/1", tags: [], postedAt: null,
    salaryMin: null, salaryCurrency: null, sentId: "s1",
    why: "це твоя сфера", roleLine: "Вести партнерства з протоколами.", ...o });

  /**
   * Обидва рядки разом — у цьому й уся зміна. Досі картка показувала або
   * витяг з оголошення, або «чому ти», і в одній добірці стояли обидва
   * різновиди: три картки з абзацом переказу, дві з фразою про профіль.
   */
  it("показує спершу роль, потім «Чому тобі»", () => {
    const text = formatDigest([card()], "uk");
    expect(text).toContain("Вести партнерства з протоколами.");
    expect(text).toContain("Чому тобі: це твоя сфера");
    expect(text.indexOf("Вести партнерства")).toBeLessThan(text.indexOf("Чому тобі"));
  });

  it("без рядка про роль картка все одно ціла", () => {
    const text = formatDigest([card({ roleLine: null })], "uk");
    expect(text).toContain("Чому тобі: це твоя сфера");
    expect(text).toContain("Податися");
  });

  it("підпис перекладений", () => {
    expect(formatDigest([card()], "fr")).toContain("Pourquoi c'est pour vous:");
    expect(formatDigest([card()], "ru")).toContain("Почему тебе:");
    expect(formatDigest([card()], "en")).toContain("Why it's for you:");
  });

  /**
   * JobStash кладе в location весь текст оголошення. Такий рядок ішов у
   * картку цілим англійським абзацом під українським заголовком.
   */
  it("абзац замість локації в картку не потрапляє", () => {
    const dump = "REMOTE (US/Canada/Brazil/Poland/UK/India) Full-time AI Risk Decisioning platform that helps organizations manage onboarding, fraud, credit and compliance risks";
    const text = formatDigest([card({ location: dump })], "uk");
    expect(text).not.toContain("Decisioning");
    expect(text).toContain("віддалено");
  });

  it("домен у назві компанії не стає посиланням", () => {
    expect(formatDigest([card({ company: "Oscilar.com" })], "uk")).toContain("<b>Oscilar</b>");
  });
});

describe("tidyLocation", () => {
  it("короткі локації лишає як є", () => {
    expect(tidyLocation("Warsaw, Poland")).toBe("Warsaw, Poland");
    expect(tidyLocation("  Remote - United States ")).toBe("Remote - United States");
  });
  it("з абзацу бере перше речення, а без нього — нічого", () => {
    expect(tidyLocation("Berlin, Germany. " + "x".repeat(200))).toBe("Berlin, Germany.");
    expect(tidyLocation("y".repeat(200))).toBeNull();
  });
  it("зрізає хвіст пунктуації", () => {
    expect(tidyLocation("Belgrade, Serbia;")).toBe("Belgrade, Serbia");
    expect(tidyLocation("Paris -")).toBe("Paris");
  });
  it("порожнє — це null, а не порожній рядок", () => {
    expect(tidyLocation("   ")).toBeNull();
    expect(tidyLocation(null)).toBeNull();
  });
});

describe("tidyCompany", () => {
  it("знімає доменний хвіст", () => {
    expect(tidyCompany("Oscilar.com")).toBe("Oscilar");
    expect(tidyCompany("helius.dev")).toBe("Helius");
    // Незнайомий домен лишається як є, але з великої: це все ще назва.
    expect(tidyCompany("jito.network")).toBe("Jito.network");
  });
  it("ключ з адреси пишеться з великої", () => {
    expect(tidyCompany("jetbrains")).toBe("Jetbrains");
    expect(tidyCompany("hellofresh")).toBe("Hellofresh");
  });
  it("звичайні назви не чіпає", () => {
    for (const name of ["Acme Inc.", "A&B Labs", "Ledger", "Monad Foundation", "Café Corp", "iExec"]) {
      expect(tidyCompany(name)).toBe(name);
    }
  });
});

import { failureReport, lostDelivery } from "./digest.js";

/**
 * Відтворення 03.09: 429 від Cloudflare звалив обробку шістнадцяти профілів
 * о 17:05, коли всі шістнадцять мали годину 9:00 і вже отримали своє вранці.
 */
describe("failureReport — лист має називати втрати, а не спіткнення", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}: D1 HTTP 429`);

  it("без збоїв листа немає", () => {
    expect(failureReport([], [], 17)).toBeNull();
  });

  it("шістнадцять спіткнень поза їхньою годиною — не аварія", () => {
    const text = failureReport([], ids(16), 17)!;
    expect(text).toContain("Втрат немає");
    expect(text).not.toContain("16 з 17");
  });

  it("втрачені добірки називаються числом і рахуються від усіх", () => {
    const text = failureReport(ids(3), ids(9), 17)!;
    expect(text).toContain("3 з 17");
    expect(text).toContain("не дійшла");
  });

  it("у листі стоять саме втрачені, а спіткнення додаються числом", () => {
    const text = failureReport(["alpha: збій"], ids(9), 17)!;
    expect(text).toContain("alpha: збій");
    expect(text).toContain("та ще 9");
  });

  it("довгий список ріжеться до восьми, решта числом", () => {
    const text = failureReport(ids(20), [], 25)!;
    expect(text.split("\n").filter((l) => l.startsWith("id"))).toHaveLength(8);
    expect(text).toContain("та ще 12");
  });
});

describe("lostDelivery — хто справді чекав", () => {
  // 15:05 UTC — рівно та мить, коли впала розсилка 03.09.
  const now = new Date("2026-09-03T15:05:00Z");
  const u = (timezone: string, delivery_hour: number) => ({ id: "u1", timezone, delivery_hour });

  it("Прага о 17:05 з годиною 9:00 — нічого не втрачено", () => {
    expect(lostDelivery(u("Europe/Prague", 9), now, new Set())).toBe(false);
  });

  it("Нью-Йорк о 11:05 з годиною 11:00 — добірка втрачена", () => {
    expect(lostDelivery(u("America/New_York", 11), now, new Set())).toBe(true);
  });

  it("відкритий запит «ще» важить і поза годиною", () => {
    expect(lostDelivery(u("Europe/Prague", 9), now, new Set(["u1"]))).toBe(true);
  });
});

/**
 * Скарга 03.09: «прийшло 5 вакансій і опис усюди однаковий».
 *
 * Відтворено з живої добірки ffd2deb6: виклик моделі провалився (api_usage
 * ok=0, нуль токенів), тож рядка про роботу не було ЗОВСІМ, а «Чому тобі»
 * зібрався локально з фактів збігу. Факти в усіх п'яти однакові за
 * побудовою — вони описують збіг з тим самим профілем, — тож і рядок вийшов
 * однаковий п'ять разів. При цьому витяг з оголошення лежав у базі в трьох
 * вакансіях із п'яти й не показався.
 */
describe("картка не повторює той самий рядок п'ять разів", () => {
  const job = (n: number, over: Partial<DigestJob> = {}): DigestJob => ({
    id: `j${n}`, company: `Company ${n}`, companyKey: `c${n}`, title: `Designer ${n}`,
    location: null, remote: true, url: `https://e/${n}`, tags: [], postedAt: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, summary: null,
    source: "s", country: null, sentId: `s${n}`,
    why: "це «Дизайн», одна з твоїх сфер, повністю віддалено.",
    ...over,
  } as DigestJob);

  it("однаковий «Чому тобі» друкується один раз, а не п'ять", () => {
    const text = formatDigest([job(1), job(2), job(3), job(4), job(5)], "uk");
    expect(text.split("Чому тобі:").length - 1).toBe(1);
  });

  it("різні «Чому тобі» лишаються всі", () => {
    const text = formatDigest([
      job(1, { why: "перша причина" }),
      job(2, { why: "друга причина" }),
    ], "uk");
    expect(text).toContain("перша причина");
    expect(text).toContain("друга причина");
  });

  /**
   * Найважливіше: якщо особистого сказати нічого, картка мусить сказати про
   * саму роботу. Витяг з оголошення різний у кожної вакансії й уже лежить у
   * базі — досі його просто не брали, коли модель не відповіла.
   */
  it("без рядка від моделі бере витяг із оголошення", () => {
    const text = formatDigest([
      job(1, { roleLine: null, summary: "Проєктування ігрових механік і економіки рівнів." }),
      job(2, { roleLine: null, summary: "Дизайн бренду для фінтех-продукту." }),
    ], "uk");
    expect(text).toContain("Проєктування ігрових механік");
    expect(text).toContain("Дизайн бренду");
  });

  it("рядок від моделі важливіший за витяг", () => {
    const text = formatDigest([
      job(1, { roleLine: "Слова моделі", summary: "Витяг з оголошення" }),
    ], "uk");
    expect(text).toContain("Слова моделі");
    expect(text).not.toContain("Витяг з оголошення");
  });

  /** Немає ні того, ні того — картка все одно ціла, просто коротша. */
  it("без обох картка лишається цілою", () => {
    const text = formatDigest([job(1, { roleLine: null, summary: null })], "uk");
    expect(text).toContain("Designer 1");
    expect(text).toContain("Податися");
  });
});

import { modelFailReport } from "./digest.js";

/**
 * 03.09 власник отримав «модель не відповіла 1 раз(и)» і не міг дізнатись
 * причину: статус ніде не зберігався. Ліміт, протермінований ключ і скінчені
 * гроші виглядали однаково, і статус довелось діставати з живої бази вручну.
 */
describe("сповіщення про мовчання моделі", () => {
  it("без збоїв листа немає", () => {
    expect(modelFailReport([])).toBeNull();
  });

  it("називає статус, а не саме лише число", () => {
    const text = modelFailReport([429, 429])!;
    expect(text).toContain("429");
    expect(text).toContain("2");
  });

  it("кілька різних статусів перелічені всі", () => {
    const text = modelFailReport([401, 529])!;
    expect(text).toContain("401");
    expect(text).toContain("529");
  });

  it("статус без номера не ламає лист", () => {
    expect(modelFailReport([undefined])!).toContain("1");
  });
});

/**
 * Знайдено прогоном на справжній добірці ffd2deb6, а не тестами.
 */
describe("наслідки дедуплікації, знайдені на живій добірці", () => {
  const j = (n: number, over: Partial<DigestJob> = {}): DigestJob => ({
    id: `j${n}`, company: `C${n}`, companyKey: `c${n}`, title: `T${n}`,
    location: null, remote: true, url: "u", tags: [], postedAt: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, summary: null,
    source: "s", country: null, sentId: `s${n}`, why: "спільна причина",
    ...over,
  } as DigestJob);

  /**
   * Найгірший наслідок дедуплікації: картка без опису й без «чому» стає
   * назвою та посиланням. Тоді повтор корисніший за порожнечу.
   */
  /**
   * Картка без витягу все одно має рядок умов (локація, віддаленість, вилка),
   * і саме він відповідає на «що там за умови в цій вакансії». Тож повтор
   * причини їй не потрібен.
   */
  it("картка з умовами обходиться без повторної причини", () => {
    const text = formatDigest([
      j(1, { summary: "Опис першої роботи.", location: "Берлін" }),
      j(2, { summary: null, location: "Париж" }),
    ], "uk");
    expect(text.split("Чому тобі:").length - 1).toBe(1);
    expect(text).toContain("Париж");
  });

  /**
   * Але картка без витягу Й без умов лишилась би самою назвою з посиланням.
   * Тоді повторена причина краща за порожнечу.
   */
  it("картка зовсім без тексту лишає причину, хай і повторну", () => {
    const text = formatDigest([
      j(1, { summary: "Опис першої." , location: "Берлін" }),
      j(2, { summary: null, location: null, remote: false }),
    ], "uk");
    const second = text.split("2. ")[1]!;
    expect(second).toContain("Чому тобі:");
  });

  it("коли опис є в усіх, спільне «чому» друкується один раз", () => {
    const text = formatDigest([
      j(1, { summary: "Перша." }), j(2, { summary: "Друга." }), j(3, { summary: "Третя." }),
    ], "uk");
    expect(text.split("Чому тобі:").length - 1).toBe(1);
  });

  /** Витяг інколи починається зірочкою чи маркером списку з оголошення. */
  it("прибирає маркер на початку витягу", () => {
    const text = formatDigest([j(1, { summary: "*Open to hiring remote across the US." })], "uk");
    expect(text).toContain("Open to hiring");
    expect(text).not.toContain("*Open");
  });
});
