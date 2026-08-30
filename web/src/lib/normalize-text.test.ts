import { describe, expect, it } from "vitest";
import { needsModel, normalizeCity, normalizeFreeText, safeEnglish, termTranslate } from "./normalize-text";

describe("termTranslate", () => {
  it("той самий випадок, з якого все почалось", () => {
    expect(termTranslate("Комуніті менеджер")).toBe("community manager");
  });

  it("сполука не подвоює слово", () => {
    expect(termTranslate("Продакт менеджер")).toBe("product manager");
  });

  it("відмінки не заважають", () => {
    expect(termTranslate("шукаю роботу маркетологом")).toBe("marketing");
    expect(termTranslate("менеджером спільноти")).toBe("community manager");
  });

  it("російська і французька теж", () => {
    expect(termTranslate("разработчик")).toBe("developer");
    expect(termTranslate("chef de produit")).toBe("product manager");
  });

  it("кілька слів дають кілька англійських", () => {
    expect(termTranslate("дизайнер і аналітик").split(" ").sort()).toEqual(["analyst", "designer"]);
  });

  it("чого не знає — про те мовчить", () => {
    expect(termTranslate("абракадабра")).toBe("");
  });

  it("англійський текст лишається собою", () => {
    expect(termTranslate("Grant Writer")).toBe("grant writer");
  });
});

describe("needsModel", () => {
  it("словник упорався — модель не потрібна", () => {
    expect(needsModel("Комуніті менеджер", termTranslate("Комуніті менеджер"))).toBe(false);
  });

  it("словник не знає слова — потрібна", () => {
    expect(needsModel("грантрайтинг", termTranslate("грантрайтинг"))).toBe(true);
  });

  it("порожній рядок нікого не турбує", () => {
    expect(needsModel("", "")).toBe(false);
  });
});

describe("safeEnglish", () => {
  it("приймає короткий латинський рядок", () => {
    expect(safeEnglish("community manager")).toBe("community manager");
  });

  it("відкидає кирилицю, посилання й довжину", () => {
    expect(safeEnglish("комуніті")).toBeNull();
    expect(safeEnglish("go to https://x.test")).toBeNull();
    expect(safeEnglish("a".repeat(200))).toBeNull();
    expect(safeEnglish(42)).toBeNull();
  });
});

describe("normalizeFreeText", () => {
  it("латиниця повертається без виклику моделі", async () => {
    expect(await normalizeFreeText("Grant Writer", null)).toBe("Grant Writer");
  });

  it("кирилиця зі словника — без моделі", async () => {
    expect(await normalizeFreeText("Комуніті менеджер", null)).toBe("community manager");
  });

  it("без ключа й без словника лишається транслітерація", async () => {
    const out = await normalizeFreeText("Абракадабра", null);
    expect(out).toBeTruthy();
    expect(out).not.toMatch(/[Ѐ-ӿ]/);
  });

  it("порожнє лишається порожнім", async () => {
    expect(await normalizeFreeText("  ", null)).toBeNull();
    expect(await normalizeFreeText(null, null)).toBeNull();
  });
});

describe("normalizeCity", () => {
  it("«Париж» -> «Paris», а не «Paryzh»", () => {
    expect(normalizeCity("Париж")).toBe("Paris");
  });

  it("«Київ» -> «Kyiv»", () => {
    expect(normalizeCity("Київ")).toBe("Kyiv");
  });

  it("виправляє розкладку: «зфкшы» — це «paris» під кирилицею", () => {
    expect(normalizeCity("зфкшы")).toBe("paris");
  });

  it("але лише коли вийшло місце: «зфкши» дає «parib» і тому лишається як є", () => {
    // Живий рядок із бази. Заміна розкладки дає «parib» — не місто, тож
    // fixLayout мовчить, і лишається транслітерація. Це і є та обережність,
    // без якої справжня кирилична назва теж перетворювалась би на кашу.
    expect(normalizeCity("зфкши")).toBe("zfkshy");
  });

  it("латиницю не чіпає", () => {
    expect(normalizeCity("Berlin")).toBe("Berlin");
  });
});
