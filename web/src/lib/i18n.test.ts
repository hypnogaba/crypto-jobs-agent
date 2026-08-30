import { describe, expect, it } from "vitest";
import { LOCALES, isLocale, toLocale } from "./i18n";

describe("підпис мови в перемикачі", () => {
  it("українська показується як UA, а живе як uk", () => {
    const uk = LOCALES.find((l) => l.id === "uk")!;
    expect(uk.short).toBe("UA");   // «UK» поруч із «EN» читається як країна
    expect(uk.id).toBe("uk");      // код у базі й словниках не міняється
  });

  it("решта підписів збігається з кодом", () => {
    for (const l of LOCALES.filter((x) => x.id !== "uk")) {
      expect(l.short).toBe(l.id.toUpperCase());
    }
  });

  it("кожен підпис унікальний", () => {
    expect(new Set(LOCALES.map((l) => l.short)).size).toBe(LOCALES.length);
  });
});

describe("toLocale", () => {
  it("приймає сам код", () => {
    for (const l of LOCALES) expect(toLocale(l.id)).toBe(l.id);
  });

  it("приймає те, що людина набере після нашого ж підпису", () => {
    // Перемикач каже «UA», тож /lang ua — наступне, що вона напише.
    expect(toLocale("ua")).toBe("uk");
    expect(toLocale("UA")).toBe("uk");
    expect(toLocale(" ua ")).toBe("uk");
    expect(toLocale("ukr")).toBe("uk");
    expect(toLocale("us")).toBe("en");
    expect(toLocale("gb")).toBe("en");
  });

  it("невідоме лишається невідомим", () => {
    expect(toLocale("de")).toBeNull();
    expect(toLocale("")).toBeNull();
    expect(toLocale("uk ru")).toBeNull();
  });

  it("не розширює isLocale: псевдонім не є кодом", () => {
    // Кука й стовпець users.locale мають приймати лише справжні коди.
    expect(isLocale("ua")).toBe(false);
  });
});

// ── Повнота словників ─────────────────────────────────────────
import { DICTIONARIES } from "./i18n";

describe("словники", () => {
  const keys = (l: keyof typeof DICTIONARIES) => Object.keys(DICTIONARIES[l]).sort();

  it("усі чотири мови мають однаковий набір ключів", () => {
    // t() падає на англійську, коли ключа немає, — тож забутий переклад
    // ніде не видно, крім англійського рядка посеред української сторінки.
    for (const l of ["uk", "fr", "ru"] as const) {
      expect({ locale: l, keys: keys(l) }).toEqual({ locale: l, keys: keys("en") });
    }
  });

  it("жодне значення не порожнє", () => {
    for (const l of ["en", "uk", "fr", "ru"] as const) {
      for (const [k, v] of Object.entries(DICTIONARIES[l])) {
        expect(`${l}:${k}=${v}`).toMatch(/=.+/);
      }
    }
  });

  it("плейсхолдери збігаються з англійськими", () => {
    // «{when}» у en і «{коли}» в uk означали б порожнє місце на екрані.
    const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const l of ["uk", "fr", "ru"] as const) {
      for (const k of keys("en")) {
        expect({ k, l, h: holders(DICTIONARIES[l][k]!) })
          .toEqual({ k, l, h: holders(DICTIONARIES.en[k]!) });
      }
    }
  });
});
