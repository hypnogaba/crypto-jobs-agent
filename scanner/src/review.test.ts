import { describe, expect, it } from "vitest";
import { review, type Snapshot } from "./review.js";

const empty: Snapshot = {
  brokenNeverWorked: [], deprecatedButAlive: [], dryCompanies: [],
  providerShare: [], totalJobs: 0, staleJobs: 0, duplicateRoles: 0,
  countriesWithoutBoard: [],
};

describe("тижневий самоперегляд", () => {
  it("мовчить, коли все гаразд", () => {
    expect(review(empty)).toEqual([]);
  });

  it("згортає сотню однакових в одну пропозицію", () => {
    // Перший прогін дав 145 пропозицій, із них 142 однакові — це стіна,
    // а не робота. Однотипне має бути одним рядком з однією кнопкою.
    const many = Array.from({ length: 142 }, (_, i) => ({ source: `greenhouse:x${i}`, days: 2 }));
    const out = review({ ...empty, brokenNeverWorked: many });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("deprecate_never_worked");
    expect(out[0]!.title).toContain("142");
    expect(out[0]!.evidence).toContain("та ще 139");
  });

  it("повернення втраченого важливіше за прибирання", () => {
    const out = review({ ...empty, deprecatedButAlive: ["lever:finn"] });
    expect(out[0]!.kind).toBe("revive_source");
    expect(out[0]!.severity).toBe("high");
  });

  it("помічає, коли один провайдер тримає забагато", () => {
    const out = review({ ...empty, providerShare: [
      { provider: "greenhouse", jobs: 700 }, { provider: "lever", jobs: 300 },
    ]});
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("notice");
    expect(out[0]!.title).toContain("70%");
  });

  it("не б'є на сполох, коли частки здорові — 40% це вже поріг, а не запас", () => {
    const out = review({ ...empty, providerShare: [
      { provider: "greenhouse", jobs: 340 }, { provider: "lever", jobs: 330 },
      { provider: "ashby", jobs: 330 },
    ]});
    expect(out).toEqual([]);
  });

  it("рахує мертвий кеш у відсотках, а не в штуках", () => {
    const out = review({ ...empty, totalJobs: 1000, staleJobs: 300 });
    expect(out[0]!.title).toContain("30%");
  });

  it("мовчить про кеш, поки частка невелика", () => {
    expect(review({ ...empty, totalJobs: 1000, staleJobs: 100 })).toEqual([]);
  });

  it("не вигадує дію там, де її немає", () => {
    // Спостереження без кнопки мусить бути notice, а не вдавати роботу.
    const out = review({ ...empty, totalJobs: 100, staleJobs: 90, duplicateRoles: 500 });
    expect(out.every((p) => p.kind === "notice")).toBe(true);
  });

  it("кожне повідомлення має власний ключ, інакше вони витісняють одне одного", () => {
    // Перший справжній прогін згенерував 3 пропозиції, а зберіг 2: унікальний
    // індекс іде по kind+target, і два notice з порожнім target схлопнулись.
    const out = review({
      ...empty, totalJobs: 1000, staleJobs: 900, duplicateRoles: 500,
      providerShare: [{ provider: "greenhouse", jobs: 900 }, { provider: "lever", jobs: 100 }],
    });
    const keys = out.map((p) => `${p.kind}|${p.target ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("країна без дошки", () => {
  it("просить дошку там, звідки вже є люди", () => {
    const out = review({ ...empty, countriesWithoutBoard: [{ country: "PL", people: 3 }] });
    expect(out).toHaveLength(1);
    expect(out[0]!.target).toBe("no_board:PL");
    expect(out[0]!.title).toContain("PL");
    expect(out[0]!.evidence).toContain("3");
  });

  // Ключ іде по парі kind+target, тож дві країни не сміють схлопнутись
  // в одне повідомлення — на цьому вже раз обпеклись.
  it("не схлопує дві країни в одну", () => {
    const out = review({ ...empty, countriesWithoutBoard: [
      { country: "PL", people: 3 }, { country: "DE", people: 1 },
    ]});
    expect(new Set(out.map((p) => p.target)).size).toBe(2);
  });

  it("мовчить, поки таких країн немає", () => {
    expect(review(empty)).toEqual([]);
  });
});
