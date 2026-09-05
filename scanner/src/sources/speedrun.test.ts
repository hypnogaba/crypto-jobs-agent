import { describe, expect, it, vi } from "vitest";
import {
  collectionTag, fetchApplyUrl, fetchSpeedrun, firstJobId, isRemoteRole,
  mapSpeedrunIndustries, toRawJob, yearlyComp,
} from "./speedrun.js";

/**
 * Словник галузей — не вигаданий, а знятий з усіх 800 компаній мережі
 * 05.09.2026. Тому тест перелічує його ПОВНІСТЮ: і мітки, що дають тег, і
 * мітки, що не дають нічого. Друге важливіше за перше — саме там ховається
 * правдоподібне правило, яке тегує зайве.
 */
const VOCABULARY: Array<[string, string[]]> = [
  ["Enterprise", []],
  ["AI", ["ai"]],
  ["Industrials", []],
  ["American Dynamism", []],
  ["Fintech", ["fintech"]],
  ["Consumer", []],
  ["Bio Health", ["health"]],
  ["Healthcare", ["health"]],
  ["Crypto/Web3", ["web3"]],
  ["Security", []],
  ["B2B", []],
  ["Fintecha16z", ["fintech"]],
  ["Enterprise SaaS", []],
  ["AI Agents", ["ai"]],
  ["Games", ["games"]],
  ["Manufacturing / Industrials", []],
  ["Media / Entertainment / Creator Economy", []],
  ["Gaming", ["games"]],
  ["AI Generative Media", ["ai"]],
  ["Commerce / Marketplaces", ["ecommerce"]],
  ["Dev Tools & DevOps", []],
  ["AI Infra", ["ai"]],
  ["Sales / GTM", []],
  ["Cybersecurity", []],
  ["Robotics", []],
  ["Adtech / Marketing Tech", []],
  ["Gov Tech / Defense", ["defence"]],
  ["HR Tech / Talent", []],
  ["Sports Tech", []],
  ["Infra", []],
  ["AI Automation", ["ai"]],
  ["Financial Services", ["fintech"]],
  ["Edtech", []],
  ["Deep Tech", []],
  ["Construction Tech", []],
  ["Biotech / Pharma", ["health"]],
  ["Real Estate / Prop Tech", []],
  ["Hardware", []],
  ["AI Voice", ["ai"]],
];

describe("mapSpeedrunIndustries — увесь живий словник, а не зразок", () => {
  for (const [label, expected] of VOCABULARY) {
    it(`«${label}» → ${expected.length ? expected.join(", ") : "нічого"}`, () => {
      expect(mapSpeedrunIndustries([label])).toEqual(expected);
    });
  }

  it("«American Dynamism» НЕ вважається обороною", () => {
    // 126 компаній із цією міткою. Оборона в рубриці a16z лише частина: там
    // же виробництво, енергія, освіта й житло.
    expect(mapSpeedrunIndustries(["American Dynamism"])).not.toContain("defence");
  });

  it("оборону дає колекція, названа поіменно", () => {
    expect(collectionTag("defense")).toBe("defence");
    expect(collectionTag("aero-space")).toBe("defence");
    expect(collectionTag("backed-by-sequoia-capital")).toBeNull();
  });

  it("порожні мітки дають порожній список, а не здогад", () => {
    expect(mapSpeedrunIndustries(undefined)).toEqual([]);
    expect(mapSpeedrunIndustries([])).toEqual([]);
    expect(mapSpeedrunIndustries([" "])).toEqual([]);
  });
});

describe("yearlyComp — множник називає джерело, не величина суми", () => {
  it("порожній період означає рік", () => {
    // 156 виміряних рядків без періоду: найменший 71 000, найбільший 400 000.
    expect(yearlyComp(165000, null)).toBe(165000);
  });
  it("година множиться на 2080, а не лишається річними двадцятьма чотирма", () => {
    expect(yearlyComp(24, "hour")).toBe(49920);
  });
  it("місяць множиться на дванадцять", () => {
    expect(yearlyComp(6600, "month")).toBe(79200);
  });
  it("рік лишається собою", () => {
    expect(yearlyComp(200000, "year")).toBe(200000);
  });
  it("порожнє лишається порожнім", () => {
    expect(yearlyComp(null, "year")).toBeNull();
    expect(yearlyComp(undefined, null)).toBeNull();
    expect(yearlyComp(0, "hour")).toBeNull();
  });
  it("сума поза межами розумного відкидається", () => {
    expect(yearlyComp(10, null)).toBeNull();
    expect(yearlyComp(25_000_000, "year")).toBeNull();
  });
});

describe("isRemoteRole — коли джерело сперечається саме з собою", () => {
  it("тип робочого місця перемагає прапорець", () => {
    // Виміряно: один рядок із 600 має remote:true при workplace_type:"OnSite".
    expect(isRemoteRole({ remote: true, workplace_type: "OnSite" })).toBe(false);
  });
  it("«Onsite» і «OnSite» — те саме слово", () => {
    expect(isRemoteRole({ remote: false, workplace_type: "Onsite" })).toBe(false);
    expect(isRemoteRole({ remote: false, workplace_type: "OnSite" })).toBe(false);
  });
  it("гібрид не віддалений", () => {
    expect(isRemoteRole({ remote: true, workplace_type: "Hybrid" })).toBe(false);
  });
  it("без типу вирішує прапорець", () => {
    expect(isRemoteRole({ remote: true, workplace_type: null })).toBe(true);
    expect(isRemoteRole({ remote: false })).toBe(false);
  });
});

describe("toRawJob", () => {
  const sample = {
    id: "04fee381", title: "Research Strategy Lead", company: "Sprig",
    url: "https://speedrun-talent-network.com/jobs/research-strategy-lead-sprig-04fee381?utm_source=nextrole&utm_medium=agent",
    location: "San Francisco, CA", workplace_type: "Hybrid", employment_type: "FullTime",
    remote: false, comp_min: 165000, comp_max: 200000, comp_currency: "USD",
    comp_period: null, published_at: "2026-09-04T20:43:03.327+00:00", stealth: false,
  };

  it("бере вилку, місце, зайнятість і дату", () => {
    const j = toRawJob(sample)!;
    expect(j.company).toBe("Sprig");
    expect(j.salaryMin).toBe(165000);
    expect(j.salaryMax).toBe(200000);
    expect(j.salaryCurrency).toBe("USD");
    expect(j.commitment).toBe("FullTime");
    expect(j.remote).toBe(false);
    expect(j.postedAt).toBe("2026-09-04T20:43:03.327Z");
  });

  it("не зрізає utm — це атрибуція, якої джерело просить", () => {
    expect(toRawJob(sample)!.url).toContain("utm_source=nextrole");
  });

  it("читає обидва вигляди дати, які приходять в одній відповіді", () => {
    expect(toRawJob({ ...sample, published_at: "2026-08-21T22:49:34.298Z" })!.postedAt)
      .toBe("2026-08-21T22:49:34.298Z");
  });

  it("приховану компанію не бере: назва замаскована, іти нікуди", () => {
    expect(toRawJob({ ...sample, stealth: true, company: "Stealth" })).toBeNull();
  });

  it("рядок без адреси або назви відкидається", () => {
    expect(toRawJob({ ...sample, url: undefined })).toBeNull();
    expect(toRawJob({ ...sample, title: undefined })).toBeNull();
    expect(toRawJob({ ...sample, company: undefined })).toBeNull();
  });
});

const page = (n: number, publishedAt: string, totalPages = 60) => ({
  total_pages: totalPages,
  jobs: Array.from({ length: 50 }, (_, i) => ({
    id: `id-${n}-${i}`, title: `Role ${i}`, company: `Co ${i}`,
    url: `https://speedrun-talent-network.com/jobs/role-${n}-${i}`,
    published_at: publishedAt, remote: false, stealth: false,
  })),
});

describe("fetchSpeedrun — гортання спиняє дата, а не стеля", () => {
  it("спиняється на першій сторінці, хвіст якої старший за межу свіжості", async () => {
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const fetchImpl = vi.fn(async (url: string) => {
      const p = Number(new URL(url).searchParams.get("page"));
      return new Response(JSON.stringify(page(p, p < 2 ? fresh : stale)),
        { status: 200, headers: { "content-type": "application/json" } });
    });

    const jobs = await fetchSpeedrun({ fetchImpl: fetchImpl as unknown as typeof fetch });

    // Сторінки 0 і 1 свіжі, 2 — ні: читаємо рівно три й зупиняємось.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(jobs).toHaveLength(150);
    expect(jobs[0]!.source).toBe("aggregator:speedrun");
  });

  it("передає ?source= на кожному запиті — це вони й просять", async () => {
    const stale = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(page(0, stale)), { status: 200 }));

    await fetchSpeedrun({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain("source=nextrole");
  });

  it("порожня сторінка спиняє гортання", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jobs: [], total_pages: 60 }), { status: 200 }));

    const jobs = await fetchSpeedrun({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(jobs).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/**
 * Форма відповіді відрізняється між списком і деталлю, і це коштувало
 * двадцяти живих компаній поспіль із висновком «ATS невідомий». У списку
 * ролі лежать нагорі, у деталі роль загорнута в `job`. Тест перевіряє саме
 * ту форму, яку віддає сервер.
 */
describe("fetchApplyUrl — адреса ATS лежить усередині `job`", () => {
  const reply = (body: unknown) => vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200 }));

  it("читає загорнуту відповідь, як її віддає сервер", async () => {
    const fetchImpl = reply({
      job: { id: "x", apply: { kind: "external", url: "https://boards.greenhouse.io/figma/jobs/6179155004" } },
      source: "nextrole",
    });
    await expect(fetchApplyUrl("x", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toBe("https://boards.greenhouse.io/figma/jobs/6179155004");
  });

  it("не падає, якщо адреса колись переїде на верхній рівень", async () => {
    const fetchImpl = reply({ apply: { url: "https://jobs.ashbyhq.com/sprig/1/application" } });
    await expect(fetchApplyUrl("x", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toBe("https://jobs.ashbyhq.com/sprig/1/application");
  });

  it("подача на самому борді — не адреса ATS", async () => {
    const fetchImpl = reply({ job: { apply: { kind: "internal" } } });
    await expect(fetchApplyUrl("x", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toBeNull();
  });

  it("firstJobId бере першу роль компанії", async () => {
    const fetchImpl = reply({ company: { slug: "figma", jobs: [{ id: "a" }, { id: "b" }] } });
    await expect(firstJobId("figma", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toBe("a");
  });

  it("компанія без відкритих ролей дає null, а не виняток", async () => {
    const fetchImpl = reply({ company: { slug: "figma", jobs: [] } });
    await expect(firstJobId("figma", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toBeNull();
  });
});
