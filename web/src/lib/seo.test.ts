import { describe, expect, it } from "vitest";
import { PREFIXED_LOCALES, localeForSegment, pageMeta, pathFor, segmentFor } from "./seo.js";

/**
 * Українська: адреса `ua`, код мови `uk`.
 *
 * Розбіжність легко «полагодити» назад одним рядком — і зламати або адресу,
 * яку бачить людина, або hreflang, який читає Google. Тому обидві половини
 * закріплені тут.
 */
describe("відрізок адреси vs код мови", () => {
  it("українська сторінка живе на /ua", () => {
    expect(pathFor("uk", "/")).toBe("/ua");
    expect(pathFor("uk", "/faq")).toBe("/ua/faq");
  });

  it("решта мов лишається як була, англійська — без префікса", () => {
    expect(pathFor("en", "/faq")).toBe("/faq");
    expect(pathFor("fr", "/faq")).toBe("/fr/faq");
    expect(pathFor("ru", "/privacy")).toBe("/ru/privacy");
  });

  it("hreflang називає мову, а не країну", () => {
    const { alternates } = pageMeta("uk", "/faq", "Питання");
    expect(alternates.languages.uk).toBe("/ua/faq");
    expect(alternates.languages).not.toHaveProperty("ua");
    expect(alternates.canonical).toBe("/ua/faq");
    expect(alternates.languages["x-default"]).toBe("/faq");
  });

  it("відрізок читається назад у мову, і лише свій", () => {
    expect(localeForSegment("ua")).toBe("uk");
    expect(localeForSegment("fr")).toBe("fr");
    // «uk» більше не адреса: приймати обидві — це дублікат сторінки в пошуку.
    expect(localeForSegment("uk")).toBeNull();
    expect(localeForSegment("xx")).toBeNull();
  });

  it("маршрут будується з тих самих відрізків, що й посилання", () => {
    expect(PREFIXED_LOCALES.map(segmentFor)).toEqual(["ua", "fr", "ru"]);
  });
});
