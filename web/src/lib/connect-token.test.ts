import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Разовий токен: що лягає в базу і що їде в посилання.
 *
 * Тут перевіряється рівно те, чого не було: у стовпці мусить лежати дайджест,
 * а не сам ключ, і дайджест мусить залежати від ПРИЗНАЧЕННЯ — інакше токен
 * входу, який видно в чаті голим текстом, знову відмикатиме двері прив'язки.
 */

const run = vi.fn();
const one = vi.fn();

vi.mock("./db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));

import {
  buildTelegramDeepLink, findUserByConnectHash, hashConnectToken,
  issueConnectToken, newConnectToken, parseStartCommand, verifyConnectToken,
} from "./connect-token";

beforeEach(() => { run.mockReset(); one.mockReset(); one.mockResolvedValue(null); });

describe("hashConnectToken", () => {
  it("призначення входить у сам дайджест", async () => {
    expect(await hashConnectToken("link", "tok")).not.toBe(await hashConnectToken("enter", "tok"));
  });

  it("дає 64 шістнадцяткові символи", async () => {
    expect(await hashConnectToken("enter", "tok")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("той самий вхід дає той самий вихід", async () => {
    expect(await hashConnectToken("link", "tok")).toBe(await hashConnectToken("link", "tok"));
  });
});

describe("newConnectToken", () => {
  it("32 шістнадцяткові символи", () => {
    expect(newConnectToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("щоразу інший", () => {
    expect(newConnectToken()).not.toBe(newConnectToken());
  });
});

describe("issueConnectToken", () => {
  it("у базу пише хеш, а повертає токен", async () => {
    const token = await issueConnectToken("u1", "enter");
    const [sql, hash, , id] = run.mock.calls[0] as [string, string, string, string];

    expect(sql).toContain("connect_token_hash=?");
    expect(hash).not.toBe(token);
    expect(hash).toBe(await hashConnectToken("enter", token));
    expect(id).toBe("u1");
  });

  it("жоден параметр запису не дорівнює самому токену", async () => {
    const token = await issueConnectToken("u1", "link");
    expect(run.mock.calls.flatMap((c) => c.slice(1)).map(String)).not.toContain(token);
  });

  it("двічі поспіль — різні токени", async () => {
    expect(await issueConnectToken("u1", "link")).not.toBe(await issueConnectToken("u1", "link"));
  });
});

/**
 * Скільки живе посилання — і чому числа тут свої, а не CONNECT_TTL_MS.
 *
 * Очікування, зібране з тієї самої константи, згодиться на БУДЬ-ЯКЕ її
 * значення: 15 хвилин мовчки стають 15 днями, і тест лишається зеленим. А це
 * той самий рядок, який видно в чаті й на екрані з-за плеча, і про який усі
 * чотири мови в bot-copy обіцяють «15 хвилин». Тому строк тут звіряється з
 * незалежними числами, і зміна самої константи мусить цей тест ЗЛАМАТИ —
 * разом із обіцянкою в текстах, яку тоді теж треба переписати.
 */
describe("строк життя", () => {
  /** Скільки лишилось жити тому, що щойно поїхало в базу. */
  const writtenTtlMs = (): number =>
    new Date(String(run.mock.calls[0]![2])).getTime() - Date.now();

  it("посилання за замовчуванням живе хвилини, а не години й не дні", async () => {
    await issueConnectToken("u1", "enter");
    expect(writtenTtlMs()).toBeGreaterThan(14 * 60_000);
    expect(writtenTtlMs()).toBeLessThanOrEqual(15 * 60_000);
  });

  it("свій строк перебиває стандартний", async () => {
    // Відв'язка в панелі власника видає посилання на добу: людині ще треба
    // отримати його від власника й дійти з ним до бота. Якщо аргумент почнуть
    // ігнорувати, порятунок акаунта тихо звузиться до чверті години.
    await issueConnectToken("u1", "link", 24 * 60 * 60_000);
    expect(writtenTtlMs()).toBeGreaterThan(23 * 60 * 60_000);
    expect(writtenTtlMs()).toBeLessThanOrEqual(24 * 60 * 60_000);
  });
});

describe("verifyConnectToken", () => {
  const fresh = { id: "u1", connect_expires_at: new Date(Date.now() + 60_000).toISOString() };

  it("шукає за хешем свого призначення", async () => {
    one.mockResolvedValue(fresh);
    expect(await verifyConnectToken("enter", "tok")).toEqual({ id: "u1" });
    expect(String(one.mock.calls[0]![1])).toBe(await hashConnectToken("enter", "tok"));
  });

  it("протермінований рядок не годиться", async () => {
    one.mockResolvedValue({ id: "u1", connect_expires_at: new Date(Date.now() - 1).toISOString() });
    expect(await verifyConnectToken("enter", "tok")).toBeNull();
  });

  it("рядок без строку не годиться", async () => {
    one.mockResolvedValue({ id: "u1", connect_expires_at: null });
    expect(await verifyConnectToken("enter", "tok")).toBeNull();
  });
});

describe("findUserByConnectHash", () => {
  it("бере готовий хеш і не хешує його вдруге", async () => {
    one.mockResolvedValue({ id: "u1", connect_expires_at: new Date(Date.now() + 60_000).toISOString() });
    const hash = await hashConnectToken("link", "tok");
    expect(await findUserByConnectHash(hash)).toEqual({ id: "u1" });
    expect(String(one.mock.calls[0]![1])).toBe(hash);
  });
});

// Переїхали з telegram-connect.ts: модуль про токен має бути один, інакше
// наступний, хто шукатиме «де тут токен», знайде мертвий.
describe("buildTelegramDeepLink", () => {
  it("будує t.me-посилання з токеном у start", () => {
    expect(buildTelegramDeepLink("my_jobs_bot", "abc123")).toBe("https://t.me/my_jobs_bot?start=abc123");
  });
});

describe("parseStartCommand", () => {
  it("витягує токен із /start", () => {
    expect(parseStartCommand("/start abc123")).toBe("abc123");
  });

  it("витягує токен, коли вказано ім'я бота", () => {
    expect(parseStartCommand("/start@my_jobs_bot abc123")).toBe("abc123");
  });

  it("голий /start токена не має", () => {
    expect(parseStartCommand("/start")).toBeNull();
  });

  it("сторонній текст токена не має", () => {
    expect(parseStartCommand("hello there")).toBeNull();
  });
});
