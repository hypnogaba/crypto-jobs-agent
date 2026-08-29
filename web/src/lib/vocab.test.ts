import { describe, expect, it } from "vitest";
import { needsCity, parseModes, serializeModes, toggleMode } from "./vocab";

/**
 * «Де хочеш працювати» перестало бути одним вибором. Ці тести стережуть дві
 * речі: старі рядки в базі мусять читатись без міграції, а «тільки віддалено»
 * не має уживатись поруч із варіантом, у якому є місце.
 */
describe("набір варіантів роботи", () => {
  it("читає старе значення як список з одного", () => {
    expect(parseModes("remote_or_city")).toEqual(["remote_or_city"]);
    expect(parseModes("remote_only")).toEqual(["remote_only"]);
  });

  it("читає новий список і викидає сміття", () => {
    expect(parseModes("remote_or_city,relocate")).toEqual(["remote_or_city", "relocate"]);
    expect(parseModes("relocate, вигадка ,relocate")).toEqual(["relocate"]);
    expect(parseModes(null)).toEqual([]);
  });

  it("ширший варіант витісняє «тільки віддалено»", () => {
    expect(parseModes("remote_only,relocate")).toEqual(["relocate"]);
  });

  it("зберігає порядок словника, а не порядок натискань", () => {
    expect(serializeModes(["relocate", "remote_or_city"])).toBe("remote_or_city,relocate");
    expect(serializeModes([])).toBe("");
  });

  // Кнопка, яка не вмикається, читається як зламана. Тому виключність
  // розв'язується саме тут, а не мовчазним відкиданням на читанні.
  it("перемикає й тримає виключність «тільки віддалено»", () => {
    expect(toggleMode(null, "relocate")).toBe("relocate");
    expect(toggleMode("relocate", "remote_or_city")).toBe("remote_or_city,relocate");
    expect(toggleMode("remote_or_city,relocate", "relocate")).toBe("remote_or_city");
    expect(toggleMode("remote_or_city,relocate", "remote_only")).toBe("remote_only");
    expect(toggleMode("remote_only", "relocate")).toBe("relocate");
    expect(toggleMode("relocate", "relocate")).toBe("");
  });

  it("місто потрібне лише там, де є місце", () => {
    expect(needsCity(parseModes("remote_only"))).toBe(false);
    expect(needsCity(parseModes(""))).toBe(false);
    expect(needsCity(parseModes("remote_or_city"))).toBe(true);
    expect(needsCity(parseModes("relocate"))).toBe(true);
    expect(needsCity(parseModes("remote_or_city,relocate"))).toBe(true);
  });
});
