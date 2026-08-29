import { describe, expect, it, vi, beforeEach } from "vitest";

const one = vi.fn();
const run = vi.fn();

vi.mock("@/lib/db", () => ({ one: (...a: unknown[]) => one(...a), run: (...a: unknown[]) => run(...a) }));

beforeEach(() => { one.mockReset(); run.mockReset(); });

const call = async (id: string) => {
  const { GET } = await import("./[id]/route");
  return GET(new Request(`https://nextrole.info/go/${id}`), { params: Promise.resolve({ id }) });
};

describe("GET /go/:id", () => {
  it("без сесії веде на вакансію й позначає подачу", async () => {
    one.mockResolvedValue({ user_id: "u1", url: "https://jobs.lever.co/acme/1" });
    const res = await call("s1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://jobs.lever.co/acme/1");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("невідомий id — на головну, без запису", async () => {
    one.mockResolvedValue(null);
    const res = await call("нема");
    expect(res.headers.get("location")).toBe("https://nextrole.info/");
    expect(run).not.toHaveBeenCalled();
  });
});
