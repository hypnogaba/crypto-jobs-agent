import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Резюме, надіслане ПОСЕРЕД анкети, не має стирати відповіді.
 *
 * `handleDocument` писав профіль із самого лише резюме й видаляв bot_state.
 * Під час анкети відповіді лежать у чернетці, а не в `profiles`, тож захист
 * «резюме доповнює, а не стирає» (він звіряється з `profiles`) їх не бачив:
 * людина, яка відповіла на всі питання й надіслала CV, лишалась із профілем
 * лише з резюме.
 *
 * Досі це майже не траплялось, бо про можливість надіслати CV анкета не
 * казала жодним словом. Останнє питання тепер каже — тож вада стає видимою.
 */

const one = vi.fn();
const run = vi.fn();
const sendText = vi.fn();
const callTelegram = vi.fn();
const parseProfile = vi.fn();

vi.mock("./db", () => ({
  one: (...a: unknown[]) => one(...a),
  run: (...a: unknown[]) => run(...a),
  all: vi.fn().mockResolvedValue([]),
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
vi.mock("./cv", () => ({
  extractCvText: async () => "Rust, 5 років, англійська C1",
  CvError: class CvError extends Error {},
}));

import { handleDocument } from "./bot";

const env = { TELEGRAM_BOT_TOKEN: "t" };

/** Запит, яким профіль ліг у базу, і його параметри. */
const profileWrite = (): unknown[] | null => {
  const call = [...run.mock.calls].reverse().find((c) => String(c[0]).includes("INTO profiles"));
  return call ? (call as unknown[]) : null;
};

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  parseProfile.mockReset();
  callTelegram.mockImplementation(() => Promise.resolve({ ok: true, result: { message_id: 1 } }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("getFile")) {
      return new Response(JSON.stringify({ result: { file_path: "docs/cv.pdf" } }));
    }
    return new Response("cv bytes");
  }));
  // Резюме розповідає про стек, але мовчить про місто, гроші й галузь.
  parseProfile.mockResolvedValue({
    spheres: [], industries: [], remoteMode: "", location: null,
    salaryMin: null, salaryCurrency: null, evidence: {}, leftover: null,
    customRole: null, customIndustry: null, cvHighlights: "Rust, 5 років, англійська C1",
  });
});

describe("резюме посеред анкети", () => {
  it("не стирає відповідей, які лежать у чернетці", async () => {
    // Людина дійшла до останнього питання й відповіла на всі попередні.
    one.mockImplementation((sql: string) => {
      if (sql.includes("FROM bot_state")) {
        return Promise.resolve({
          step: "extra", mode: "ask", message_id: 100,
          draft: JSON.stringify({
            spheres: ["devrel"], industries: ["web3"], customRole: "комуніті менеджер",
            remoteMode: "remote_only", location: "Берлін", salaryMin: 36000, salaryCurrency: "EUR",
          }),
        });
      }
      if (sql.includes("FROM users WHERE telegram_chat_id")) return Promise.resolve(null);
      if (sql.includes("FROM profiles")) return Promise.resolve(null);
      return Promise.resolve({ delivery_hour: 9 });
    });

    await handleDocument(env as never, 1, "file-1", "cv.pdf", "uk");

    const w = profileWrite();
    expect(w, "профіль мусить бути записаний").not.toBeNull();
    const params = w!.slice(1).map((v) => (typeof v === "string" ? v : String(v)));
    const joined = params.join(" | ");
    expect(joined, "роль із анкети").toContain("комуніті менеджер");
    expect(joined, "сфера з анкети").toContain("devrel");
    expect(joined, "галузь з анкети").toContain("web3");
    expect(joined, "місто з анкети").toContain("Берлін");
    expect(joined, "витяг із резюме").toContain("Rust");
  });
});
