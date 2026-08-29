import { describe, expect, it, vi } from "vitest";
import { D1Client, D1HttpError } from "./d1.js";

const creds = { accountId: "a", databaseId: "d", token: "t" };
const okBody = JSON.stringify({ success: true, result: [{ success: true, results: [{ n: 1 }] }], errors: [] });
const client = (fetchImpl: unknown, attempts = 3) =>
  new D1Client(creds, { fetchImpl: fetchImpl as typeof fetch, attempts, retryDelayMs: 0 });

describe("D1Client.post — повтори", () => {
  it("мережевий збій — повтор, і друга спроба рятує", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { cause: new Error("ECONNRESET") }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    await expect(client(f).query("SELECT 1")).resolves.toEqual([{ n: 1 }]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("5xx — повтор до трьох разів, потім помилка", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = vi.fn().mockImplementation(async () => new Response("bad gateway", { status: 502 }));
    await expect(client(f).execute("SELECT 1")).rejects.toThrow(/502/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("4xx і помилка SQL — без повторів", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 400 }));
    await expect(client(f).execute("SELECT 1")).rejects.toBeInstanceOf(D1HttpError);
    expect(f).toHaveBeenCalledTimes(1);

    const g = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: false, result: [], errors: [{ code: 1, message: "no such table" }] }), { status: 200 }));
    await expect(client(g).execute("SELECT 1")).rejects.toThrow(/no such table/);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("401 — без повторів і з поясненням про токен", async () => {
    const f = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(client(f).execute("SELECT 1")).rejects.toThrow(/CF_API_TOKEN/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("кожен запит іде з таймаутом", async () => {
    const f = vi.fn().mockResolvedValue(new Response(okBody, { status: 200 }));
    await client(f).query("SELECT 1");
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
