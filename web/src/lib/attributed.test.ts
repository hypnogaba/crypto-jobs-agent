import { describe, expect, it } from "vitest";
import { ATTRIBUTED } from "./attributed.js";

/**
 * Число дощок на головній — це довжина цього списку, а /sources малює його
 * поіменно. Поки головна рахувала сама, вона казала 59 проти двадцяти одного
 * імені на сторінці: правдива цифра, що виглядає брехнею. Ці тести стережуть
 * не число, а те, що воно лишається придатним для показу.
 */
describe("список дощок, які ми називаємо поіменно", () => {
  it("кожен рядок має назву, робоче посилання й позначку", () => {
    for (const s of ATTRIBUTED) {
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(() => new URL(s.url)).not.toThrow();
      expect(s.url.startsWith("https://")).toBe(true);
      expect(s.note.trim().length).toBeGreaterThan(0);
    }
  });

  it("без повторів: двічі названа дошка завищила б число на головній", () => {
    const names = ATTRIBUTED.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const hosts = ATTRIBUTED.map((s) => new URL(s.url).hostname.replace(/^www\./, ""));
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("не порожній — інакше головна показала б нуль дощок", () => {
    expect(ATTRIBUTED.length).toBeGreaterThan(10);
  });
});
