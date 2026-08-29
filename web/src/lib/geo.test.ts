import { describe, expect, it } from "vitest";
import { countryFromLocation, countryFromTimezone, deriveCountry, fixLayout, timezoneFor } from "./geo.js";

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

  // Раніше пояс був запасним сигналом. Тепер ні: національні дошки — це
  // про намір («хочу працювати в Україні»), а не про місце перебування.
  it("пояс країни НЕ визначає", () => {
    expect(deriveCountry(null, "Europe/Kyiv")).toBeNull();
    expect(deriveCountry("", "Europe/Paris")).toBeNull();
  });

  it("виправляє розкладку дорогою", () => {
    expect(deriveCountry("зфкші", "UTC")).toBe("FR");
    expect(deriveCountry("зфкші", null)).toBe("FR");
  });

  it("без жодного сигналу лишає порожнє", () => {
    expect(deriveCountry(null, "UTC")).toBeNull();
    expect(deriveCountry("десь", null)).toBeNull();
  });
});

describe("timezoneFor", () => {
  it("місто б'є мову", () => {
    expect(timezoneFor("en", "Львів")).toBe("Europe/Kyiv");
    expect(timezoneFor("uk", "Paris")).toBe("Europe/Paris");
    expect(timezoneFor("ru", "Warsaw")).toBe("Europe/Warsaw");
  });
  it("без міста — з мови, і лише там, де мова щось каже про місце", () => {
    expect(timezoneFor("uk", null)).toBe("Europe/Kyiv");
    expect(timezoneFor("fr", "")).toBe("Europe/Paris");
    expect(timezoneFor("en", null)).toBe("UTC");
    expect(timezoneFor("ru", null)).toBe("UTC");
  });
  it("невпізнане місто — знову з мови", () => {
    expect(timezoneFor("fr", "Springfield")).toBe("Europe/Paris");
  });
});
