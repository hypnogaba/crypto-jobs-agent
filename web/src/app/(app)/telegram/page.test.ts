import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Сторінка 03/03 карбувала разовий токен ПІД ЧАС РЕНДЕРУ.
 *
 * Поки в базі лежав сам токен, це було майже нешкідливо: живий рядок
 * перечитувався, і посилання діяло всі свої 15 хвилин. Після хешування
 * перечитати його неможливо (з дайджесту токен не дістати), тож кожен новий
 * показ сторінки гасив той токен, який людина щойно віднесла в бота: вона
 * тисне «Так» і бачить «посилання не працює». Досить було оновити вкладку,
 * повернутись «назад», або отримати ще один рендер від самого Next.
 *
 * Друга ціна — запис у D1 на КОЖЕН перегляд сторінки, а обмежує нас саме
 * запис (0044).
 *
 * Тому перевіряємо поведінку, а не форму: рендер не пише в базу взагалі, і
 * готового посилання з токеном на сторінці немає — воно народжується вже в
 * дії, у мить дотику.
 */

const one = vi.fn();
const run = vi.fn();
const currentUser = vi.fn();

vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));
vi.mock("@/lib/auth", () => ({ currentUser: () => currentUser() }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { TELEGRAM_BOT_USERNAME: "nr_bot" } }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/pending", () => ({ PENDING_COOKIE: "nr_pending", pendingById: async () => null }));

/**
 * Дії підмінені: сторінка мусить лише ПОКЛАСТИ їх у форму, а не виконати.
 * Саме та сама функція, без обгортки, — інакше перевірка «у формі стоїть
 * дія» звірялася б із анонімною стрілкою й нічого не стерегла.
 */
const { connectTelegram } = vi.hoisted(() => ({ connectTelegram: vi.fn() }));
vi.mock("@/app/actions", () => ({
  detectLocale: async () => "uk",
  connectTelegram,
  finishPending: vi.fn(),
}));

import Telegram from "./page";

/** Усе, що сторінка віддала: і текст, і значення props (адреси, дії). */
const flatten = (node: unknown, out: unknown[] = []): unknown[] => {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out; }
  if (typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) for (const v of Object.values(props)) { out.push(v); flatten(v, out); }
    return out;
  }
  out.push(node);
  return out;
};

const render = async (): Promise<unknown[]> =>
  flatten(await Telegram({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  one.mockReset(); run.mockReset(); currentUser.mockReset(); connectTelegram.mockReset();
  one.mockResolvedValue(null);
  currentUser.mockResolvedValue({
    id: "u1", email: null, telegramChatId: null, locale: "uk",
    status: "active", timezone: "Europe/Kyiv", isAdmin: false,
  });
});

describe("сторінка підключення Telegram", () => {
  it("рендер не пише в базу", async () => {
    await render();
    expect(run).not.toHaveBeenCalled();
  });

  it("готового посилання з токеном на сторінці немає", async () => {
    const parts = await render().then((p) => p.map(String));
    expect(parts.some((s) => s.includes("t.me/") && /start=[0-9a-f]{16,}/.test(s))).toBe(false);
  });

  it("кнопка підключення — це дія, а не адреса", async () => {
    // Дія стоїть у формі саме тією функцією, яку карбування й робить: інакше
    // кнопка знову вела б на посилання, зроблене наперед.
    expect(await render()).toContain(connectTelegram);
  });

  it("акаунту з прив'язаним Telegram нічого не карбує", async () => {
    currentUser.mockResolvedValue({
      id: "u1", email: null, telegramChatId: "555", locale: "uk",
      status: "active", timezone: "Europe/Kyiv", isAdmin: false,
    });
    one.mockResolvedValue({ timezone: "Europe/Kyiv", delivery_hour: 9 });

    await render();

    expect(run).not.toHaveBeenCalled();
  });
});
