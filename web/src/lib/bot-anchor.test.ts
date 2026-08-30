import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Питання не має лишатися вище власного повідомлення людини.
 *
 * Живий прогін: людина тисне «Немає в списку», бот шле окреме повідомлення
 * «напиши свою роль» без кнопок, вона пише «Комуніті менеджер» — і в чаті не
 * змінюється нічого, бо бот переписав ЯКІР, який її ж текст щойно виштовхнув
 * угору за екран. Вона написала те саме вдруге, і другий раз ліг у побажання.
 *
 * Ці тести стережуть протилежне: після кожної текстової відповіді питання
 * з'являється НОВИМ повідомленням унизу, старе лишається без кнопок, а
 * написане повертається людині словами.
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

import { handleOnboardingButton, handleOnboardingText } from "./bot";

const ANCHOR = 100;
const NEW_MSG = 555;
const env = { TELEGRAM_BOT_TOKEN: "t" };

interface Payload {
  message_id?: number; text?: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
}

let state: { step: string; draft: string; message_id: number | null } | null;

const sent = (method: string): Payload[] =>
  callTelegram.mock.calls.filter((c) => c[1] === method).map((c) => c[2] as Payload);

const keys = (p: Payload | undefined): string[] =>
  (p?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

/** Останній запис стану: крок і повідомлення, яке стало якорем. */
const savedState = (): { step: string; messageId: number | null } | null => {
  const call = [...run.mock.calls].reverse()
    .find((c) => String(c[0]).includes("bot_state") && !String(c[0]).startsWith("DELETE"));
  if (!call) return null;
  const sql = String(call[0]);
  return sql.includes("INSERT INTO bot_state")
    ? { step: String(call[1 + 1]), messageId: call[4] as number | null }
    : { step: String(call[1]), messageId: call[2] as number | null };
};

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  callTelegram.mockImplementation((_t: unknown, method: string, payload: Payload) =>
    Promise.resolve({ ok: true, result: { message_id: method === "sendMessage" ? NEW_MSG : payload.message_id } }));
  state = {
    step: "spheres",
    draft: JSON.stringify({ spheres: ["sales"], industries: [], remoteMode: null }),
    message_id: ANCHOR,
  };
  one.mockImplementation((sql: string) => {
    if (sql.includes("FROM bot_state")) return Promise.resolve(state);
    if (sql.includes("FROM users WHERE telegram_chat_id")) return Promise.resolve({ id: "u1" });
    return Promise.resolve({ delivery_hour: 9 });
  });
});

describe("«Немає в списку» в анкеті", () => {
  it("просить текст новим повідомленням, і саме воно стає якорем", async () => {
    await handleOnboardingButton(env, 1, "ob:spheres:__mine", "cb", "uk");

    const asked = sent("sendMessage");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.text).toContain("своїми словами");
    expect(savedState()).toEqual({ step: "own:spheres", messageId: NEW_MSG });
  });

  it("під проханням лишаються ті самі кнопки — можна передумати дотиком", async () => {
    await handleOnboardingButton(env, 1, "ob:spheres:__mine", "cb", "uk");
    expect(keys(sent("sendMessage")[0])).toContain("ob:spheres:__mine");
  });

  it("зі старого повідомлення кнопки знімаються: жива клавіатура рівно одна", async () => {
    await handleOnboardingButton(env, 1, "ob:spheres:__mine", "cb", "uk");
    const cleared = sent("editMessageReplyMarkup");
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.message_id).toBe(ANCHOR);
    expect(keys(cleared[0])).toEqual([]);
  });
});

describe("написане своїми словами", () => {
  beforeEach(() => {
    state = {
      step: "own:spheres",
      draft: JSON.stringify({ spheres: ["sales"], industries: [], remoteMode: null }),
      message_id: ANCHOR,
    };
  });

  it("повертається людині словами, а не мовчки зберігається", async () => {
    await handleOnboardingText(env, 1, "Комуніті менеджер", "uk");
    expect(sent("sendMessage")[0]!.text).toContain("Комуніті менеджер");
  });

  it("наступне питання йде вниз, а не в старий якір", async () => {
    await handleOnboardingText(env, 1, "Комуніті менеджер", "uk");
    expect(sent("editMessageText")).toHaveLength(0);
    expect(sent("sendMessage")).toHaveLength(1);
    expect(savedState()?.messageId).toBe(NEW_MSG);
  });

  it("кнопки під ним є, і «Немає в списку» стоїть із галочкою", async () => {
    await handleOnboardingText(env, 1, "Комуніті менеджер", "uk");
    const p = sent("sendMessage")[0]!;
    expect(keys(p)).toContain("ob:spheres:__next");
    const mine = (p.reply_markup?.inline_keyboard ?? []).flat()
      .find((b) => b.callback_data === "ob:spheres:__mine");
    expect(mine?.text.startsWith("✓")).toBe(true);
  });
});

describe("місто", () => {
  beforeEach(() => {
    state = {
      step: "city",
      draft: JSON.stringify({ spheres: ["sales"], industries: [], remoteMode: "remote_or_city" }),
      message_id: ANCHOR,
    };
  });

  it("підтверджується й веде до наступного питання новим повідомленням", async () => {
    await handleOnboardingText(env, 1, "Париж", "uk");
    const p = sent("sendMessage");
    expect(p).toHaveLength(1);
    expect(p[0]!.text).toContain("Париж");
    expect(savedState()).toEqual({ step: "salary", messageId: NEW_MSG });
  });
});

describe("«Інша сума»", () => {
  it("отримує власний крок, інакше суму перехоплює розбір вільного тексту", async () => {
    state = {
      step: "salary",
      draft: JSON.stringify({ spheres: ["sales"], industries: [], remoteMode: "remote_only" }),
      message_id: ANCHOR,
    };
    await handleOnboardingButton(env, 1, "ob:salary:__other", "cb", "uk");
    const wrote = run.mock.calls.some((c) => String(c[0]).includes("step='salaryother'"));
    expect(wrote).toBe(true);
  });
});
