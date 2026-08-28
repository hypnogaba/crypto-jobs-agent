import { describe, expect, it } from "vitest";
import { parseFacts, factLabels } from "./facts";

describe("parseFacts", () => {
  it("розбирає JSON зі сканера", () => {
    expect(parseFacts('[{"k":"sphere","v":"operations"},{"k":"remote"}]'))
      .toEqual([{ k: "sphere", v: "operations" }, { k: "remote" }]);
  });

  it("не валиться на сміттi", () => {
    expect(parseFacts("не json")).toEqual([]);
    expect(parseFacts(null)).toEqual([]);
    expect(parseFacts('{"k":"sphere"}')).toEqual([]);   // не масив
    expect(parseFacts('[1,2,"x"]')).toEqual([]);        // не факти
  });
});

describe("factLabels", () => {
  it("розкриває ідентифікатори в назви за локаллю", () => {
    const f = [{ k: "sphere" as const, v: "operations" }, { k: "industry" as const, v: "fintech" }];
    expect(factLabels(f, "uk")).toEqual(["Операції та проєкти", "Фінтех"]);
    expect(factLabels(f, "en")).toEqual(["Operations & Programs", "Fintech"]);
  });

  it("не показує більше за п'ять", () => {
    const f = [
      { k: "sphere" as const, v: "operations" }, { k: "industry" as const, v: "fintech" },
      { k: "level" as const }, { k: "remote" as const }, { k: "salary" as const }, { k: "fresh" as const },
    ];
    expect(factLabels(f, "uk")).toHaveLength(5);
  });

  it("факти без значення беруть підпис із i18n, а не ключ", () => {
    const f = [{ k: "level" as const }, { k: "remote" as const },
               { k: "salary" as const }, { k: "fresh" as const }];
    expect(factLabels(f, "uk")).toEqual(["твій рівень", "віддалено", "вилка підходить", "свіжа"]);
    expect(factLabels(f, "fr")).toEqual(["votre niveau", "à distance", "salaire adapté", "récente"]);
    // Жоден підпис не має бути сирим ключем.
    for (const l of ["en", "uk", "fr", "ru"] as const) {
      expect(factLabels(f, l).some((x) => x.startsWith("fact."))).toBe(false);
    }
  });

  it("невідомий ідентифікатор не валить рендер", () => {
    expect(factLabels([{ k: "sphere", v: "квантова-телепатія" }], "uk")).toEqual(["квантова-телепатія"]);
  });

  it("своя роль показується як написала людина", () => {
    expect(factLabels([{ k: "role", v: "solidity audit" }], "uk")).toEqual(["solidity audit"]);
  });
});
