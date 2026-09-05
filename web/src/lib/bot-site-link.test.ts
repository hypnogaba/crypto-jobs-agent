import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Разове посилання входу не має бути видно в чаті.
 *
 * Власник надіслав скриншот повідомлення від /site, і 32 шістнадцяткові
 * символи токена читалися з нього так само добре, як із власного екрана.
 * Токен відмикає кабінет на 30 днів, тобто скриншот у переписці чи чужий
 * погляд через плече коштували акаунта.
 *
 * Тести нижче стережуть саме поведінку, а не тексти: у ТІЛІ повідомлення
 * адреси немає взагалі, вона живе в кнопці (inline_keyboard, поле url), і в
 * кнопці стоїть той самий токен, дайджест якого щойно ліг у базу.
 *
 * Тестів на sendSiteLink не було зовсім, тому й не помітили, що найдорожче
 * посилання в системі (/admin, вхід у панель власника) їде голим текстом.
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

import { handleCommand, sendSiteLink } from "./bot";
import { hashConnectToken } from "./connect-token";
import { t } from "./bot-copy";

const ADMIN = 777;
const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_CHAT_ID: String(ADMIN) };

interface Payload {
  text?: string;
  reply_markup?: { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] };
}

const messages = (): Payload[] =>
  callTelegram.mock.calls.filter((c) => c[1] === "sendMessage").map((c) => c[2] as Payload);

/**
 * УСЕ, що поїхало в чат, обома шляхами.
 *
 * Дивитись лише на callTelegram недосить: старий код слав це повідомлення
 * через sendText, і перевірка «в тексті немає токена» була б зелена просто
 * тому, що не бачила самого повідомлення.
 */
const chatText = (): string => [
  ...sendText.mock.calls.map((c) => String(c[2] ?? "")),
  ...messages().map((m) => m.text ?? ""),
].join("\n");

/** Кнопка останнього надісланого повідомлення. */
const button = (): { text: string; url?: string } | undefined =>
  messages().at(-1)?.reply_markup?.inline_keyboard[0]?.[0];

/** Дайджест, який поїхав у базу останнім карбуванням токена. */
const savedHash = (): string | null => {
  const call = [...run.mock.calls].reverse()
    .find((c) => String(c[0]).includes("connect_token_hash=?"));
  return call ? String(call[1]) : null;
};

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  callTelegram.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  one.mockImplementation(async (sql: string) =>
    String(sql).includes("FROM users WHERE telegram_chat_id=?")
      ? { id: "u1", status: "active" }
      : null);
});

describe("/site", () => {
  it("у тілі повідомлення немає ні токена, ні адреси", async () => {
    await handleCommand(env, 5, "/site", "uk");
    expect(chatText()).not.toContain("token=");
    expect(chatText()).not.toContain("http");
  });

  it("посилання їде кнопкою", async () => {
    await handleCommand(env, 5, "/site", "uk");
    expect(button()?.url).toMatch(/^https:\/\/nextrole\.info\/enter\?token=[0-9a-f]{32}$/);
  });

  it("у кнопці той самий токен, дайджест якого ліг у базу", async () => {
    await handleCommand(env, 5, "/site", "uk");
    const token = /token=([0-9a-f]{32})/.exec(button()?.url ?? "")?.[1];
    expect(token).toBeTruthy();
    // Призначення входить у дайджест: якщо колись поїде "link", вхід
    // мовчки перестане працювати, і симптомом буде «посилання не діє».
    expect(savedHash()).toBe(await hashConnectToken("enter", token!));
  });

  it("підпис кнопки залежить від вступу: кабінет і просто вхід не злились", async () => {
    await sendSiteLink(env, 5, "u1", "uk", "cabinet");
    expect(button()?.text).toBe(t("openCabinet", "uk"));
    expect(button()?.text).not.toBe(t("openSite", "uk"));
  });

  it("вступ про кабінет так само не несе адреси в тілі", async () => {
    // Другий вступ їде окремим викликом, тож перевірка вище його не бачить.
    // Дивимось на справжнє повідомлення, а не на словник: так само ловиться
    // адреса, зібрана в коді повз bot-copy.
    await sendSiteLink(env, 5, "u1", "uk", "cabinet");
    expect(chatText()).not.toContain("http");
    expect(chatText()).not.toContain("token=");
  });
});

describe("/admin", () => {
  it("веде просто в панель, і токена в тексті немає", async () => {
    await handleCommand(env, ADMIN, "/admin", "uk");
    expect(button()?.url).toMatch(/^https:\/\/nextrole\.info\/enter\?token=[0-9a-f]{32}&to=\/admin$/);
    expect(chatText()).not.toContain("token=");
  });

  it("чужому чату не карбує токена й не показує кнопки", async () => {
    await handleCommand(env, 5, "/admin", "uk");
    expect(savedHash()).toBeNull();
    expect(messages().some((m) => m.reply_markup)).toBe(false);
  });
});
