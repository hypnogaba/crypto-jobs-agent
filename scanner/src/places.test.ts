import { describe, expect, it } from "vitest";
import { placeFit, placeOf } from "./places.js";

/** Кожен рядок нижче взято з живого кеша, а не вигадано. */
const country = (s: string): string[] => placeOf(s).countries.sort();

describe("placeOf: прямо названа країна", () => {
  it("читає найчастіші форми США", () => {
    for (const s of ["United States", "USA", "US Remote", "Remote - US", "United States (Remote)"]) {
      expect(country(s)).toEqual(["US"]);
    }
  });

  it("читає штат як США", () => {
    expect(country("Illinois ")).toEqual(["US"]);
    expect(country("Costa Mesa, California, United States")).toEqual(["US"]);
  });

  it("читає Британію в кількох написаннях", () => {
    for (const s of ["United Kingdom", "UK", "London, England, United Kingdom"]) {
      expect(country(s)).toEqual(["GB"]);
    }
  });
});

describe("placeOf: назва країни сильніша за словник міст", () => {
  it("«Lake Zurich, Illinois» — не Швейцарія", () => {
    expect(country("Lake Zurich, Illinois, United States")).toEqual(["US"]);
  });

  it("«London, Canada» — не Британія", () => {
    expect(country("London, Canada")).toEqual(["CA"]);
  });

  it("«New South Wales» — не Уельс", () => {
    expect(country("Sydney, New South Wales, Australia")).toEqual(["AU"]);
  });

  it("«Vienna, VA, USA» — не Австрія", () => {
    expect(country("Vienna, VA, USA")).toEqual(["US"]);
  });
});

describe("placeOf: дволітерний код читається останнім", () => {
  it("«Berlin, DE» — Німеччина, а не Делавер", () => {
    expect(country("Berlin, DE")).toEqual(["DE"]);
  });

  it("«Toronto, ca» — Канада, а не Каліфорнія", () => {
    expect(country("Toronto, ca")).toEqual(["CA"]);
  });

  it("код спрацьовує там, де міста немає: «Devens, MA»", () => {
    expect(country("Devens, MA")).toEqual(["US"]);
  });

  it("код серед рядка теж читається: «Columbia, MO (Headquarters)»", () => {
    expect(country("Columbia, MO (Headquarters)")).toEqual(["US"]);
  });

  it("провінції Канади: «Surrey, BC»", () => {
    expect(country("Surrey, BC")).toEqual(["CA"]);
  });
});

describe("placeOf: формат Workday", () => {
  it("«US-CA-Dublin» — Каліфорнія, а не Ірландія", () => {
    expect(country("US-CA-Menlo Park")).toEqual(["US"]);
    expect(country("US-CA-Dublin")).toEqual(["US"]);
  });
});

describe("placeOf: кілька місць в одному рядку", () => {
  it("розділювачі не злипаються", () => {
    expect(country("San Francisco, CA | New York City, NY")).toEqual(["US"]);
    expect(country("Remote, Canada; Remote, United States")).toEqual(["CA", "US"]);
  });

  it("довгий перелік із дошки", () => {
    expect(country("Barcelona · Krakow · Lisbon · Madrid; Poland · Porto · Portugal · Spain · UK"))
      .toEqual(["ES", "GB", "PL", "PT"]);
  });
});

describe("placeOf: те, чого ми не знаємо", () => {
  it("«Remote» саме по собі не є місцем", () => {
    expect(placeOf("Remote").known).toBe(false);
  });

  it("назва офісу не є місцем", () => {
    expect(placeOf("Branch HQ").known).toBe(false);
  });

  it("«Georgia» лишається нерозібраною: штат і країна", () => {
    expect(placeOf("Georgia").known).toBe(false);
  });

  it("порожній рядок", () => {
    expect(placeOf(null).known).toBe(false);
    expect(placeOf("  ").known).toBe(false);
  });
});

describe("placeOf: регіони й «будь-де»", () => {
  it("Europe — регіон, а не перелік країн", () => {
    const p = placeOf("Europe");
    expect(p.countries).toEqual([]);
    expect(p.regions).toEqual(["europe"]);
  });

  it("«Anywhere in the World»", () => {
    expect(placeOf("Anywhere in the World").anywhere).toBe(true);
  });
});

describe("placeOf: кирилиця з національних дощок", () => {
  it("міста читаються без транслітерації", () => {
    expect(country("Київ")).toEqual(["UA"]);
    expect(country("Львів")).toEqual(["UA"]);
    expect(country("Варшава (Польща)")).toEqual(["PL"]);
  });

  it("«за кордоном» — це «будь-де»", () => {
    expect(placeOf("за кордоном").anywhere).toBe(true);
  });
});

describe("placeFit", () => {
  it("своя країна — влучання", () => {
    expect(placeFit(placeOf("Paris, France"), "FR")).toBe("hit");
  });

  it("чужа країна — промах", () => {
    expect(placeFit(placeOf("Illinois "), "FR")).toBe("miss");
  });

  it("нерозібране місце нікого не карає", () => {
    expect(placeFit(placeOf("Remote"), "FR")).toBe("unknown");
    expect(placeFit(placeOf("Branch HQ"), "FR")).toBe("unknown");
  });

  it("людина без країни — теж «не знаємо»", () => {
    expect(placeFit(placeOf("Illinois "), null)).toBe("unknown");
  });

  it("регіон покриває свої країни", () => {
    expect(placeFit(placeOf("Europe"), "FR")).toBe("hit");
    expect(placeFit(placeOf("Europe"), "US")).toBe("miss");
  });

  it("«будь-де» підходить усім", () => {
    expect(placeFit(placeOf("Anywhere in the World"), "UA")).toBe("hit");
  });
});
