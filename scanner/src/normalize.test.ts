import { describe, expect, it } from "vitest";
import { companyKey, dedupeKey, isFresh, officeOnly, prepare, titleKey } from "./normalize.js";
import type { RawJob } from "./types.js";

/**
 * Дата публікації рахується від сьогодні, а не стоїть числом.
 *
 * Була зашита «2026-08-20», і три тести про `prepare` жили рівно до 3 вересня:
 * вікно свіжості 14 днів закрилось, `prepare` чесно викинув усі рядки, і
 * впало те, що не має стосунку ні до свіжості, ні до дат — схлопування
 * геоклонів і проставляння тегів.
 */
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString();

const raw = (o: Partial<RawJob> = {}): RawJob => ({
  url: "https://jobs.example.com/1", company: "Example Inc.", title: "Partnerships Manager",
  location: "Remote", remote: true, postedAt: daysAgo(7),
  source: "ashby:example", ...o });

describe("companyKey", () => {
  it("прибирає юридичні суфікси й регістр", () => {
    expect(companyKey("Example Inc.")).toBe("example");
    expect(companyKey("EXAMPLE  GmbH")).toBe("example");
  });
  it("не склеює різні компанії", () => {
    expect(companyKey("Solana Foundation")).not.toBe(companyKey("Solana Labs"));
  });
  it("не залишає порожній ключ", () => {
    expect(companyKey("GmbH")).not.toBe("");
  });
});

describe("titleKey", () => {
  it("ігнорує гендерні позначки в назві", () => {
    expect(titleKey("Data Analyst (m/f/d)")).toBe(titleKey("Data  Analyst"));
  });
});

describe("dedupeKey — схлопування геоклонів", () => {
  it("та сама роль у різних країнах дає один ключ", () => {
    expect(dedupeKey(raw({ location: "Berlin, Germany" })))
      .toBe(dedupeKey(raw({ location: "Lisbon, Portugal" })));
  });
  it("різні ролі не схлопуються", () => {
    expect(dedupeKey(raw({ title: "Backend Engineer" })))
      .not.toBe(dedupeKey(raw({ title: "Partnerships Manager" })));
  });
});

describe("isFresh", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  it("приймає свіже", () => expect(isFresh("2026-08-20T00:00:00.000Z", 14, now)).toBe(true));
  it("відкидає старе", () => expect(isFresh("2026-07-01T00:00:00.000Z", 14, now)).toBe(false));
  it("приймає без дати — більшість бордів її не публікують", () =>
    expect(isFresh(null, 14, now)).toBe(true));
});

describe("prepare", () => {
  it("викидає рядки без робочого посилання", () => {
    expect(prepare([raw(), raw({ url: "" }), raw({ url: "mailto:a@b.c" })], 14)).toHaveLength(1);
  });
  it("викидає рядки без назви або компанії", () => {
    expect(prepare([raw({ title: "  " }), raw({ company: "" })], 14)).toHaveLength(0);
  });
  it("схлопує п'ять геоклонів в один рядок", () => {
    const clones = ["Berlin", "Vienna", "Madrid", "Rome", "Lisbon"].map((city, i) =>
      raw({ location: city, url: `https://x.test/${i}` }));
    expect(prepare(clones, 14)).toHaveLength(1);
  });
  it("проставляє теги", () => {
    const [job] = prepare([raw({ title: "Senior Partnerships Manager" })], 14);
    expect(job!.tags).toContain("partnerships");
    expect(job!.tags).not.toContain("senior");
  });
});

describe("дедуплікація за повнотою", () => {
  const job = (source: string, extra: Partial<RawJob> = {}): RawJob => ({
    url: `https://${source}/1`, company: "Ondo Finance", title: "Strategic Finance Lead",
    location: null, remote: true, postedAt: "2026-08-29T00:00:00Z", source, ...extra,
  });

  /**
   * Живий випадок: web3.career віддавав 435 свіжих вакансій, а в кеш сідало 94.
   * Вигравала не багатша дошка, а та, що стоїть раніше за алфавітом
   * (`board:global-jobstash` перед `board:global-web3career`).
   */
  it("лишає запис із зарплатою, а не той, що прийшов першим", () => {
    const bare = job("board:global-jobstash");
    const rich = job("board:global-web3career", { salaryMin: 135050, salaryMax: 300000 });
    const kept = prepare([bare, rich], 14, new Date("2026-08-30T00:00:00Z"));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.source).toBe("board:global-web3career");
    expect(kept[0]!.salaryMin).toBe(135050);
  });

  it("за рівної повноти порядок надходження зберігається", () => {
    const a = job("board:a");
    const b = job("board:b");
    expect(prepare([a, b], 14, new Date("2026-08-30T00:00:00Z"))[0]!.source).toBe("board:a");
  });

  it("опис важить менше за зарплату", () => {
    const withText = job("board:text", { description: "Довгий опис ролі." });
    const withPay = job("board:pay", { salaryMin: 90000 });
    expect(prepare([withText, withPay], 14, new Date("2026-08-30T00:00:00Z"))[0]!.source)
      .toBe("board:pay");
  });
});

describe("officeOnly", () => {
  /** Справжні локації з кеша, у яких стоїть remote=1. */
  it("забирає віддаленість там, де написано лише офіс", () => {
    for (const loc of ["Tallinn Office", "NYC Office", "San Jose Office (HQ)",
                       "Sofia Bulgaria or Milan Italy In office not remote"]) {
      expect(officeOnly(loc), loc).toBe(true);
    }
  });

  /**
   * Ці пропонують ОБИДВА варіанти. Забрати в них віддаленість — помилка в
   * гіршу сторону: сховати справді віддалену вакансію гірше, ніж показати
   * зайву офісну.
   */
  it("лишає віддаленість там, де запропоновано вибір", () => {
    for (const loc of ["Remote or In Office", "NY office OR Remote - US",
                       "Office Location or Remote - USA", "Remote Home Office - United States"]) {
      expect(officeOnly(loc), loc).toBe(false);
    }
  });

  /**
   * Здогадуватись за назвою місця ми НЕ беремось: перевірка на живих локаціях
   * показала помилку на кожній четвертій. «Hamburg» може бути і офісом, і
   * хабом віддаленої компанії — прапорцю тут віримо.
   */
  it("не чіпає звичайні назви місць", () => {
    for (const loc of ["Hamburg", "United States", "LATAM", "New York, NY", "", null]) {
      expect(officeOnly(loc), String(loc)).toBe(false);
    }
  });

  it("у prepare прапорець джерела програє власній локації", () => {
    const job = { url: "https://x/1", company: "ICEYE", title: "Manufacturing Engineer",
      location: "Espoo Office", remote: true, postedAt: "2026-08-29T00:00:00Z", source: "ashby:iceye" };
    expect(prepare([job], 14, new Date("2026-08-30T00:00:00Z"))[0]!.remote).toBe(false);
  });
});
