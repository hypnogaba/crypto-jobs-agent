import { describe, expect, it } from "vitest";
import { clockIn, isKnownZone, timeOptions, timezoneFromCity, zoneForHour } from "./tz";
import { draftTimezone, emptyDraft, keyboard, nextStep } from "./bot-onboarding";

// Літня доба: Київ UTC+3, Париж/Варшава UTC+2, Лондон UTC+1, Нью-Йорк UTC-4, Дубай UTC+4.
const NOW = new Date("2026-08-29T12:00:00Z");

describe("пояс із міста", () => {
  it("упізнає міста трьома мовами", () => {
    expect(timezoneFromCity("Львів")).toBe("Europe/Kyiv");
    expect(timezoneFromCity("тільки Paris")).toBe("Europe/Paris");
    expect(timezoneFromCity("Dubai, remote ok")).toBe("Asia/Dubai");
    expect(timezoneFromCity("Батумі")).toBe("Asia/Tbilisi");
    expect(timezoneFromCity("New York")).toBe("America/New_York");
  });

  it("не вигадує зони з невідомого", () => {
    expect(timezoneFromCity("Marsландія")).toBeNull();
    expect(timezoneFromCity("")).toBeNull();
    expect(timezoneFromCity(null)).toBeNull();
  });
});

describe("кнопки «котра година»", () => {
  it("показують місцевий час і схлопують однакові", () => {
    const opts = timeOptions(NOW);
    expect(opts.find((o) => o.zone === "Europe/Kyiv")?.time).toBe("15:00");
    expect(opts.find((o) => o.zone === "Europe/Paris")?.time).toBe("14:00");
    // Варшава = Париж, тож її кнопки немає
    expect(opts.some((o) => o.zone === "Europe/Warsaw")).toBe(false);
    expect(new Set(opts.map((o) => o.time)).size).toBe(opts.length);
  });

  it("клавіатура кроку tz несе зону в callback і вміщається в 64 байти", () => {
    const rows = keyboard("tz", emptyDraft(), "uk", { now: NOW });
    const flat = rows.flat();
    expect(flat.find((b) => b.callback_data === "ob:tz:Europe/Kyiv")?.text).toBe("15:00 · Київ");
    expect(flat[flat.length - 1]!.callback_data).toBe("ob:tz:__other");
    for (const b of flat) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
  });
});

describe("зона за написаною годиною", () => {
  it("бере Європу, коли година збігається з кількома", () => {
    expect(zoneForHour("14:30", NOW)).toBe("Europe/Paris");
    expect(zoneForHour("15", NOW)).toBe("Europe/Kyiv");
    expect(zoneForHour("08:00", NOW)).toBe("America/New_York");
  });

  it("сміття й неможливу годину відкидає", () => {
    expect(zoneForHour("завтра", NOW)).toBeNull();
    expect(zoneForHour("25:00", NOW)).toBeNull();
  });
});

describe("крок tz в анкеті", () => {
  it("пропускається, коли місто вже назвало пояс", () => {
    expect(nextStep("city", { ...emptyDraft(), location: "Київ" })).toBe("salary");
    expect(nextStep("city", { ...emptyDraft(), location: "Marsландія" })).toBe("tz");
  });

  it("пропускається, коли зона вже обрана", () => {
    expect(nextStep("city", { ...emptyDraft(), timezone: "Europe/Paris" })).toBe("salary");
  });

  it("чернетка дає зону з кнопки, міста або країни, але не UTC", () => {
    expect(draftTimezone({ ...emptyDraft(), timezone: "Asia/Dubai" }, "en")).toBe("Asia/Dubai");
    expect(draftTimezone({ ...emptyDraft(), location: "Lyon" }, "en")).toBe("Europe/Paris");
    expect(draftTimezone({ ...emptyDraft(), location: "Portugal" }, "en")).toBe("Europe/Lisbon");
    expect(draftTimezone(emptyDraft(), "en")).toBeNull();
  });
});

describe("зони для /time", () => {
  it("приймає лише те, що знає Intl", () => {
    expect(isKnownZone("Europe/Paris")).toBe(true);
    expect(isKnownZone("Europe/Kyiv")).toBe(true);
    expect(isKnownZone("Mars/Olympus")).toBe(false);
    expect(clockIn("Europe/Kyiv", NOW)).toBe("15:00");
  });
});
