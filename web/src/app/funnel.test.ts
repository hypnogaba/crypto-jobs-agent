import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Наскрізний шлях реєстрації з сайту, від другого кроку до акаунта.
 *
 * Це єдиний тест у проєкті, який проходить лійку цілком, і він з'явився не з
 * любові до тестів. 02.09 цей шлях переписали так, що акаунт народжується вже
 * не на сайті, а в мить, коли бот приймає токен, — і перевірити це можна було
 * лише руками через браузер. Помилка тут не падає й не світиться в журналі:
 * людина просто заповнює анкету й нічого не отримує.
 *
 * Тому тест стереже рівно дві обіцянки, обидві невидимі зсередини коду:
 *   1. анкета з сайту НЕ створює акаунта;
 *   2. той самий токен у боті створює акаунт із того, що вона написала.
 */

const rows: Array<{ sql: string; params: unknown[] }> = [];
const store = new Map<string, Record<string, unknown>>();
const jar = new Map<string, string>();

vi.mock("@/lib/db", () => ({
  run: async (sql: string, ...params: unknown[]) => {
    rows.push({ sql, params });
    if (sql.includes("INSERT INTO pending_signups")) {
      const [id, token, locale, timezone, profile, rawInput, source] = params as string[];
      store.set(id!, { id, token, locale, timezone, profile, raw_input: rawInput,
                       source, claimed_user_id: null });
    }
  },
  one: async (sql: string, ...params: unknown[]) => {
    if (sql.includes("FROM pending_signups")) {
      const key = String(params[0]);
      return [...store.values()].find((r) => r.id === key || r.token === key) ?? null;
    }
    return null;                                  // цього chat_id ще немає
  },
  all: async () => [],
  uuid: () => `id-${store.size + 1}`,
}));

const redirected: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { redirected.push(to); throw new Error("REDIRECT"); },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => { jar.set(k, v); },
    delete: (k: string) => { jar.delete(k); },
  }),
  headers: async () => new Map([["cf-connecting-ip", "1.2.3.4"]]),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {}, cf: { timezone: "Europe/Paris" } }),
}));
vi.mock("@/lib/auth", () => ({
  currentUser: async () => null,
  createSession: vi.fn(),
  destroySession: vi.fn(),
  requireUser: async () => { throw new Error("не має викликатись"); },
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRate: async () => ({ allowed: true }),
  recordFailure: vi.fn(),
  ONBOARD_LIMITS: {}, FEEDBACK_LIMITS: {},
}));
const persistProfile = vi.fn();
vi.mock("@/lib/profile-write", () => ({ persistProfile: (...a: unknown[]) => persistProfile(...a) }));
vi.mock("@/lib/telegram-send", () => ({ sendText: vi.fn() }));

import { saveProfile } from "./actions";
import { claimPending } from "@/lib/pending";

const form = (): FormData => {
  const f = new FormData();
  f.append("spheres", "devrel");
  f.append("industries", "web3");
  f.set("customRole", "community manager");
  f.set("remoteMode", "remote_only");
  f.set("salaryMin", "3000");
  f.set("salaryCurrency", "EUR");
  f.set("locale", "uk");
  f.set("timezone", "Europe/Kyiv");
  return f;
};

const run = async (fn: () => Promise<unknown>): Promise<void> => {
  try { await fn(); } catch (e) {
    if (!(e instanceof Error) || e.message !== "REDIRECT") throw e;
  }
};

beforeEach(() => {
  rows.length = 0; store.clear(); jar.clear(); redirected.length = 0; persistProfile.mockReset();
  // Мову ставить перший крок анкети, і до другого вона вже в куці. Без цього
  // рядка ми б перевіряли шлях, якого в житті не буває.
  jar.set("nr_locale", "uk");
});

describe("лійка: сайт → бот → акаунт", () => {
  it("другий крок кладе анкету в очікування й НЕ створює акаунта", async () => {
    await run(() => saveProfile(form()));

    expect(rows.some((r) => r.sql.includes("INSERT INTO users"))).toBe(false);
    expect(persistProfile).not.toHaveBeenCalled();

    const pending = [...store.values()][0]!;
    expect(JSON.parse(String(pending.profile))).toMatchObject({
      spheres: ["devrel"], industries: ["web3"], customRole: "community manager",
    });
    // Кука несе ідентифікатор анкети, а не токен: токен людина носить у
    // Telegram і може переслати, кука лишається в браузері.
    expect(jar.get("nr_pending")).toBe(pending.id);
    expect(jar.get("nr_pending")).not.toBe(pending.token);
    expect(redirected).toEqual(["/telegram"]);
  });

  it("той самий токен у боті створює акаунт із написаного", async () => {
    await run(() => saveProfile(form()));
    const pending = [...store.values()][0]!;

    const claimed = await claimPending(String(pending.token), "555");

    expect(claimed).toMatchObject({ locale: "uk", fresh: true });
    expect(rows.some((r) => r.sql.includes("INSERT INTO users"))).toBe(true);
    expect(persistProfile).toHaveBeenCalledWith(
      claimed!.userId, expect.anything(), "freetext",
      expect.objectContaining({ customRole: "community manager" }));
  });

  it("чужий токен не створює нічого", async () => {
    await run(() => saveProfile(form()));
    expect(await claimPending("не-той-токен", "555")).toBeNull();
    expect(rows.some((r) => r.sql.includes("INSERT INTO users"))).toBe(false);
  });
});
