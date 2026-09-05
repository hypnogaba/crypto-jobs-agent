import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Єдиний канал зв'язку того, у кого немає акаунта в цьому чаті.
 *
 * Відмова прив'язки (`linkExpired`) тепер каже людині, яка втратила свій
 * Telegram: напиши /feedback. Але команда відскакувала від воріт
 * `handleCommand` разом з усіма іншими — «спершу /start». Тобто порада вела
 * рівно в те коло, з якого людина й не могла вийти: /start у новому чаті
 * заводить НОВИЙ порожній акаунт, а не повертає старий.
 *
 * Ворота потрібні й лишаються: усі решта команд працюють з акаунтом, і без
 * нього впали б на user!.id. Виняток рівно один — і саме він робить пораду
 * з відмови правдою.
 */

const one = vi.fn();
const run = vi.fn();
const sendText = vi.fn();
const callTelegram = vi.fn();

vi.mock("./db", () => ({
  one: (...a: unknown[]) => one(...a),
  run: (...a: unknown[]) => run(...a),
  uuid: () => "uuid-1",
}));
vi.mock("./telegram-send", () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  callTelegram: (...a: unknown[]) => callTelegram(...a),
}));
vi.mock("@/lib/profile-country", () => ({ persistDerived: vi.fn() }));
vi.mock("./parse", () => ({ parseProfile: vi.fn() }));

import { handleCommand, handleOnboardingText } from "./bot";
import { t } from "./bot-copy";

const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_CHAT_ID: "777" };
const said = (): string[] => sendText.mock.calls.map((c) => String(c[2]));
const sqlCalls = (): string[] => run.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  callTelegram.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  // Чат без акаунта: саме той, з якого пише людина, що втратила Telegram.
  one.mockImplementation(async () => null);
});

describe("/feedback у чаті без акаунта", () => {
  it("бот питає, що сталось, а не жене на /start", async () => {
    await handleCommand(env, 5, "/feedback", "uk");

    expect(said()).toContain(t("feedbackAsk", "uk"));
    expect(said()).not.toContain(t("startFirst", "uk"));
    expect(sqlCalls().some((s) => s.includes("INSERT INTO bot_state"))).toBe(true);
  });

  it("написане доїжджає до власника, хоч акаунта й немає", async () => {
    one.mockImplementation(async (sql: string) =>
      String(sql).includes("FROM bot_state")
        ? { step: "feedback", draft: "{}", message_id: null, mode: null }
        : null);

    await handleOnboardingText(env, 5, "втратив доступ до старого телеграма", "uk");

    const insert = run.mock.calls.find((c) => String(c[0]).includes("INSERT INTO site_feedback"));
    expect(insert).toBeDefined();
    // user_id порожній, зате контакт — сам чат: власнику є куди відповісти.
    expect(insert![2]).toBeNull();
    expect(insert![3]).toBe("tg:5");
    expect(sendText).toHaveBeenCalledWith("t", 777, expect.stringContaining("втратив доступ"));
  });

  it("решта команд без акаунта далі відскакує", async () => {
    // Виняток мусить лишитись винятком: /site або /profile без акаунта
    // впали б на user!.id, і ворота — єдине, що їх спиняє.
    for (const cmd of ["/site", "/profile", "/pause"]) {
      sendText.mockReset();
      await handleCommand(env, 5, cmd, "uk");
      expect({ cmd, said: said() }).toEqual({ cmd, said: [t("startFirst", "uk")] });
    }
  });
});
