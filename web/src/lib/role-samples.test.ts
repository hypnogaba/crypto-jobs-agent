import { describe, expect, it } from "vitest";
import { meaningfulWords, pickSamples } from "./role-samples";

describe("meaningfulWords", () => {
  it("відкидає загальні слова, лишає те, що називає роботу", () => {
    expect(meaningfulWords("senior community manager")).toEqual(["community"]);
  });

  /**
   * «Head of» без предметного слова нічого не шукає. Якби ми лишили «head»,
   * приклад показав би Head of Sales людині, що шукає Head of Design.
   */
  it("порожньо, коли значущого слова немає зовсім", () => {
    expect(meaningfulWords("head of")).toEqual([]);
  });

  /**
   * Кирилиця розбирається, і загальні слова в ній так само відкидаються:
   * «менеджер» стоїть у половині назв і показав би випадкову вакансію.
   */
  it("розуміє кирилицю й відкидає загальне в ній", () => {
    expect(meaningfulWords("комуніті менеджер")).toEqual(["комуніті"]);
    expect(meaningfulWords("старший розробник")).toEqual(["розробник"]);
  });

  it("не ламається на порожньому", () => {
    expect(meaningfulWords(null)).toEqual([]);
    expect(meaningfulWords("")).toEqual([]);
  });
});

describe("pickSamples", () => {
  const rows = [
    { title: "Community Manager", company: "Polygon" },
    { title: "Head of Community", company: "Polygon" },
    { title: "Community Lead", company: "Aave" },
    { title: "Community Growth", company: "Rarible" },
  ];

  /** Три рядки від однієї фірми не показують, які бувають посади. */
  it("не більше однієї вакансії на компанію", () => {
    expect(pickSamples(rows, 3).map((r) => r.company)).toEqual(["Polygon", "Aave", "Rarible"]);
  });

  it("тримається межі", () => {
    expect(pickSamples(rows, 2)).toHaveLength(2);
  });

  it("назва компанії порівнюється без регістру й пробілів", () => {
    expect(pickSamples([
      { title: "A", company: "Aave" }, { title: "B", company: " aave " },
    ], 3)).toHaveLength(1);
  });

  it("порожній вхід дає порожній вихід, а не помилку", () => {
    expect(pickSamples([], 3)).toEqual([]);
  });
});

import { startsWord, matchesAll, unescapeTitle } from "./role-samples";

/**
 * Хиби, знайдені прогоном на 18 справжніх ролях із бази. Жодну з них не
 * бачили тести, бо всі три жили в поєднанні слів, а не в одному слові.
 */
describe("знайдене прогоном на живих ролях", () => {
  /**
   * Слова з'єднувались через АБО, і «solana auditor» діставав «Night Auditor
   * — Hôtel les Barmes de l'Ours». Приклад, який не має стосунку до людини,
   * гірший за відсутність прикладів: він каже, що ми її не зрозуміли.
   */
  it("потрібні ВСІ слова ролі, а не будь-яке", () => {
    expect(matchesAll("Night Auditor (H/F) - Hôtel", ["solana", "auditor"])).toBe(false);
    expect(matchesAll("Solana Security Auditor", ["solana", "auditor"])).toBe(true);
  });

  /**
   * Правило префіксне навмисно: «communication» мусить ловити
   * «Communications», інакше множина коштувала б людині всіх прикладів.
   * Але слово має ПОЧИНАТИ слово, а не ховатись усередині — та сама пастка,
   * яку вже ловив сканер, де «communication» жило в «Telecommunications».
   */
  it("слово починає слово в назві, а не ховається всередині", () => {
    expect(startsWord("Corporate Communications", "communication")).toBe(true);
    expect(startsWord("Solutions Architect - Telecommunications", "communication")).toBe(false);
    expect(startsWord("Director of Sales", "direct")).toBe(true);
  });

  /**
   * Живий випадок: «Lead Generation Specialist / Direct Manager» діставав
   * «Analyst I, Directed Content». Префікс тут ні до чого — «Directed»
   * чесно починається з «direct». Лікує саме вимога ВСІХ слів: «generation»
   * у тій назві немає.
   */
  it("зайвий збіг одного слова відсікається вимогою всіх", () => {
    expect(startsWord("Analyst I, Directed Content", "direct")).toBe(true);
    expect(matchesAll("Analyst I, Directed Content", ["generation", "direct"])).toBe(false);
    expect(matchesAll("Lead Generation Director", ["generation", "direct"])).toBe(true);
  });

  it("межа слова бачить дефіс і дужку, а не лише пробіл", () => {
    expect(startsWord("Staff Engineer, Full-Stack UI", "stack")).toBe(true);
    expect(startsWord("Product Manager (AI & Discovery)", "ai")).toBe(true);
  });

  /** У кеші лежать HTML-сутності: «Python &amp; JS» показувати людині не можна. */
  it("назва показується без HTML-сутностей", () => {
    expect(unescapeTitle("Senior Fullstack Engineer (Python &amp; JS)"))
      .toBe("Senior Fullstack Engineer (Python & JS)");
    expect(unescapeTitle("R&amp;D Lead &lt;remote&gt;")).toBe("R&D Lead <remote>");
  });
});

describe("сміття в полі назви", () => {
  /**
   * У кеші є рядки, де в `title` лежить цілий абзац опису компанії (живий
   * приклад: Norm Ai, понад 700 символів). Обрізати такий рядок не можна —
   * вийде беззмістовний уривок, — тож він просто не годиться в приклад.
   * Це захист показу, а не спроба полагодити кеш.
   */
  it("абзац замість назви не потрапляє в приклади", () => {
    const long = "ONSITE (hybrid) Norm Ai, the agentic law company, has a client base with a "
      + "combined $30 trillion in assets under management and is hiring across all teams";
    expect(pickSamples([
      { title: long, company: "NYC" },
      { title: "Engineering Manager - Agentic AI", company: "HeartFlow" },
    ], 3).map((r) => r.company)).toEqual(["HeartFlow"]);
  });

  it("звичайна довга назва лишається", () => {
    const ok = "Senior Software Engineer (Full Stack - Node.js, React, MongoDB)";
    expect(pickSamples([{ title: ok, company: "Precisely" }], 3)).toHaveLength(1);
  });
});
