import { afterEach, describe, expect, it, vi } from "vitest";
import { affected, notifyOwner } from "./notify.js";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });

describe("сповіщення власника", () => {
  it("шле в Telegram, коли є і токен, і адреса", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t0ken";
    process.env.ADMIN_CHAT_ID = "42";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await notifyOwner("скан упав");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/bott0ken/sendMessage");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.chat_id).toBe("42");
    expect(body.text).toBe("скан упав");
  });

  it("без адреси мовчить у Telegram, але кричить у журнал", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t0ken";
    delete process.env.ADMIN_CHAT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await notifyOwner("скан упав");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toContain("ADMIN_CHAT_ID");
  });

  /**
   * Найважливіше правило файлу: сповіщення про збій не має права стати
   * другим збоєм. Якщо Telegram лежить саме тоді, коли впав скан, прогін
   * мусить дожити до кінця.
   */
  it("падіння Telegram не кидає виняток", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t0ken";
    process.env.ADMIN_CHAT_ID = "42";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(notifyOwner("скан упав")).resolves.toBeUndefined();
  });

  it("довге повідомлення обрізається, а не відхиляється Telegram-ом", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t0ken";
    process.env.ADMIN_CHAT_ID = "42";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await notifyOwner("я".repeat(5000));

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.text.length).toBeLessThanOrEqual(3501);
    expect(body.text.endsWith("…")).toBe(true);
  });

  it("каже, скількох людей це зачепило", () => {
    // «Збій» без числа не дає вирішити, чи бігти до компʼютера.
    expect(affected(3, 6)).toBe("3 з 6");
    expect(affected(1, 0)).toBe("1");
  });
});
