import { describe, expect, it, vi } from "vitest";

// Облік токенів тягне D1; локальний розбір його не потребує.
vi.mock("@/lib/usage", () => ({ logUsage: async () => {}, readUsage: () => ({ input: 0, output: 0 }) }));

import { mergeParsed, parseLocally, snippet, verifyEvidence } from "./parse";

describe("сфера «дизайн»", () => {
  it("упізнається латиницею й кирилицею", () => {
    expect(parseLocally("Senior product designer, Figma, remote").spheres).toContain("design");
    expect(parseLocally("UX/UI, 5 років").spheres).toContain("design");
    expect(parseLocally("шукаю роботу графічним дизайнером у Києві").spheres).toContain("design");
    expect(parseLocally("графический дизайнер").spheres).toContain("design");
  });

  it("не чіпляється до слів усередині інших", () => {
    // «uiuc», «designated» — не дизайн
    expect(parseLocally("Designated backend engineer").spheres).not.toContain("design");
    expect(parseLocally("built the guide").spheres).not.toContain("design");
  });

  it("продукт більше не тягне дизайн за собою", () => {
    const { spheres } = parseLocally("product manager");
    expect(spheres).toContain("product");
    expect(spheres).not.toContain("design");
  });
});

/**
 * Кирилиця. `\b` у JS — межа ASCII-слова, тож увесь кириличний словник був
 * мертвим: збігався сам лише `design`, якому колись зробили виняток.
 */
describe("кириличні підказки взагалі спрацьовують", () => {
  it.each([
    ["Шукаю роботу продакт-менеджером", "product"],
    ["я продуктовий менеджер", "product"],
    ["досвід у неприбуткових організаціях", null],
    ["я маркетолог у стартапі", "marketing"],
    ["працюю інженером-програмістом", "engineering"],
    ["я розробник на Go", "engineering"],
    ["займаюсь тестуванням", "qa"],
    ["відповідаю за партнерства", "partnerships"],
    ["веду спільноту розробників", "devrel"],
    ["працюю в продажах", "sales"],
    ["відповідаю за безпеку", "security"],
    ["керую операціями", "operations"],
    ["я аналітик даних", "data-ai"],
  ])("%s → %s", (text, sphere) => {
    if (sphere) expect(parseLocally(text).spheres).toContain(sphere);
  });

  it("індустрії кирилицею теж", () => {
    expect(parseLocally("шукаю в неприбуткових організаціях").industries).toContain("nonprofit");
    expect(parseLocally("некомерційний сектор").industries).toContain("nonprofit");
    expect(parseLocally("працював у криптопроєкті").industries).toContain("web3");
    expect(parseLocally("фінтех і платежі").industries).toContain("fintech");
  });
});

/** Хибні спрацювання, кожне з реального тексту. */
describe("більше не вигадує", () => {
  it("французьке j'ai не робить із людини дата-сайєнтиста", () => {
    const p = parseLocally("Je suis chef de produit, j'ai six ans d'experience");
    expect(p.spheres).not.toContain("data-ai");
    expect(p.industries).not.toContain("ai");
    expect(p.spheres).toContain("product");
  });

  it("справжнє AI великими літерами лишається", () => {
    expect(parseLocally("I build AI products").industries).toContain("ai");
    expect(parseLocally("работаю с LLM").industries).toContain("ai");
  });

  it("Ethereum Foundation — не благодійність", () => {
    const p = parseLocally("I worked at the Ethereum Foundation");
    expect(p.industries).toContain("web3");
    expect(p.industries).not.toContain("nonprofit");
  });

  it("Middle East — не рівень", () => {
    expect(parseLocally("led Middle East expansion").seniority).not.toBe("middle");
    expect(parseLocally("middle developer").seniority).toBe("middle");
    expect(parseLocally("mid-level engineer").seniority).toBe("middle");
  });

  it("роки досвіду й розмір команди — не зарплата", () => {
    // Клас [k к] містив пробіл, тож будь-яке число з пробілом ставало вилкою.
    expect(parseLocally("I have 10 years of experience").salaryMin).toBeNull();
    expect(parseLocally("I led a team of 25 people").salaryMin).toBeNull();
    expect(parseLocally("managed 150 users").salaryMin).toBeNull();
  });

  it("справжню вилку впізнає", () => {
    expect(parseLocally("from €90k").salaryMin).toBe(90_000);
    expect(parseLocally("90 000 EUR").salaryCurrency).toBe("EUR");
  });

  it("місто більше не вигадується з прийменника", () => {
    // «in Product», «in June», «in Python» ставали містом — а з міста
    // виводиться країна, яка вирішує доступ до національних дошок.
    expect(parseLocally("15 years in Product").location).toBeNull();
    expect(parseLocally("I work in June every year").location).toBeNull();
    expect(parseLocally("шукаю роботу в Берліні").location).toBeNull();
  });
});

describe("режим роботи — набір", () => {
  it("порожній, коли людина нічого про це не сказала", () => {
    expect(parseLocally("product manager").remoteMode).toBe("");
  });
  it("готовність переїхати не змішується з «тільки віддалено»", () => {
    expect(parseLocally("готовий до переїзду").remoteMode).toBe("relocate");
    expect(parseLocally("only remote").remoteMode).toBe("remote_only");
  });
});

describe("підстави", () => {
  it("цитують слова людини, а не переказують їх", () => {
    const p = parseLocally("Я продакт-менеджер, шукаю нову роль");
    expect(p.evidence["sphere:product"]).toContain("продакт");
  });

  it("уривок підрізається до меж слів", () => {
    const text = "Довгий вступний текст, а тут слово продукт, і далі ще багато слів";
    const cut = snippet(text, text.indexOf("продукт"), "продукт".length);
    expect(cut.startsWith("о")).toBe(false);
    expect(cut).toContain("продукт");
  });

  it("не перетинають межу речення", () => {
    // Вікно в 22 символи легко перестрибує крапку, і цитата виходила зшита
    // з двох думок: «міста. Зарплата від 90k EUR. Не хочу назад у».
    const p = parseLocally("Готовий до переїзду, але не в великі міста. Зарплата від 90k EUR. Не хочу назад у рекламу.");
    expect(p.evidence.salary).toBe("Зарплата від 90k EUR");
  });

  it("обрізання по крапці не з'їдає останнє слово", () => {
    // Підрізання до цілих слів застосовувалось і там, де межу вже дала
    // крапка, — і «Я продакт-менеджер» перетворювалось на саме «Я».
    const p = parseLocally("Я продакт-менеджер. Далі йде інший текст.");
    expect(p.evidence["sphere:product"]).toBe("Я продакт-менеджер");
  });

  it("стоять лише для того, що справді поставлено", () => {
    const p = parseLocally("product manager");
    expect(Object.keys(p.evidence)).toEqual(["sphere:product"]);
  });
});

describe("verifyEvidence", () => {
  it("викидає підставу, якої немає в тексті", () => {
    const kept = verifyEvidence(
      { "sphere:product": "продакт-менеджер", "sphere:design": "я дизайнер" },
      "Я продакт-менеджер з Києва");
    expect(kept).toHaveProperty("sphere:product");
    expect(kept).not.toHaveProperty("sphere:design");
  });
});

describe("mergeParsed", () => {
  const local = parseLocally("product manager");

  it("null від моделі означає «не знаю», а не «спитай регулярку»", () => {
    const guessy = parseLocally("senior product manager");
    expect(guessy.seniority).toBe("senior");
    const merged = mergeParsed({ spheres: ["product"], seniority: null }, guessy, "senior product manager");
    expect(merged.seniority).toBeNull();
  });

  it("відкидає значення поза словником", () => {
    const merged = mergeParsed(
      { spheres: ["product", "astrology"], seniority: "wizard", remoteMode: ["teleport"] },
      local, "product manager");
    expect(merged.spheres).toEqual(["product"]);
    expect(merged.seniority).toBeNull();
    expect(merged.remoteMode).toBe("");
  });

  it("приймає режим і списком, і рядком", () => {
    expect(mergeParsed({ remoteMode: "relocate,remote_or_city" }, local, "x").remoteMode)
      .toBe("remote_or_city,relocate");
    expect(mergeParsed({ remoteMode: ["relocate"] }, local, "x").remoteMode).toBe("relocate");
  });

  it("не лишає підстави для значень, які відпали", () => {
    const merged = mergeParsed({ spheres: [] }, local, "product manager");
    expect(merged.evidence).toEqual({});
  });

  it("бере leftover для побажань", () => {
    const merged = mergeParsed({ leftover: "тільки стартапи, без on-call" }, local, "x");
    expect(merged.leftover).toBe("тільки стартапи, без on-call");
  });
});
