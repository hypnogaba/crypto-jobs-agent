import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Живий випадок 31.08: людина тисне «Побажання», пише «комуніті менеджер» —
 * записалось; повертається в меню, пише те саме ще раз — «скористайся
 * кнопками вище». Той самий текст то приймався, то ні, залежно від стану,
 * якого їй ніде не показували.
 *
 * Тести стережуть нове правило: написане людиною ніколи не пропадає, і в
 * підтвердженні названо ПОЛЕ й ЗНАЧЕННЯ, а не саме підтвердження.
 */
const one = vi.fn();
const run = vi.fn();
const sendText = vi.fn();
const callTelegram = vi.fn();
const parseProfile = vi.fn();

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
vi.mock("./parse", () => ({ parseProfile: (...a: unknown[]) => parseProfile(...a) }));

import { handleOnboardingText } from "./bot";
import { emptyDraft } from "./bot-onboarding";

const env = { TELEGRAM_BOT_TOKEN: "t" };
let state: { step: string; draft: string; message_id: number | null } | null;

const empty = () => ({
  spheres: [], industries: [], suggested: { spheres: [], industries: [] },
  remoteMode: null, location: null, salaryMin: null, salaryCurrency: null,
  evidence: {}, leftover: null, customRole: null, customIndustry: null, cvHighlights: null,
});

/** Текст усіх повідомлень, надісланих людині окремо (не в якорі). */
const messages = (): string[] => [
  ...sendText.mock.calls.map((c) => String(c[2] ?? "")),
  ...callTelegram.mock.calls.filter((c) => c[1] === "sendMessage")
    .map((c) => String((c[2] as { text?: string }).text ?? "")),
];

/** Що лягло в profiles останнім записом. */
const profileWrite = () =>
  [...run.mock.calls].reverse().find((c) => String(c[0]).includes("UPDATE profiles SET spheres"));

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset(); parseProfile.mockReset();
  callTelegram.mockImplementation(() => Promise.resolve({ ok: true, result: { message_id: 7 } }));
  state = { step: "edit:spheres", draft: JSON.stringify(emptyDraft()), message_id: 100 };
  one.mockImplementation((sql: string) => {
    if (sql.includes("FROM bot_state")) return Promise.resolve(state);
    if (sql.includes("FROM users WHERE telegram_chat_id")) return Promise.resolve({ id: "u1" });
    if (sql.includes("FROM profiles")) return Promise.resolve(null);
    return Promise.resolve({ delivery_hour: 9 });
  });
});

describe("текст на кроці правки", () => {
  it("«комуніті менеджер» на кроці «Сфери» більше не відхиляється", async () => {
    parseProfile.mockResolvedValue({ ...empty(), customRole: "комуніті менеджер" });
    await handleOnboardingText(env, 1, "комуніті менеджер", "uk");

    expect(messages().join(" ")).not.toContain("Скористайся кнопками");
    expect(profileWrite()).toBeTruthy();
  });

  it("підтвердження називає поле й значення", async () => {
    parseProfile.mockResolvedValue({ ...empty(), customRole: "комуніті менеджер" });
    await handleOnboardingText(env, 1, "комуніті менеджер", "uk");

    const said = messages().join("\n");
    expect(said).toContain("Записав:");
    expect(said).toContain("Своя роль");
    expect(said).toContain("комуніті менеджер");
  });

  it("галочки не стираються — текст ДОПОВНЮЄ вибране зі списку", async () => {
    state = {
      step: "edit:spheres",
      draft: JSON.stringify({ ...emptyDraft(), spheres: ["engineering"] }),
      message_id: 100,
    };
    parseProfile.mockResolvedValue({ ...empty(), spheres: ["devrel"] });
    await handleOnboardingText(env, 1, "хочу в комʼюніті", "uk");

    const spheres = JSON.parse(String(profileWrite()![1]));
    expect(spheres).toContain("engineering");
    expect(spheres).toContain("devrel");
  });

  it("нічого не впізнали — написане йде в побажання, а не в нікуди", async () => {
    parseProfile.mockResolvedValue({ ...empty() });
    await handleOnboardingText(env, 1, "тільки стартапи до 50 людей", "uk");

    const wishes = String(profileWrite()!.at(-2));
    expect(wishes).toBe("тільки стартапи до 50 людей");
  });

  it("надто коротке слово лишається підказкою про кнопки", async () => {
    await handleOnboardingText(env, 1, "ок", "uk");
    expect(parseProfile).not.toHaveBeenCalled();
    expect(messages().join(" ")).toContain("Скористайся кнопками");
  });
});
