import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Правка профілю в чаті — одне повідомлення.
 *
 * Раніше кожен дотик слав нове: меню, питання, підтвердження, і назад до меню
 * вела лише команда /profile — тобто ще одне повідомлення. Ці тести стережуть
 * протилежне: усе, що можна, переписується в тому самому повідомленні, а вийти
 * з питання можна кнопкою.
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

import { handleEditButton } from "./bot";

const ANCHOR = 100;
const env = { TELEGRAM_BOT_TOKEN: "t" };

interface Payload { message_id?: number; text?: string; reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } }

let state: { step: string; draft: string; message_id: number | null } | null;

const sent = (method: string): Payload[] =>
  callTelegram.mock.calls.filter((c) => c[1] === method).map((c) => c[2] as Payload);

const keys = (p: Payload): string[] =>
  (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

const savedState = (): { step: string; messageId: number | null } | null => {
  const call = [...run.mock.calls].reverse().find((c) => String(c[0]).includes("INSERT INTO bot_state"));
  return call ? { step: String(call[2]), messageId: call[4] as number | null } : null;
};

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  callTelegram.mockImplementation((_t: unknown, method: string, payload: Payload) =>
    Promise.resolve({ ok: true, result: { message_id: method === "sendMessage" ? 555 : payload.message_id } }));
  state = { step: "edit:menu", draft: JSON.stringify({ spheres: ["qa"], industries: [] }), message_id: ANCHOR };
  one.mockImplementation((sql: string) => {
    if (sql.includes("FROM users WHERE telegram_chat_id")) return Promise.resolve({ id: "u1" });
    if (sql.includes("FROM bot_state")) return Promise.resolve(state);
    if (sql.includes("FROM profiles")) return Promise.resolve({
      spheres: '["qa"]', industries: "[]", seniority: "middle", remote_mode: "remote_only",
      location: null, salary_min: null, salary_currency: null,
      custom_role: null, custom_industry: null, custom_seniority: null, wishes: null,
    });
    return Promise.resolve({ delivery_hour: 9 });
  });
});

describe("правка по пунктах живе в одному повідомленні", () => {
  it("пункт меню перепису́є той самий якір, а не шле нове", async () => {
    await handleEditButton(env, 1, "ed:spheres", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(0);
    expect(sent("editMessageText")).toHaveLength(1);
    expect(sent("editMessageText")[0]!.message_id).toBe(ANCHOR);
    expect(savedState()).toEqual({ step: "edit:spheres", messageId: ANCHOR });
  });

  it("під питанням є «Назад»", async () => {
    await handleEditButton(env, 1, "ed:spheres", "cb", "uk");
    const rows = sent("editMessageText")[0]!.reply_markup!.inline_keyboard;
    expect(rows[rows.length - 1]).toEqual([{ text: "← Назад", callback_data: "ed:back" }]);
  });

  it("лічильника «1 з 4» у правці одного поля немає", async () => {
    await handleEditButton(env, 1, "ed:spheres", "cb", "uk");
    expect(sent("editMessageText")[0]!.text).not.toContain("1 з 4");
    expect(sent("editMessageText")[0]!.text).toContain("Яка робота?");
  });

  it("«Назад» повертає меню в те саме повідомлення й нічого не пише", async () => {
    state = { step: "edit:spheres", draft: state!.draft, message_id: ANCHOR };
    await handleEditButton(env, 1, "ed:back", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(0);
    const edit = sent("editMessageText")[0]!;
    expect(edit.message_id).toBe(ANCHOR);
    expect(keys(edit)).toContain("ed:spheres");
    expect(run.mock.calls.map((c) => String(c[0])).some((s) => s.includes("UPDATE profiles"))).toBe(false);
    expect(savedState()).toEqual({ step: "edit:menu", messageId: ANCHOR });
  });

  it("після запису поля меню повертається саме — без /profile", async () => {
    state = { step: "edit:seniority", draft: state!.draft, message_id: ANCHOR };
    await handleEditButton(env, 1, "ed:seniority:senior", "cb", "uk");
    expect(run.mock.calls.map((c) => String(c[0])).some((s) => s.includes("UPDATE profiles"))).toBe(true);
    expect(sent("sendMessage")).toHaveLength(0);
    const edit = sent("editMessageText").at(-1)!;
    expect(edit.message_id).toBe(ANCHOR);
    expect(keys(edit)).toContain("ed:salary");
    expect(savedState()).toEqual({ step: "edit:menu", messageId: ANCHOR });
  });

  it("«Немає в списку» просить текст у тому самому якорі, зі «Назад»", async () => {
    state = { step: "edit:spheres", draft: state!.draft, message_id: ANCHOR };
    await handleEditButton(env, 1, "ed:spheres:__mine", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(0);
    expect(keys(sent("editMessageText")[0]!)).toEqual(["ed:back"]);
    expect(savedState()).toEqual({ step: "editown:spheres", messageId: ANCHOR });
  });

  it("галочка перемальовує те саме повідомлення", async () => {
    state = { step: "edit:spheres", draft: state!.draft, message_id: ANCHOR };
    await handleEditButton(env, 1, "ed:spheres:design", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(0);
    expect(JSON.parse(String(run.mock.calls.find((c) => String(c[0]).includes("INSERT INTO bot_state"))![3])).spheres)
      .toEqual(["qa", "design"]);
  });

  it("якір, який Telegram уже не дає правити, замінюється новим", async () => {
    callTelegram.mockImplementation((_t: unknown, method: string) =>
      Promise.resolve(method === "editMessageText"
        ? { ok: false, description: "Bad Request: message to edit not found" }
        : { ok: true, result: { message_id: 555 } }));
    await handleEditButton(env, 1, "ed:spheres", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(1);
    expect(savedState()).toEqual({ step: "edit:spheres", messageId: 555 });
  });

  it("«не змінилось» другим дотиком не породжує другого повідомлення", async () => {
    callTelegram.mockImplementation((_t: unknown, method: string) =>
      Promise.resolve(method === "editMessageText"
        ? { ok: false, description: "Bad Request: message is not modified" }
        : { ok: true, result: { message_id: 555 } }));
    await handleEditButton(env, 1, "ed:back", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(0);
  });

  it("дотик зі старої клавіатури не мовчить, а показує питання заново", async () => {
    state = null;
    await handleEditButton(env, 1, "ed:spheres:design", "cb", "uk");
    expect(sent("sendMessage")).toHaveLength(1);
    expect(savedState()).toEqual({ step: "edit:spheres", messageId: 555 });
  });
});

describe("клавіатура анкети зі старого повідомлення", () => {
  it("не завершує анкету, коли відкрите меню правки", async () => {
    const { handleOnboardingButton } = await import("./bot");
    await handleOnboardingButton(env, 1, "ob:spheres:design", "cb", "uk");
    expect(run.mock.calls.map((c) => String(c[0])).some((s) => s.includes("INSERT INTO profiles"))).toBe(false);
    expect(sent("sendMessage")).toHaveLength(0);
  });
});
