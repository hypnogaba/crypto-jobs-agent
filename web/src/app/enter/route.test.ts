import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Двері «вхід на сайт» приймали БУДЬ-ЯКИЙ свіжий connect_token — і той, що
 * бот видав для входу, і той, що сайт видав для прив'язки Telegram. Тобто
 * скриншот сторінки 03/03 (там посилання t.me з тим самим токеном) відмикав
 * чужий кабінет на 30 днів.
 *
 * Тестів на цей маршрут не було взагалі, тому вони тут з нуля.
 *
 * Мок бази навмисно поводиться так, як поводитиметься D1 після міграції
 * 0045: стовпця `connect_token` більше немає, і запит по ньому падає. Без
 * цього тест був би зеленим і зі старим кодом (пошук просто нічого не знайшов
 * би), тобто не стеріг би нічого.
 */

const one = vi.fn();
const run = vi.fn();
const createSession = vi.fn();
const redirected: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { redirected.push(to); throw new Error("REDIRECT"); },
}));
vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));
vi.mock("@/lib/auth", () => ({ createSession: (...a: unknown[]) => createSession(...a) }));

import { hashConnectToken } from "@/lib/connect-token";

/**
 * Рядок «бази» заповнюємо ТИМ САМИМ помічником, яким його заповнює застосунок,
 * а не власним підрахунком із зашитим префіксом. Інакше перевірка «токен
 * прив'язки не пускає на сайт» лишалась би зеленою навіть тоді, коли
 * призначення з дайджесту прибрали: обидва боки просто не збігались би.
 */
const sha = (purpose: "link" | "enter", token: string): Promise<string> =>
  hashConnectToken(purpose, token);

/** Єдиний рядок «бази»: акаунт u1 з одним разовим токеном. */
let row: { hash: string | null; expires: string | null };

const enter = async (qs: string): Promise<void> => {
  const { GET } = await import("./route");
  try {
    await GET(new Request(`https://nextrole.info/enter${qs}`));
  } catch (e) {
    if ((e as Error).message !== "REDIRECT") throw e;
  }
};

const sqlCalls = (fn: ReturnType<typeof vi.fn>): string[] => fn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  one.mockReset(); run.mockReset(); createSession.mockReset(); redirected.length = 0;
  row = { hash: null, expires: new Date(Date.now() + 60_000).toISOString() };

  one.mockImplementation(async (sql: string, ...params: unknown[]) => {
    if (/connect_token(?!_hash)/.test(sql)) throw new Error("no such column: connect_token");
    if (sql.includes("connect_token_hash=?")) {
      return row.hash && params[0] === row.hash ? { id: "u1", connect_expires_at: row.expires } : null;
    }
    return null;
  });
  // Гасіння токена мусить бути справжнім: без цього «одноразовість» не
  // перевіриш — другий запит знайшов би той самий рядок.
  run.mockImplementation(async (sql: string) => {
    if (sql.includes("connect_token_hash=NULL")) { row.hash = null; row.expires = null; }
  });
});

describe("/enter: призначення токена", () => {
  it("токен, виданий для прив'язки Telegram, сесії не створює", async () => {
    const token = "abc123";
    row.hash = await sha("link", token);

    await enter(`?token=${token}`);

    expect(createSession).not.toHaveBeenCalled();
    expect(redirected).toEqual(["/login?error=badCredentials"]);
  });

  it("токен, виданий для входу, створює сесію й гасне", async () => {
    const token = "abc123";
    row.hash = await sha("enter", token);

    await enter(`?token=${token}`);

    expect(createSession).toHaveBeenCalledWith("u1");
    expect(sqlCalls(run).some((s) => s.includes("connect_token_hash=NULL"))).toBe(true);
    expect(redirected).toEqual(["/dashboard"]);
  });

  it("той самий токен удруге не працює", async () => {
    const token = "abc123";
    row.hash = await sha("enter", token);

    await enter(`?token=${token}`);
    createSession.mockClear(); redirected.length = 0;
    await enter(`?token=${token}`);

    expect(createSession).not.toHaveBeenCalled();
    expect(redirected).toEqual(["/login?error=badCredentials"]);
  });

  it("обрізане посилання без токена теж називає причину", async () => {
    // Голий /login мовчить, і це правильно для того, хто прийшов із шапки.
    // Але сюди людина потрапляє лише з посилання, тож тиша означала б
    // «нічого не сталось» саме тоді, коли сталось.
    await enter("");

    expect(createSession).not.toHaveBeenCalled();
    expect(redirected).toEqual(["/login?error=badCredentials"]);
  });

  it("протермінований токен входу сесії не створює", async () => {
    const token = "abc123";
    row.hash = await sha("enter", token);
    row.expires = new Date(Date.now() - 1_000).toISOString();

    await enter(`?token=${token}`);

    expect(createSession).not.toHaveBeenCalled();
    expect(redirected).toEqual(["/login?error=badCredentials"]);
  });

  it("у базу не летить сам токен — лише його хеш", async () => {
    const token = "abc123";
    row.hash = await sha("enter", token);

    await enter(`?token=${token}&to=/admin`);

    const params = one.mock.calls.flatMap((c) => c.slice(1)).map(String);
    expect(params).not.toContain(token);
    expect(redirected).toEqual(["/admin"]);
  });
});
