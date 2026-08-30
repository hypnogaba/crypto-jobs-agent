import { describe, expect, it } from "vitest";
import { plausibleSalary, toEur } from "./money.js";

describe("toEur", () => {
  it("зводить валюти до однієї шкали", () => {
    expect(toEur(100_000, "EUR")).toBe(100_000);
    expect(toEur(100_000, "USD")).toBeCloseTo(92_000, 0);
    expect(toEur(100_000, "GBP")).toBeCloseTo(117_000, 0);
  });

  it("регістр валюти не має значення", () => {
    expect(toEur(50_000, "usd")).toBe(toEur(50_000, "USD"));
  });

  it("порожня валюта читається як євро — так її пишемо ми самі", () => {
    expect(toEur(80_000, null)).toBe(80_000);
  });

  it("невідома валюта — мовчання, а не здогад", () => {
    expect(toEur(80_000, "XYZ")).toBeNull();
  });

  it("«від 1 000 USD» на рік — це не вилка", () => {
    // Живий рядок: Senior National Account Executive у Branch. Досі це
    // зараховувалось як мала зарплата й давало вакансії штраф.
    expect(toEur(1_000, "USD")).toBeNull();
  });

  it("порожнє лишається порожнім", () => {
    expect(toEur(null, "EUR")).toBeNull();
    expect(toEur(0, "EUR")).toBeNull();
  });

  it("велика сума в дешевій валюті лишається правдоподібною", () => {
    expect(toEur(1_500_000, "UAH")).toBeCloseTo(33_000, 0);
  });
});

describe("plausibleSalary", () => {
  it("ховає уламок розбору", () => {
    expect(plausibleSalary(1_000, null, "USD")).toBe(false);
  });

  it("лишає справжню вилку", () => {
    expect(plausibleSalary(150_000, 185_000, "EUR")).toBe(true);
  });

  it("дивиться на стелю, а не лише на підлогу", () => {
    expect(plausibleSalary(null, 90_000, "EUR")).toBe(true);
  });
});
