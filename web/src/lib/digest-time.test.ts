import { describe, expect, it } from "vitest";
import { dayLabel, safeTimezone } from "./digest-time";

const now = new Date("2026-08-28T12:00:00Z");

describe("dayLabel", () => {
  it("сьогодні з часом у зоні людини", () => {
    expect(dayLabel("2026-08-28T06:00:00Z", "Europe/Kyiv", "uk", now)).toBe("Сьогодні, 09:00");
  });

  it("дві добірки за добу різняться часом", () => {
    const a = dayLabel("2026-08-28T06:00:00Z", "Europe/Kyiv", "uk", now);
    const b = dayLabel("2026-08-28T11:00:00Z", "Europe/Kyiv", "uk", now);
    expect(a).not.toBe(b);
  });

  it("вчора", () => {
    expect(dayLabel("2026-08-27T06:00:00Z", "Europe/Kyiv", "uk", now)).toBe("Вчора, 09:00");
  });

  it("давніше — дата словами", () => {
    expect(dayLabel("2026-08-24T06:00:00Z", "Europe/Kyiv", "uk", now)).toBe("24 серпня, 09:00");
  });

  it("зона людини вирішує, який це день", () => {
    // 23:30 UTC — це вже наступний день у Києві, але ще той самий у Нью-Йорку.
    expect(dayLabel("2026-08-27T23:30:00Z", "Europe/Kyiv", "uk", now)).toMatch(/^Сьогодні/);
    expect(dayLabel("2026-08-27T23:30:00Z", "America/New_York", "uk", now)).toMatch(/^Вчора/);
  });

  it("формат SQLite без зони читається як UTC, а не як місцевий час", () => {
    expect(dayLabel("2026-08-28 06:00:00", "Europe/Kyiv", "uk", now)).toBe("Сьогодні, 09:00");
  });

  it("невідома зона не валить сторінку", () => {
    expect(() => dayLabel("2026-08-28T06:00:00Z", "Марс/Олімп", "uk", now)).not.toThrow();
  });
});

describe("safeTimezone", () => {
  it("приймає справжні зони, зокрема триланкові", () => {
    for (const tz of ["Europe/Kyiv", "America/New_York", "Asia/Ho_Chi_Minh",
                      "America/Argentina/Buenos_Aires", "Etc/GMT+3", "UTC"]) {
      expect(safeTimezone(tz)).toBe(tz);
    }
  });

  it("відкидає сміття, а не кладе його в розклад доставки", () => {
    expect(safeTimezone("Марс/Олімп")).toBe("UTC");
    expect(safeTimezone("'; DROP TABLE users; --")).toBe("UTC");
    expect(safeTimezone("")).toBe("UTC");
    expect(safeTimezone(null)).toBe("UTC");
    expect(safeTimezone("x".repeat(200))).toBe("UTC");
  });
});
