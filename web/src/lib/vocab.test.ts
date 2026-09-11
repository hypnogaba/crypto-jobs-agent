import { describe, expect, it } from "vitest";
import { needsCity, parseModes, serializeModes, toggleMode } from "./vocab";

/**
 * «Де хочеш працювати» перестало бути одним вибором. Ці тести стережуть дві
 * речі: старі рядки в базі мусять читатись без міграції, а «тільки віддалено»
 * не має уживатись поруч із варіантом, у якому є місце.
 */
describe("набір варіантів роботи", () => {
  // Старі id живуть у рядках до міграції 0046 і в чернетках бота.
  it("читає старі значення як нові", () => {
    expect(parseModes("remote_only")).toEqual(["remote"]);
    expect(parseModes("remote_or_city")).toEqual(["remote", "city"]);
    expect(parseModes("relocate")).toEqual(["remote", "city"]);
    expect(parseModes("remote_or_city,relocate")).toEqual(["remote", "city"]);
  });

  it("читає новий список і викидає сміття", () => {
    expect(parseModes("city, вигадка ,city")).toEqual(["city"]);
    expect(parseModes("remote,city")).toEqual(["remote", "city"]);
    expect(parseModes(null)).toEqual([]);
  });

  it("зберігає порядок словника, а не порядок натискань", () => {
    expect(serializeModes(["city", "remote"])).toBe("remote,city");
    expect(serializeModes(["relocate"])).toBe("remote,city");
    expect(serializeModes([])).toBe("");
  });

  // Пункти сумісні: дотик по одному не знімає іншого.
  it("перемикає по одному, нічого не витісняючи", () => {
    expect(toggleMode(null, "city")).toBe("city");
    expect(toggleMode("city", "remote")).toBe("remote,city");
    expect(toggleMode("remote,city", "city")).toBe("remote");
    expect(toggleMode("remote_only", "city")).toBe("remote,city");
    expect(toggleMode("city", "city")).toBe("");
  });

  it("місто потрібне лише для офісу", () => {
    expect(needsCity(parseModes("remote"))).toBe(false);
    expect(needsCity(parseModes("remote_only"))).toBe(false);
    expect(needsCity(parseModes(""))).toBe(false);
    expect(needsCity(parseModes("city"))).toBe(true);
    expect(needsCity(parseModes("remote,city"))).toBe(true);
    expect(needsCity(parseModes("relocate"))).toBe(true);
  });
});
