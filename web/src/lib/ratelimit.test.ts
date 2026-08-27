import { describe, expect, it } from "vitest";
import { decide, nextState, type AttemptRow } from "./ratelimit";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const row = (o: Partial<AttemptRow> = {}): AttemptRow => ({
  attempts: 1, window_start: NOW.toISOString(), blocked_until: null, ...o });

describe("decide", () => {
  it("пропускає, коли записів немає", () => {
    expect(decide(null, NOW).allowed).toBe(true);
  });
  it("пропускає, поки блокування не виставлено", () => {
    expect(decide(row({ attempts: 5 }), NOW).allowed).toBe(true);
  });
  it("блокує до вказаного часу й каже, скільки чекати", () => {
    const v = decide(row({ blocked_until: "2026-08-27T12:20:00.000Z" }), NOW);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterMinutes).toBe(20);
  });
  it("відпускає, коли блокування минуло", () => {
    expect(decide(row({ blocked_until: "2026-08-27T11:00:00.000Z" }), NOW).allowed).toBe(true);
  });
});

describe("nextState", () => {
  it("перша невдача починає вікно", () => {
    expect(nextState(null, NOW).attempts).toBe(1);
  });
  it("нарощує лічильник усередині вікна", () => {
    expect(nextState(row({ attempts: 3 }), NOW).attempts).toBe(4);
  });
  it("блокує на восьмій спробі", () => {
    expect(nextState(row({ attempts: 7 }), NOW).blocked_until).not.toBeNull();
  });
  it("не блокує на сьомій", () => {
    expect(nextState(row({ attempts: 6 }), NOW).blocked_until).toBeNull();
  });
  it("починає вікно наново, коли старе минуло", () => {
    const old = row({ attempts: 7, window_start: "2026-08-27T11:00:00.000Z" });
    const n = nextState(old, NOW);
    expect(n.attempts).toBe(1);
    expect(n.blocked_until).toBeNull();
  });
});
