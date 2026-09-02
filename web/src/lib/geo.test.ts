import { describe, expect, it } from "vitest";
import { countryFromLocation, countryFromTimezone, deriveCountry, fixLayout, timezoneFor, toLatin } from "./geo.js";

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

describe("toLatin", () => {
  it("відомі міста — усталеним правописом, не побуквенно", () => {
    expect(toLatin("Київ")).toBe("Kyiv");
    expect(toLatin("Київ, Львів")).toBe("Kyiv, Lviv");
    expect(toLatin("Кривий Ріг")).toBe("Kryvyi Rih");
    expect(toLatin("Івано-Франківськ")).toBe("Ivano-Frankivsk");
  });

  it("латиницю не чіпає", () => {
    expect(toLatin("Berlin, DE")).toBe("Berlin, DE");
    expect(toLatin("Paris, Lyon")).toBe("Paris, Lyon");
    expect(toLatin("Remote")).toBe("Remote");
  });

  it("невідоме слово — побуквенно, а не кирилицею", () => {
    const out = toLatin("Бориспіль");
    expect(out).toBe("Boryspil");
    expect(/\p{Script=Cyrillic}/u.test(out)).toBe(false);
  });

  it("велика літера лишається великою", () => {
    expect(toLatin("Ялта")).toBe("Yalta");
    expect(toLatin("Южне")).toBe("Yuzhne");
  });

  it("мішаний рядок: кирилиця перекладається, решта — ні", () => {
    expect(toLatin("Київ, Poland")).toBe("Kyiv, Poland");
  });
});

/**
 * Розширення словника з 12 країн до 75.
 *
 * Приклад, з якого все почалось: «Антверпен» не давав нічого, бо Бельгії в
 * списку не було взагалі, — а без країни людина не бачить локальних вакансій
 * і навіть не потрапляє в перелік країн, для яких треба шукати дошку.
 */
describe("countryFromLocation — розширений словник", () => {
  it("знає Бельгію, з якої почалась ця робота", () => {
    expect(countryFromLocation("Антверпен")).toBe("BE");
    expect(countryFromLocation("Antwerp")).toBe("BE");
    expect(countryFromLocation("Antwerpen, Belgium")).toBe("BE");
    expect(countryFromLocation("Brussels")).toBe("BE");
    expect(countryFromLocation("Гент")).toBe("BE");
  });

  it("знає країни трьома мовами", () => {
    expect(countryFromLocation("Тбілісі")).toBe("GE");
    expect(countryFromLocation("Vilnius")).toBe("LT");
    expect(countryFromLocation("Бангалор")).toBe("IN");
    expect(countryFromLocation("São Paulo")).toBe("BR");
    expect(countryFromLocation("Кейптаун")).toBe("ZA");
    expect(countryFromLocation("Торонто")).toBe("CA");
    expect(countryFromLocation("Nairobi")).toBe("KE");
  });

  /**
   * Пастки, які створює сам порядок списку: перший збіг перемагає, тож
   * омонім, поставлений вище, мовчки забирає чужі міста.
   */
  it("не плутає штат Джорджія з країною Грузія", () => {
    // «georgia» голим словом із GE прибрано саме через це.
    expect(countryFromLocation("Atlanta, Georgia")).toBe("US");
    // Країна лишається впізнаваною за столицею й за назвою іншими мовами.
    expect(countryFromLocation("Грузія")).toBe("GE");
    expect(countryFromLocation("Tbilisi, Georgia")).toBe("GE");
  });

  it("не бачить міста всередині довшого слова", () => {
    // «Cali» всередині «California» — не колумбійське Калі.
    expect(countryFromLocation("California")).not.toBe("CO");
    // «Zug» усередині німецького слова — не швейцарський Цуг.
    expect(countryFromLocation("Flugzeugbau")).not.toBe("CH");
  });

  it("мовчить там, де місця немає", () => {
    expect(countryFromLocation("будь-де")).toBeNull();
    expect(countryFromLocation("remote")).toBeNull();
    expect(countryFromLocation("")).toBeNull();
  });
});

describe("міста, яких бракувало живим профілям", () => {
  // Обидва рядки лежали в базі 02.09 і давали порожню країну, тобто людина
  // не отримувала ні місцевих вакансій, ні національних дощок.
  it("Херсон — це Україна", () => {
    expect(countryFromLocation("Kherson")).toBe("UA");
    expect(countryFromLocation("Херсон")).toBe("UA");
  });
  it("Норрчепінг — це Швеція", () => {
    expect(countryFromLocation("Norrkoping")).toBe("SE");
    expect(countryFromLocation("Norrköping")).toBe("SE");
  });
  it("решта обласних центрів теж", () => {
    for (const city of ["Миколаїв", "Чернігів", "Ужгород", "Кривий Ріг", "Запоріжжя"]) {
      expect(countryFromLocation(city)).toBe("UA");
    }
  });
});
