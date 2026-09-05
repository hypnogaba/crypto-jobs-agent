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

/**
 * Три ключі закінчувались двокрапкою й обіцяли адресу наступним рядком, бо
 * адреса там і була, голим текстом разом із токеном. Тепер під ними
 * кнопка, тож речення мусить читатись цілим: людина, яка бачить «…15
 * хвилин:» і порожнечу під ним, вирішить, що повідомлення обрізалось.
 *
 * Тут лишилась ЛИШЕ ця перевірка. «Адреси в тексті немає» довели поведінково
 * в bot-site-link.test.ts на справжньому надісланому повідомленні, а не на
 * словнику — і там воно ловить ще й адресу, зібрану в коді повз ці рядки.
 * Довжину підписів кнопок звіряли з числом 20, узятим зі стелі: воно нічого
 * не описує (Telegram підпис не обмежує, а переносить), і речення замість
 * підпису такий тест усе одно пропускав, якби влізло в двадцять символів.
 */
describe("разове посилання", () => {
  const locales = ["en", "uk", "fr", "ru"] as const;

  it("речення перед кнопкою закінчене, а не обірване двокрапкою", () => {
    for (const key of ["siteLink", "cabinet", "adminLink"] as const)
      for (const l of locales) expect(t(key, l).trimEnd()).not.toMatch(/:$/);
  });
});
