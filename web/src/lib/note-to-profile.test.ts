import { describe, expect, it } from "vitest";
import { isEmptyEdit, parseNoteEdit, wishClauses } from "./note-to-profile";

describe("розбір коментаря", () => {
  it("бере лише відомі поля й у відомих межах", () => {
    expect(parseNoteEdit({ levelMax: 2, salaryMax: 4000, avoid: ["sales"], prefer: ["startups"] }))
      .toEqual({ levelMax: 2, salaryMax: 4000, avoid: ["sales"], prefer: ["startups"] });
  });

  it("чуже поле в профіль не потрапляє", () => {
    // Модель читає текст СТОРОННЬОЇ людини. Закритий список — це межа, а не
    // акуратність: усе, чого тут немає, не має куди записатись.
    const e = parseNoteEdit({ levelMax: 2, status: "admin", spheres: ["sales"], userId: "x" });
    expect(Object.keys(e)).toEqual(["levelMax"]);
  });

  it("щабля 4 не існує: «не вище за head» не означає нічого", () => {
    expect(parseNoteEdit({ levelMax: 4 })).toEqual({});
    expect(parseNoteEdit({ levelMax: 0 })).toEqual({});
  });

  it("неправдоподібна сума — це мовчання, а не здогад", () => {
    expect(parseNoteEdit({ salaryMax: 12 })).toEqual({});
    expect(parseNoteEdit({ salaryMax: 5_000_000 })).toEqual({});
  });

  it("посилання й розмітка в побажання не проходять", () => {
    expect(parseNoteEdit({ avoid: ["https://evil.test", "sales", "@someone"] }))
      .toEqual({ avoid: ["sales"] });
  });

  it("порожній розбір видно окремо: бот тоді не вдає, що зрозумів", () => {
    expect(isEmptyEdit(parseNoteEdit({}))).toBe(true);
    expect(isEmptyEdit(parseNoteEdit({ levelMax: 1 }))).toBe(false);
  });

  it("заборони пишуться так, як їх читає splitWishes", () => {
    expect(wishClauses({ prefer: ["startups"], avoid: ["sales", "banks"] }))
      .toBe("startups. no sales, banks");
  });
});
