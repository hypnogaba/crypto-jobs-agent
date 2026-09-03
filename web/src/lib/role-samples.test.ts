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
