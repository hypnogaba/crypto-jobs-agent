import { describe, expect, it } from "vitest";
import { COMMANDS, t, tf } from "./bot-copy";
import { LOCALES } from "./i18n";

describe("/lang", () => {
  it("є в меню бота", () => {
    expect(COMMANDS.map((c) => c.command)).toContain("lang");
  });

  it("підтвердження звучить новою мовою, а не старою", () => {
    expect(t("langSet", "uk")).toContain("українською");
    expect(t("langSet", "fr")).toContain("français");
  });

  it("чотири кнопки — рівно наші чотири локалі", () => {
    expect(LOCALES.map((l) => l.id).sort()).toEqual(["en", "fr", "ru", "uk"]);
  });
});

describe("побажання", () => {
  it("цитує написане й веде до /profile", () => {
    const out = tf("wishNoted", "uk", { text: "без on-call" });
    expect(out).toContain("«без on-call»");
    expect(out).toContain("/profile");
  });

  it("обіцянка «ще п'ять» називає стелю на день", () => {
    for (const l of ["en", "uk", "fr", "ru"] as const) expect(t("moreQueued", l)).toContain("20");
  });
});
