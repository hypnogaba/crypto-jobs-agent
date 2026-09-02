import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Анкета живе окремо від акаунта, доки не підключено Telegram.
 *
 * Ці тести стережуть одну обіцянку: людина, яка заповнила анкету й не дійшла
 * до бота, не лишає по собі акаунта. І другу: та, що дійшла, отримує рівно
 * один акаунт, скільки б разів вона не тиснула на посилання.
 */

const one = vi.fn();
const run = vi.fn();
const persistProfile = vi.fn();

vi.mock("./db", () => ({
  one: (...a: unknown[]) => one(...a),
  run: (...a: unknown[]) => run(...a),
  uuid: () => "new-user",
}));
vi.mock("@/lib/profile-write", () => ({
  persistProfile: (...a: unknown[]) => persistProfile(...a),
}));

import { claimPending } from "./pending";

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1", token: "tok", locale: "uk", timezone: "Europe/Kyiv",
  profile: JSON.stringify({ spheres: ["engineering"], industries: [], remoteMode: "remote_only" }),
  raw_input: "текст про себе", source: "freetext", claimed_user_id: null, ...over,
});

beforeEach(() => { one.mockReset(); run.mockReset(); persistProfile.mockReset(); });

describe("claimPending", () => {
  it("створює акаунт і записує в нього профіль", async () => {
    one.mockResolvedValueOnce(row())        // анкета за токеном
       .mockResolvedValueOnce(undefined);   // цього chat_id ще немає
    const got = await claimPending("tok", "555");
    expect(got).toEqual({ userId: "new-user", locale: "uk", fresh: true });
    expect(run.mock.calls[0]![0]).toContain("INSERT INTO users");
    expect(persistProfile).toHaveBeenCalledWith("new-user", "текст про себе", "freetext",
      expect.objectContaining({ spheres: ["engineering"] }));
  });

  it("другий дотик по тому самому посиланню не створює другого акаунта", async () => {
    one.mockResolvedValueOnce(row({ claimed_user_id: "u9" }));
    const got = await claimPending("tok", "555");
    expect(got).toEqual({ userId: "u9", locale: "uk", fresh: false });
    expect(run).not.toHaveBeenCalled();
    expect(persistProfile).not.toHaveBeenCalled();
  });

  it("chat_id, який уже має акаунт, дістає анкету в наявний, а не другий", async () => {
    // Людина пройшла /start у боті, а потім заповнила анкету на сайті.
    // Два акаунти означали б дві добірки, і про одну з них вона не знає.
    one.mockResolvedValueOnce(row()).mockResolvedValueOnce({ id: "u-old" });
    const got = await claimPending("tok", "555");
    expect(got!.userId).toBe("u-old");
    expect(run.mock.calls.some((c) => String(c[0]).includes("INSERT INTO users"))).toBe(false);
    expect(persistProfile).toHaveBeenCalledWith("u-old", "текст про себе", "freetext", expect.anything());
  });

  it("невідомий або прострочений токен нічого не створює", async () => {
    one.mockResolvedValueOnce(undefined);
    expect(await claimPending("tok", "555")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
