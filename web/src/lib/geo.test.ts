import { describe, expect, it } from "vitest";
import { countryFromLocation, countryFromTimezone, deriveCountry, fixLayout } from "./geo.js";

describe("fixLayout", () => {
  it("розпізнає локацію в неправильній розкладці", () => {
    expect(fixLayout("зфкші")).toBe("paris");   // українська розкладка
    expect(fixLayout("зфкшы")).toBe("paris");   // російська
    expect(fixLayout("дщтвщт")).toBe("london");
  });

  // У базі лежить справжній рядок «зфкши». Він розкодовується як «parib» —
  // на одну клавішу мимо «paris». Ми його НЕ рятуємо: вгадувати описку
  // всередині помилкової розкладки означає підставляти місто, якого людина
  // не писала. Країни в такого профілю не буде, і це чесніше.
  it("не вгадує описку всередині помилкової розкладки", () => {
    expect(fixLayout("зфкши")).toBe("зфкши");
  });

  it("не чіпає справжню кириличну назву", () => {
    expect(fixLayout("Київ")).toBe("Київ");
    expect(fixLayout("Львів")).toBe("Львів");
  });

  it("не чіпає латиницю", () => {
    expect(fixLayout("Berlin")).toBe("Berlin");
  });

  // Кирилиця, переклад якої не дає місця, лишається як є: краще зберегти
  // незрозуміле, ніж підмінити його іншим незрозумілим.
  it("лишає безглузду кирилицю недоторканою", () => {
    expect(fixLayout("абвгд")).toBe("абвгд");
  });

  it("витримує порожнє", () => {
    expect(fixLayout("")).toBe("");
    expect(fixLayout("   ")).toBe("   ");
  });
});

describe("countryFromLocation", () => {
  it("бере країну з назви міста кількома мовами", () => {
    expect(countryFromLocation("Kyiv")).toBe("UA");
    expect(countryFromLocation("Київ, Україна")).toBe("UA");
    expect(countryFromLocation("remote, Paris")).toBe("FR");
    expect(countryFromLocation("Берлін")).toBe("DE");
  });

  it("мовчить, коли місце незнайоме", () => {
    expect(countryFromLocation("десь у горах")).toBeNull();
    expect(countryFromLocation(null)).toBeNull();
    expect(countryFromLocation("")).toBeNull();
  });
});

describe("countryFromTimezone", () => {
  it("знає пояси країн, для яких є дошки", () => {
    expect(countryFromTimezone("Europe/Kyiv")).toBe("UA");
    expect(countryFromTimezone("Europe/Kiev")).toBe("UA");   // стара назва пояса
    expect(countryFromTimezone("Europe/Paris")).toBe("FR");
  });

  // UTC — те, що ставить реєстрація в боті, бо Telegram поясу не надсилає.
  // Це не країна, і вдавати протилежне не можна.
  it("не робить країни з UTC", () => {
    expect(countryFromTimezone("UTC")).toBeNull();
    expect(countryFromTimezone("America/New_York")).toBeNull();
    expect(countryFromTimezone(null)).toBeNull();
  });
});

describe("deriveCountry", () => {
  it("локація б'є пояс", () => {
    expect(deriveCountry("Київ", "Europe/Paris")).toBe("UA");
  });

  it("падає на пояс, коли локації немає", () => {
    expect(deriveCountry(null, "Europe/Kyiv")).toBe("UA");
    expect(deriveCountry("", "Europe/Paris")).toBe("FR");
  });

  it("виправляє розкладку дорогою", () => {
    expect(deriveCountry("зфкші", "UTC")).toBe("FR");
  });

  it("без жодного сигналу лишає порожнє", () => {
    expect(deriveCountry(null, "UTC")).toBeNull();
    expect(deriveCountry("десь", null)).toBeNull();
  });
});
