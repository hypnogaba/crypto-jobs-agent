import { afterEach, describe, expect, it, vi } from "vitest";
import { callTelegram, retryDelayMs } from "./telegram-send";

describe("retryDelayMs", () => {
  it("повторює лише на 429", () => {
    expect(retryDelayMs(400, { parameters: { retry_after: 2 } })).toBeNull();
    expect(retryDelayMs(200, null)).toBeNull();
  });
  it("чекає стільки, скільки просить Telegram", () => {
    expect(retryDelayMs(429, { parameters: { retry_after: 2 } })).toBe(2000);
  });
  it("без retry_after чекає секунду", () => {
    expect(retryDelayMs(429, null)).toBe(1000);
  });
  it("не чекає довше за стелю — вебхук мусить відповісти вчасно", () => {
    expect(retryDelayMs(429, { parameters: { retry_after: 60 } })).toBeNull();
  });
});

describe("callTelegram", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("без токена нічого не шле", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const r = await callTelegram(undefined, "sendMessage", { chat_id: 1, text: "x" });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("пише попередження, коли Telegram відмовив", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await callTelegram("t", "sendMessage", { chat_id: 1, text: "x" });
    expect(r.ok).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("chat not found");
  });

  it("на 429 пробує ще раз — один", async () => {
    vi.useFakeTimers();
    const f = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, parameters: { retry_after: 1 } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = callTelegram<{ message_id: number }>("t", "sendMessage", { chat_id: 1, text: "x" });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(r.result?.message_id).toBe(7);
  });

  it("мережева помилка не валить того, хто викликав", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(callTelegram("t", "sendMessage", { chat_id: 1, text: "x" })).resolves.toEqual(
      expect.objectContaining({ ok: false }));
  });
});
