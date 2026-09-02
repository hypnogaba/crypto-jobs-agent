import { describe, expect, it } from "vitest";
import { GRACE_DAYS, orphanPlan } from "./orphans.js";

const now = new Date("2026-09-02T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe("orphanPlan", () => {
  it("активний без Telegram іде на паузу", () => {
    const plan = orphanPlan([{ id: "u1", status: "active", paused_reason: null, paused_at: null }], now);
    expect(plan).toEqual({ pause: ["u1"], drop: [] });
  });

  it("видаляє тільки після п'ятнадцяти днів паузи", () => {
    const rows = [
      { id: "young", status: "paused", paused_reason: "no_telegram", paused_at: daysAgo(GRACE_DAYS - 1) },
      { id: "old", status: "paused", paused_reason: "no_telegram", paused_at: daysAgo(GRACE_DAYS + 1) },
    ];
    expect(orphanPlan(rows, now).drop).toEqual(["old"]);
  });

  it("чужої паузи не чіпає: ручна й переприв'язка — не наша справа", () => {
    const rows = [
      { id: "manual", status: "paused", paused_reason: "manual", paused_at: daysAgo(100) },
      { id: "relinked", status: "paused", paused_reason: "relinked", paused_at: daysAgo(100) },
      { id: "blocked", status: "paused", paused_reason: "blocked", paused_at: daysAgo(100) },
    ];
    expect(orphanPlan(rows, now)).toEqual({ pause: [], drop: [] });
  });

  it("без позначки часу відлік не починається заднім числом", () => {
    const rows = [{ id: "u1", status: "paused", paused_reason: "no_telegram", paused_at: null }];
    expect(orphanPlan(rows, now).drop).toEqual([]);
  });
});
