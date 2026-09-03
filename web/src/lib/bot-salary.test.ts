import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Бот питає зарплату на МІСЯЦЬ, база зберігає РІЧНУ.
 *
 * Раніше бот питав річну, а сайт місячну — те саме питання в одну колонку,
 * але з різними одиницями виміру залежно від того, звідки прийшла людина.
 * Тепер питання одне; ціна цього — перехід у трьох місцях бота, і саме він
 * тут закріплений. Помилка на 12 разів мовчазна: людина не бачить, що їй
 * перестали приходити вакансії.
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
import { keyboard, summary, emptyDraft } from "./bot-onboarding";

const env = { TELEGRAM_BOT_TOKEN: "t" };

let state: { step: string; draft: string; message_id: number | null } | null;

/** Зарплата, яка лягла в profiles останнім записом. */
const writtenSalary = (): number | null => {
  const call = [...run.mock.calls].reverse().find((c) => String(c[0]).includes("salary_min"));
  if (!call) return null;
  const sql = String(call[0]);
  const params = call.slice(1);
  // INSERT ... VALUES перелічує стовпці; правка одного поля — «SET salary_min=?».
  if (sql.includes("SET salary_min=?")) return params[0] as number | null;
  const cols = /\(([^)]*)\)\s*VALUES/.exec(sql.replace(/\s+/g, " "));
  const names = (cols?.[1] ?? "").split(",").map((c) => c.trim());
  const at = names.indexOf("salary_min");
  return at < 0 ? null : (params[at] as number | null);
};

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); callTelegram.mockReset();
  callTelegram.mockImplementation(() => Promise.resolve({ ok: true, result: { message_id: 1 } }));
  state = {
    step: "salary",
    draft: JSON.stringify({ ...emptyDraft(), spheres: ["sales"] }),
    message_id: 100,
  };
  one.mockImplementation((sql: string) => {
    if (sql.includes("FROM bot_state")) return Promise.resolve(state);
    if (sql.includes("FROM users WHERE telegram_chat_id")) return Promise.resolve({ id: "u1" });
    if (sql.includes("FROM profiles")) return Promise.resolve(null);
    return Promise.resolve({ delivery_hour: 9 });
  });
});

describe("кнопки зарплати", () => {
  it("підписані на місяць", () => {
    const texts = keyboard("salary", emptyDraft(), "uk").flat().map((b) => b.text);
    expect(texts.some((x) => x.includes("міс"))).toBe(true);
    expect(texts.some((x) => x.includes("рік"))).toBe(false);
  });

  /**
   * Після зарплати анкета вже не закінчується: за нею стоїть останнє
   * питання про досвід і резюме. Профіль лягає в базу після нього, тож
   * пропускаємо його, щоб дійти до запису.
   */
  const finish = async () => {
    // Чернетку переносимо з останнього запису стану: підробка бази сама її
    // не оновлює, тож без цього друге натискання побачило б порожній профіль.
    const saved = [...run.mock.calls].reverse()
      .find((c) => String(c[0]).includes("INSERT INTO bot_state"));
    state = { step: "extra", draft: String(saved![3]), message_id: 100 };
    await handleOnboardingButton(env, 1, "ob:extra:__next", "cb", "uk");
  };

  it("дотик по «€3k / міс» кладе в базу річну — 36 000", async () => {
    await handleOnboardingButton(env, 1, "ob:salary:3000", "cb", "uk");
    await finish();
    expect(writtenSalary()).toBe(36_000);
  });

  it("«не важливо» лишається порожнім, а не нулем, помноженим на 12", async () => {
    await handleOnboardingButton(env, 1, "ob:salary:0", "cb", "uk");
    await finish();
    expect(writtenSalary()).toBeNull();
  });
});

describe("написана сума", () => {
  beforeEach(() => {
    state = { step: "salaryother", draft: JSON.stringify({ ...emptyDraft(), spheres: ["sales"] }), message_id: 100 };
  });

  it("«3000 EUR» — це місяць, у базу йде 36 000", async () => {
    await handleOnboardingText(env, 1, "3000 EUR", "uk");
    expect(writtenSalary()).toBe(36_000);
  });
});

describe("підсумок", () => {
  it("повертає людині ту саму міру, якою питали", () => {
    const draft = { ...emptyDraft(), spheres: ["sales"], salaryMin: 36_000, salaryCurrency: "EUR" };
    // toLocaleString ставить нерозривний пробіл — рівняємо його до звичайного,
    // інакше тест міряв би розділювач розрядів, а не суму.
    const out = summary(draft, "uk").replace(/\u00a0/g, " ");
    expect(out).toContain("3 000 EUR / міс");
    expect(out).not.toContain("36 000");
  });
});
