import { describe, expect, it, vi, beforeEach } from "vitest";

const one = vi.fn();
const run = vi.fn();
const sendText = vi.fn();
const checkRate = vi.fn();
const recordFailure = vi.fn();
let env: Record<string, string | undefined> = {};

vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));
vi.mock("@/lib/telegram-send", () => ({ sendText: (...a: unknown[]) => sendText(...a) }));
vi.mock("@/lib/ratelimit", () => ({
  WEBHOOK_401_LIMITS: {}, checkRate: (...a: unknown[]) => checkRate(...a), recordFailure: (...a: unknown[]) => recordFailure(...a),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env }) }));
vi.mock("@/lib/bot", () => ({
  handleCommand: vi.fn(), startBotOnboarding: vi.fn(), continueBotOnboarding: vi.fn(),
  handleOnboardingButton: vi.fn(), handleOnboardingText: vi.fn(), handleWhyButton: vi.fn(),
  handleDocument: vi.fn(), handleDeleteButton: vi.fn(), handleEditButton: vi.fn(),
  handleLangButton: vi.fn(), handleStartButton: vi.fn(),
}));
vi.mock("@/lib/bot-onboarding", () => ({ freeTextAction: () => "hint" }));
vi.mock("@/lib/i18n", () => ({ isLocale: (l: string) => ["en", "uk"].includes(l) }));
vi.mock("@/lib/bot-copy", () => ({ t: (k: string) => k, tf: (k: string) => k }));

const post = async (body: unknown, secret?: string) => {
  const { POST } = await import("./route");
  return POST(new Request("https://nextrole.info/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5",
               ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
  }));
};

const sqlCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); checkRate.mockReset(); recordFailure.mockReset();
  checkRate.mockResolvedValue({ allowed: true, retryAfterMinutes: 0 });
  env = { TELEGRAM_WEBHOOK_SECRET: "s3cret", ADMIN_CHAT_ID: "777", TELEGRAM_BOT_TOKEN: "t" };
});

describe("вебхук: секрет", () => {
  it("без секрету — 401 і невдача записана за адресою", async () => {
    const res = await post({ update_id: 1, message: { text: "hi", chat: { id: 1 } } });
    expect(res.status).toBe(401);
    expect(recordFailure).toHaveBeenCalledWith("webhook401:203.0.113.5", expect.anything());
    expect(one).not.toHaveBeenCalled();
  });
  it("коли адреса вже заблокована, лічильник не крутимо далі", async () => {
    checkRate.mockResolvedValue({ allowed: false, retryAfterMinutes: 10 });
    const res = await post({ update_id: 1 }, "wrong");
    expect(res.status).toBe(401);
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

describe("вебхук: повтор update_id", () => {
  it("побачений update_id не обробляється вдруге", async () => {
    one.mockImplementation(async (sql: string) =>
      sql.includes("webhook_updates") ? { n: 1 } : null);
    await post({ update_id: 42, message: { text: "/start abc", chat: { id: 5 } } }, "s3cret");
    // Жодного читання users — обробка зупинилась на дедуплікації.
    expect(sqlCalls(one).some((s) => s.includes("FROM users"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("вебхук: прив'язка /start <token>", () => {
  const linkFlow = (opts: { otherId: string | null; hasHistory?: boolean }) => {
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("webhook_updates")) return null;
      if (sql.includes("WHERE telegram_chat_id=? AND id<>?")) return opts.otherId ? { id: opts.otherId } : null;
      if (sql.includes("WHERE connect_token=?")) return { id: "site-user", connect_expires_at: new Date(Date.now() + 60_000).toISOString() };
      if (sql.includes("FROM sent")) return opts.hasHistory ? { n: 1 } : null;
      return null;   // known user by chat id
    });
  };

  it("chat_id власника не перевішується на чужий акаунт", async () => {
    linkFlow({ otherId: "owner-row" });
    await post({ update_id: 7, message: { text: "/start tok", chat: { id: 777 } } }, "s3cret");
    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(false);
    expect(sqlCalls(run).some((s) => s.includes("DELETE FROM users"))).toBe(false);
    expect(sendText).toHaveBeenCalledWith("t", 777, "alreadyLinked");
  });

  it("звичайний конфлікт: старий акаунт відв'язується, а не стирається", async () => {
    linkFlow({ otherId: "bot-only-row" });
    await post({ update_id: 8, message: { text: "/start tok", chat: { id: 5 } } }, "s3cret");
    const sql = sqlCalls(run);
    expect(sql.some((s) => s.includes("DELETE FROM users"))).toBe(false);
    expect(sql.some((s) => s.includes("SET telegram_chat_id=NULL"))).toBe(true);
    expect(sql.some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(true);
  });

  it("без конфлікту — просто прив'язує", async () => {
    linkFlow({ otherId: null });
    await post({ update_id: 9, message: { text: "/start tok", chat: { id: 5 } } }, "s3cret");
    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(true);
    expect(sendText).toHaveBeenCalledWith("t", 5, "linked");
  });
});
