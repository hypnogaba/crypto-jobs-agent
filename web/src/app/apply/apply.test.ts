import { describe, expect, it, vi, beforeEach } from "vitest";

const one = vi.fn();
const run = vi.fn();
const currentUser = vi.fn();

vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));
vi.mock("@/lib/auth", () => ({ currentUser: () => currentUser() }));

beforeEach(() => { one.mockReset(); run.mockReset(); currentUser.mockReset(); });

const call = async (id: string) => {
  const { GET } = await import("./[id]/route");
  return GET(new Request(`https://nextrole.info/apply/${id}`), { params: Promise.resolve({ id }) });
};

describe("GET /apply/:id", () => {
  it("веде на вакансію і позначає подачу", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    one.mockResolvedValue({ url: "https://jobs.ashbyhq.com/acme/1" });
    const res = await call("s1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://jobs.ashbyhq.com/acme/1");
    expect(run).toHaveBeenCalled();
  });

  it("чужий рядок не веде на вакансію і нічого не пише", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    one.mockResolvedValue(null);                 // умова user_id відсікла
    const res = await call("чужий");
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(run).not.toHaveBeenCalled();
  });

  it("без сесії — на вхід", async () => {
    currentUser.mockResolvedValue(null);
    const res = await call("s1");
    expect(res.headers.get("location")).toContain("/login");
    expect(run).not.toHaveBeenCalled();
  });

  it("повторне натискання не переписує дату першої подачі", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    one.mockResolvedValue({ url: "https://jobs.ashbyhq.com/acme/1" });
    await call("s1");
    const sql = String(run.mock.calls[0]![0]);
    expect(sql).toMatch(/COALESCE\(applied_at/);
  });
});
