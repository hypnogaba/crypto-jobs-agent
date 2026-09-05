import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Дія, у яку переїхало карбування зі сторінки 03/03.
 *
 * Перевіряємо три обіцянки, і всі три невидимі зсередини коду:
 *   1. токен карбується РАЗ на дотик — і той самий, що поїхав у посилання;
 *   2. призначення саме 'link'. Помилка тут не падає й не світиться: людина
 *      просто чує від бота «посилання не працює», бо двері прив'язки рахують
 *      інший дайджест;
 *   3. акаунту, який уже має Telegram, нічого не карбується — зайвий живий
 *      секрет це зайва мішень.
 */

const one = vi.fn();
const run = vi.fn();
const requireUser = vi.fn();
const redirected: string[] = [];

vi.mock("@/lib/db", () => ({
  one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a),
  all: async () => [], uuid: () => "id-1",
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { redirected.push(to); throw new Error("REDIRECT"); },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Map<string, string>(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { TELEGRAM_BOT_USERNAME: "nr_bot" }, cf: {} }),
}));
vi.mock("@/lib/auth", () => ({
  requireUser: () => requireUser(), currentUser: async () => null,
  createSession: vi.fn(), destroySession: vi.fn(),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRate: async () => ({ allowed: true }), recordFailure: vi.fn(),
  ONBOARD_LIMITS: {}, FEEDBACK_LIMITS: {},
}));
vi.mock("@/lib/profile-write", () => ({ persistProfile: vi.fn() }));
vi.mock("@/lib/parse", () => ({ parseProfile: vi.fn(), parseLocally: vi.fn() }));
vi.mock("@/lib/telegram-send", () => ({ sendText: vi.fn() }));

import { connectTelegram } from "@/app/actions";
import { hashConnectToken } from "@/lib/connect-token";

const act = async (): Promise<void> => {
  try { await connectTelegram(); } catch (e) {
    if ((e as Error).message !== "REDIRECT") throw e;
  }
};

/** Дайджести, що поїхали в базу цим карбуванням. */
const savedHashes = (): string[] => run.mock.calls
  .filter((c) => String(c[0]).includes("connect_token_hash=?"))
  .map((c) => String(c[1]));

beforeEach(() => {
  one.mockReset(); run.mockReset(); requireUser.mockReset(); redirected.length = 0;
  one.mockResolvedValue(null);
  requireUser.mockResolvedValue({
    id: "u1", email: null, telegramChatId: null, locale: "uk",
    status: "active", timezone: "Europe/Kyiv", isAdmin: false,
  });
});

describe("connectTelegram", () => {
  it("веде просто в чат, а не назад на сторінку", async () => {
    await act();
    expect(redirected).toHaveLength(1);
    expect(redirected[0]).toMatch(/^https:\/\/t\.me\/nr_bot\?start=[0-9a-f]{32}$/);
  });

  it("у посиланні той самий токен, дайджест якого ліг у базу, і саме 'link'", async () => {
    await act();
    const token = /start=([0-9a-f]{32})/.exec(redirected[0] ?? "")?.[1];
    expect(token).toBeTruthy();
    expect(savedHashes()).toEqual([await hashConnectToken("link", token!)]);
    // Токен входу тут був би дірою: сторінку 03/03 видно з-за плеча, і той
    // самий рядок відмикав би кабінет на 30 днів.
    expect(savedHashes()[0]).not.toBe(await hashConnectToken("enter", token!));
  });

  it("акаунту з Telegram не карбує нічого", async () => {
    requireUser.mockResolvedValue({
      id: "u1", email: null, telegramChatId: "555", locale: "uk",
      status: "active", timezone: "Europe/Kyiv", isAdmin: false,
    });

    await act();

    expect(savedHashes()).toEqual([]);
    expect(redirected).toEqual(["/telegram"]);
  });
});
