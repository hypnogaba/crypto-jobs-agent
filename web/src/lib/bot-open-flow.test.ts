import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Розмовний онбординг: перший екран і переходи між режимами.
 *
 * Найважливіше тут — перше питання. Людина бачить рівно один перший екран, і
 * саме він вирішує, чи вона зрозуміє, що можна відповісти словами. Точка
 * входу малювала клавіатуру в обхід `advance`, тож уся перебудова лишалась
 * би невидимою для кожного нового користувача. Тестів на це не було.
 */

const one = vi.fn();
const run = vi.fn();
const sendText = vi.fn();
const callTelegram = vi.fn();
const parseProfile = vi.fn();
const all = vi.fn();

vi.mock("./db", () => ({
  one: (...a: unknown[]) => one(...a),
  run: (...a: unknown[]) => run(...a),
  all: (...a: unknown[]) => all(...a),
  uuid: () => "uuid-1",
}));
vi.mock("./telegram-send", () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  callTelegram: (...a: unknown[]) => callTelegram(...a),
}));
vi.mock("@/lib/profile-country", () => ({ persistDerived: vi.fn() }));
vi.mock("./parse", () => ({ parseProfile: (...a: unknown[]) => parseProfile(...a) }));
vi.mock("./normalize-text", () => ({ normalizeFreeText: async (v: string | null) => v }));
vi.mock("./usage", () => ({ logUsage: vi.fn(), readUsage: vi.fn() }));

import { handleOnboardingButton, handleOnboardingText, startBotOnboarding } from "./bot";

const ANCHOR = 100;
const env = { TELEGRAM_BOT_TOKEN: "t" };

interface Payload {
  message_id?: number; text?: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
}

let state: { step: string; draft: string; message_id: number | null; mode: string } | null;

const sent = (method: string): Payload[] =>
  callTelegram.mock.calls.filter((c) => c[1] === method).map((c) => c[2] as Payload);
const keys = (p: Payload | undefined): string[] =>
  (p?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

/** Режим, записаний останнім INSERT-ом стану. */
const savedMode = (): string | null => {
  const call = [...run.mock.calls].reverse()
    .find((c) => String(c[0]).includes("INSERT INTO bot_state"));
  return call ? String(call[5]) : null;
};

const emptyParse = {
  spheres: [], industries: [], remoteMode: "", location: null,
  salaryMin: null, salaryCurrency: null, evidence: {}, leftover: null,
  customRole: null, customIndustry: null, cvHighlights: null,
};

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  parseProfile.mockReset(); all.mockReset();
  all.mockResolvedValue([]);
  callTelegram.mockImplementation((_t: unknown, method: string, payload: Payload) =>
    Promise.resolve({ ok: true, result: { message_id: method === "sendMessage" ? 555 : payload.message_id } }));
  state = { step: "spheres", draft: JSON.stringify({ spheres: [], industries: [], remoteMode: null }),
            message_id: ANCHOR, mode: "ask" };
  one.mockImplementation((sql: string) => {
    if (sql.includes("FROM bot_state")) return Promise.resolve(state);
    if (sql.includes("FROM users WHERE telegram_chat_id")) return Promise.resolve(null);
    return Promise.resolve(null);
  });
});

describe("перший екран анкети", () => {
  it("питає словами, а не одинадцятьма кнопками", async () => {
    await startBotOnboarding(env as never, 1, "uk");
    const first = sent("sendMessage").at(-1)!;
    expect(first.text).toContain("Яку роботу шукаєш?");
    // Один вихід до списку — і жодної сфери на першому екрані.
    expect(keys(first)).toEqual(["ob:spheres:__list"]);
  });

  it("починається в режимі розмови", async () => {
    await startBotOnboarding(env as never, 1, "uk");
    expect(savedMode()).toBe("ask");
  });
});

describe("відповідь словами", () => {
  it("розібране веде до підтвердження з кнопками «Так»/«Не те»", async () => {
    parseProfile.mockResolvedValue({ ...emptyParse, customRole: "комуніті менеджер", spheres: ["devrel"] });
    await handleOnboardingText(env as never, 1, "комуніті менеджер", "uk");
    const shown = sent("sendMessage").at(-1)!;
    expect(shown.text).toContain("комуніті менеджер");
    expect(keys(shown)).toEqual(["ob:spheres:__yes", "ob:spheres:__no"]);
    expect(savedMode()).toBe("confirm");
  });

  /**
   * Провал серпня 2026 одним тестом: на «тест» бот мовчки зберігав порожній
   * профіль. Тепер нерозібране веде до списку, і бот каже про це вголос.
   */
  it("нерозібране веде до списку, і бот каже про це", async () => {
    parseProfile.mockResolvedValue({ ...emptyParse });
    await handleOnboardingText(env as never, 1, "тест", "uk");
    const shown = sent("sendMessage").at(-1)!;
    expect(shown.text).toContain("Не впізнав");
    expect(keys(shown)).toContain("ob:spheres:engineering");
    expect(savedMode()).toBe("pick");
  });
});

describe("виходи з розмови", () => {
  it("«Показати список» дає сьогоднішню клавіатуру", async () => {
    await handleOnboardingButton(env as never, 1, "ob:spheres:__list", "cb", "uk");
    const shown = [...sent("editMessageText"), ...sent("sendMessage")].at(-1)!;
    expect(keys(shown)).toContain("ob:spheres:engineering");
    expect(savedMode()).toBe("pick");
  });

  it("«Не те» теж дає список, і галочки з розібраного лишаються", async () => {
    state!.draft = JSON.stringify({ spheres: ["devrel"], industries: [], remoteMode: null });
    state!.mode = "confirm";
    await handleOnboardingButton(env as never, 1, "ob:spheres:__no", "cb", "uk");
    const shown = [...sent("editMessageText"), ...sent("sendMessage")].at(-1)!;
    const ticked = (shown.reply_markup?.inline_keyboard ?? []).flat()
      .filter((b) => b.text.startsWith("✓")).map((b) => b.callback_data);
    expect(ticked).toContain("ob:spheres:devrel");
    expect(savedMode()).toBe("pick");
  });

  /**
   * Одна невдача не має вимикати розмову до кінця анкети: наступне ВІДКРИТЕ
   * питання знову питається словами, хоч би як людина пройшла попереднє.
   *
   * Тепер три головні питання йдуть підряд, тож галузь настає одразу за
   * посадою — навіть коли посаду людина обрала кнопками.
   */
  it("наступне відкрите питання знову відкрите, навіть після «pick»", async () => {
    state!.mode = "pick";
    state!.draft = JSON.stringify({ spheres: ["devrel"], industries: [], remoteMode: null });
    await handleOnboardingButton(env as never, 1, "ob:spheres:__next", "cb", "uk");
    const shown = [...sent("editMessageText"), ...sent("sendMessage")].at(-1)!;
    expect(shown.text).toContain("У якій галузі хочеш працювати?");
    expect(keys(shown)).toEqual(["ob:industries:__next", "ob:industries:__list"]);
    expect(savedMode()).toBe("ask");
  });
});
