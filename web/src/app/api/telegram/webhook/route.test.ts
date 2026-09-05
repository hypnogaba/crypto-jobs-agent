import { describe, expect, it, vi, beforeEach } from "vitest";

const one = vi.fn();
const run = vi.fn();
const sendText = vi.fn();
const callTelegram = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true, result: {} }));
const checkRate = vi.fn();
const recordFailure = vi.fn();
let env: Record<string, string | undefined> = {};

vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));
vi.mock("@/lib/telegram-send", () => ({ sendText: (...a: unknown[]) => sendText(...a), callTelegram: (...a: unknown[]) => callTelegram(...a) }));
vi.mock("@/lib/ratelimit", () => ({
  WEBHOOK_401_LIMITS: {}, checkRate: (...a: unknown[]) => checkRate(...a), recordFailure: (...a: unknown[]) => recordFailure(...a),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env }) }));
const sendSiteLink = vi.fn();
const sendFirstOffer = vi.fn();
const claimPending = vi.fn();

vi.mock("@/lib/bot", () => ({
  handleCommand: vi.fn(), startBotOnboarding: vi.fn(), continueBotOnboarding: vi.fn(),
  handleOnboardingButton: vi.fn(), handleOnboardingText: vi.fn(), handleWhyButton: vi.fn(),
  handleDocument: vi.fn(), handleDeleteButton: vi.fn(), handleEditButton: vi.fn(),
  handleLangButton: vi.fn(), handleStartButton: vi.fn(), handleFirstButton: vi.fn(),
  // Були відсутні в моці, хоча маршрут їх імпортує: виклик падав би на
  // undefined усередині try/catch, і перевірка «посилання входу не поїхало»
  // виявилась би зеленою, нічого не перевіряючи.
  sendSiteLink: (...a: unknown[]) => sendSiteLink(...a),
  sendFirstOffer: (...a: unknown[]) => sendFirstOffer(...a),
}));
vi.mock("@/lib/pending", () => ({ claimPending: (...a: unknown[]) => claimPending(...a) }));
vi.mock("@/lib/bot-onboarding", () => ({ freeTextAction: () => "hint" }));
vi.mock("@/lib/i18n", () => ({ isLocale: (l: string) => ["en", "uk"].includes(l) }));
vi.mock("@/lib/bot-copy", () => ({ t: (k: string) => k, tf: (k: string) => k }));

const post = async (body: unknown, secret?: string) => {
  const { POST } = await import("./route");
  return POST(new Request("https://nextrole.info/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5",
               ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
  }));
};

import { hashConnectToken } from "@/lib/connect-token";

const sqlCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]));

/**
 * «Базу» заповнюємо ТИМ САМИМ помічником, яким її заповнює застосунок, а не
 * власним підрахунком із зашитим префіксом: інакше перевірка «токен входу не
 * відмикає двері прив'язки» лишилась би зеленою й тоді, коли призначення з
 * дайджесту приберуть — обидва боки просто не збігались би.
 */
const sha = (purpose: "link" | "enter", token: string): Promise<string> =>
  hashConnectToken(purpose, token);

beforeEach(() => {
  one.mockReset(); run.mockReset(); sendText.mockReset(); checkRate.mockReset(); recordFailure.mockReset();
  callTelegram.mockClear(); sendSiteLink.mockReset(); sendFirstOffer.mockReset(); claimPending.mockReset();
  claimPending.mockResolvedValue(null);
  checkRate.mockResolvedValue({ allowed: true, retryAfterMinutes: 0 });
  env = { TELEGRAM_WEBHOOK_SECRET: "s3cret", ADMIN_CHAT_ID: "777", TELEGRAM_BOT_TOKEN: "t" };
});

describe("вебхук: секрет", () => {
  it("без секрету — 401 і невдача записана за адресою", async () => {
    const res = await post({ update_id: 1, message: { text: "hi", chat: { id: 1 } } });
    expect(res.status).toBe(401);
    expect(recordFailure).toHaveBeenCalledWith("webhook401:203.0.113.5", expect.anything());
    expect(one).not.toHaveBeenCalled();
  });
  it("коли адреса вже заблокована, лічильник не крутимо далі", async () => {
    checkRate.mockResolvedValue({ allowed: false, retryAfterMinutes: 10 });
    const res = await post({ update_id: 1 }, "wrong");
    expect(res.status).toBe(401);
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

describe("вебхук: повтор update_id", () => {
  it("побачений update_id не обробляється вдруге", async () => {
    one.mockImplementation(async (sql: string) =>
      sql.includes("webhook_updates") ? { n: 1 } : null);
    await post({ update_id: 42, message: { text: "/start abc", chat: { id: 5 } } }, "s3cret");
    // Жодного читання users — обробка зупинилась на дедуплікації.
    expect(sqlCalls(one).some((s) => s.includes("FROM users"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("вебхук: прив'язка /start <token>", () => {
  /**
   * Заглушка бази поводиться так, як поводитиметься D1 після 0045:
   *
   *   • стовпця `connect_token` немає — запит по ньому падає. Без цього нові
   *     тести були б зеленими й зі старим кодом, бо пошук просто нічого не
   *     знаходив би, і правило «червоний без правки» знову було б порушене;
   *   • рядок віддається лише на ТОЧНИЙ хеш, а не на будь-який параметр —
   *     інакше перевірка «токен входу не годиться для прив'язки» нічого не
   *     перевіряє;
   *   • `targetChat` — це telegram_chat_id самого цільового акаунта, тобто
   *     жертви. Саме його не дивилась жодна з трьох наявних перевірок.
   */
  const linkFlow = (opts: {
    otherId: string | null; hasHistory?: boolean;
    purpose?: "link" | "enter"; targetChat?: string | null;
  }) => {
    const stored = sha(opts.purpose ?? "link", "tok");
    one.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("webhook_updates")) return null;
      if (/connect_token(?!_hash)/.test(sql)) throw new Error("no such column: connect_token");
      if (sql.includes("FROM bot_state WHERE chat_id=?")) return { step: `link:${await sha("link", "tok")}` };
      if (sql.includes("WHERE telegram_chat_id=? AND id<>?")) return opts.otherId ? { id: opts.otherId } : null;
      if (sql.includes("connect_token_hash=?")) {
        return params[0] === (await stored)
          ? { id: "site-user", connect_expires_at: new Date(Date.now() + 60_000).toISOString() }
          : null;
      }
      if (sql.includes("telegram_chat_id FROM users WHERE id=?")) return { telegram_chat_id: opts.targetChat ?? null };
      if (sql.includes("FROM sent")) return opts.hasHistory ? { n: 1 } : null;
      return null;   // known user by chat id
    });
  };
  const confirm = (id: number, data = "lk:yes", update_id = 100 + id) =>
    post({ update_id, callback_query: { id: "cb", data, message: { chat: { id } } } }, "s3cret");

  it("/start <token> лише питає підтвердження — нічого не прив'язує", async () => {
    linkFlow({ otherId: null });
    await post({ update_id: 6, message: { text: "/start tok", chat: { id: 5 } } }, "s3cret");
    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(false);
    expect(sqlCalls(run).some((s) => s.includes("INSERT INTO bot_state"))).toBe(true);
    const call = (callTelegram.mock.calls as unknown[][]).find((c) => c[1] === "sendMessage");
    const sent = call?.[2] as { text: string; reply_markup: { inline_keyboard: { callback_data: string }[][] } };
    expect(sent.text).toBe("linkAsk");
    expect(sent.reply_markup.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual(["lk:yes", "lk:no"]);
  });

  it("«Ні» — нічого не змінюється", async () => {
    linkFlow({ otherId: null });
    await confirm(5, "lk:no");
    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(false);
    expect(sendText).toHaveBeenCalledWith("t", 5, "linkCancelled");
  });

  it("chat_id власника не перевішується на чужий акаунт", async () => {
    linkFlow({ otherId: "owner-row" });
    await confirm(777);
    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(false);
    expect(sqlCalls(run).some((s) => s.includes("DELETE FROM users"))).toBe(false);
    expect(sendText).toHaveBeenCalledWith("t", 777, "alreadyLinked");
  });

  it("звичайний конфлікт: старий акаунт відв'язується, а не стирається", async () => {
    linkFlow({ otherId: "bot-only-row" });
    await confirm(5);
    const sql = sqlCalls(run);
    expect(sql.some((s) => s.includes("DELETE FROM users"))).toBe(false);
    expect(sql.some((s) => s.includes("SET telegram_chat_id=NULL"))).toBe(true);
    expect(sql.some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(true);
  });

  /**
   * Друге місце, де акаунт лишається без чату (перше — «відв'язати» в панелі).
   * Стан після нього такий самий: рядок без чату, у якого прив'язка знову
   * дозволена. Правило мусить бути одне на обидва, бо саме розбіжність між
   * «доставку спинили» і «сесії лишили» й була дірою.
   */
  it("акаунт, у якого забрали чат, лишається без сесій", async () => {
    linkFlow({ otherId: "bot-only-row" });
    await confirm(5);

    const kill = run.mock.calls.find((c) => String(c[0]).includes("DELETE FROM sessions"));
    expect(kill).toBeDefined();
    expect(kill!.at(-1)).toBe("bot-only-row");
  });

  it("без конфлікту — після «Так» прив'язує", async () => {
    linkFlow({ otherId: null });
    await confirm(5);
    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(true);
    expect(sendText).toHaveBeenCalledWith("t", 5, "linked");
  });

  /**
   * Ядро вади: посилання входу бот шле в чат, токен читається просто зі
   * скриншота, а двері прив'язки приймали його як свій. Один дотик — і чужий
   * акаунт висить на Telegram того, хто цей скриншот побачив.
   */
  it("токен, виданий для входу на сайт, дверей прив'язки не відмикає", async () => {
    linkFlow({ otherId: null, purpose: "enter" });
    await post({ update_id: 7, message: { text: "/start tok", chat: { id: 5 } } }, "s3cret");

    const sql = sqlCalls(run);
    expect(sql.some((s) => s.includes("INSERT INTO bot_state"))).toBe(false);
    expect(sql.some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(false);
    expect(sendText).toHaveBeenCalledWith("t", 5, "linkExpired");
  });

  it("у bot_state лягає хеш, а не сам токен із посилання", async () => {
    linkFlow({ otherId: null });
    await post({ update_id: 8, message: { text: "/start tok", chat: { id: 5 } } }, "s3cret");

    const call = run.mock.calls.find((c) => String(c[0]).includes("INSERT INTO bot_state"));
    expect(call).toBeDefined();
    const step = String(call![2]);
    expect(step).toBe(`link:${await sha("link", "tok")}`);
    // Головне не форма, а те, чого в параметрах немає: сирого токена.
    expect(run.mock.calls.flatMap((c) => c.slice(1)).map(String)).not.toContain("tok");
  });

  /**
   * Друга половина тієї ж діри: навіть правильним токеном прив'язки не можна
   * перевісити акаунт, у якого вже є СВІЙ Telegram. Три наявні перевірки
   * дивились на чат нападника (чи він чужий, чи має історію, чи він власник)
   * і жодна — на акаунт жертви.
   */
  it("акаунт, який уже має інший Telegram, не перевішується", async () => {
    linkFlow({ otherId: null, targetChat: "999" });
    await confirm(5);

    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(false);
    expect(sendText).toHaveBeenCalledWith("t", 5, "linkExpired");
  });

  /**
   * Дві сусідні відмови казали різне, і саме різниця була відповіддю:
   * «застаріло» означало «такого токена немає», а «акаунт уже підключено» —
   * «токен справжній, і акаунт існує». Тобто сторонній із самим лише здогадом
   * міг перевіряти здогади по одному, і бот сам казав, коли влучив.
   *
   * Перевіряємо не назву ключа, а те, що чат чує ОДНЕ Й ТЕ САМЕ в обох
   * випадках: інакше завтра можна знову розвести тексти, лишивши тест зеленим.
   */
  it("вигаданий токен і живий чужий акаунт відповідають однаково", async () => {
    linkFlow({ otherId: null, targetChat: "999" });
    await confirm(5);
    const refusedReal = sendText.mock.calls.map((c) => c[2]);

    sendText.mockReset();
    // Того самого хеша в базі немає взагалі — тобто токен вигаданий.
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("webhook_updates")) return null;
      if (sql.includes("FROM bot_state WHERE chat_id=?")) return { step: `link:${await sha("link", "tok")}` };
      if (sql.includes("connect_token_hash=?")) return null;
      return null;
    });
    await confirm(6);

    expect(sendText.mock.calls.map((c) => c[2])).toEqual(refusedReal);
  });

  it("повторний дотик із того самого чату прив'язку не ламає", async () => {
    linkFlow({ otherId: null, targetChat: "5" });
    await confirm(5);

    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(true);
    expect(sendText).toHaveBeenCalledWith("t", 5, "linked");
  });

  it("акаунт після паузи 'relinked' (chat_id порожній) прив'язується", async () => {
    linkFlow({ otherId: null, targetChat: null });
    await confirm(5);

    expect(sqlCalls(run).some((s) => s.includes("UPDATE users SET telegram_chat_id=?"))).toBe(true);
  });

  /**
   * Прив'язати мало — треба ще зняти паузу, інакше сканер (він шле лише за
   * status='active') мовчить назавжди, а людина щойно почула «готово».
   *
   * Причин «слати нема куди» рівно дві, і обидві ставимо ми самі:
   * 'no_telegram' (orphans.ts) і 'relinked' — ту цей же bindChat ставить
   * акаунту, у якого забирає чат. Саме її в переліку й бракувало.
   * Перевіряємо весь набір, а не наявність одного слова: інакше наступна
   * причина випаде так само тихо. 'manual' сюди не входить свідомо — там
   * паузу обрала сама людина.
   */
  it("нова прив'язка знімає паузу з УСІХ причин «нема куди слати»", async () => {
    linkFlow({ otherId: null, targetChat: null });
    await confirm(5);

    const unpause = sqlCalls(run).find((s) => s.includes("status='active'"));
    expect(unpause).toBeDefined();
    const reasons = [...unpause!.matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1]!).filter((r) => r !== "active");
    expect(new Set(reasons)).toEqual(new Set(["no_telegram", "relinked"]));
  });
});

/**
 * Токен анкети (pending_signups) — інший рід і інша таблиця, але той самий
 * аргумент /start. Для ВЖЕ забраної анкети claimPending віддає чужий userId
 * будь-якому чату, а вебхук на це безумовно слав посилання входу — тобто
 * ключ від чужого кабінету, повторюваний сім днів.
 */
describe("вебхук: повтор токена анкети", () => {
  const pendingFlow = (accountChat: string | null) => {
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("webhook_updates")) return null;
      if (/connect_token(?!_hash)/.test(sql)) throw new Error("no such column: connect_token");
      if (sql.includes("connect_token_hash=?")) return null;
      if (sql.includes("telegram_chat_id FROM users WHERE id=?")) return { telegram_chat_id: accountChat };
      return null;
    });
    claimPending.mockResolvedValue({ userId: "victim", locale: "uk", fresh: false });
  };

  it("чужий чат посилання входу не отримує", async () => {
    pendingFlow("111");
    await post({ update_id: 20, message: { text: "/start ptok", chat: { id: 222 } } }, "s3cret");

    expect(sendSiteLink).not.toHaveBeenCalled();
    expect(sendFirstOffer).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith("t", 222, "linkExpired");
  });

  it("той самий чат посилання входу отримує", async () => {
    pendingFlow("222");
    await post({ update_id: 21, message: { text: "/start ptok", chat: { id: 222 } } }, "s3cret");

    expect(sendSiteLink).toHaveBeenCalled();
  });

  it("свіжа анкета проходить, як і раніше", async () => {
    pendingFlow(null);
    claimPending.mockResolvedValue({ userId: "newbie", locale: "uk", fresh: true });
    await post({ update_id: 22, message: { text: "/start ptok", chat: { id: 222 } } }, "s3cret");

    expect(sendSiteLink).toHaveBeenCalled();
    expect(sendFirstOffer).toHaveBeenCalled();
  });
});
