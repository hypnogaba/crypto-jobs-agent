import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { groupByTag, TAG_LIST_PREFIX, TAG_LIST_SIZE } from "./site-stats.js";

const job = (tag: string, id: string) => ({
  tag, id, title: `T${id}`, company: `C${id}`, location: null, remote: 1,
  url: `https://x/${id}`, posted_at: null, salary_min: null, salary_max: null,
  salary_currency: null, source: "s",
});

describe("списки вакансій для сторінок-добірок", () => {
  it("розкладає рядки одного запиту по тегах", () => {
    const out = groupByTag([job("design", "1"), job("web3", "2"), job("design", "3")]);
    expect([...out.keys()].sort()).toEqual(["design", "web3"]);
    expect(out.get("design")!.map((j) => j.id)).toEqual(["1", "3"]);
  });

  /** Порядок задає SQL; групування не має права його чіпати. */
  it("зберігає порядок, у якому прийшли рядки", () => {
    const out = groupByTag([job("design", "3"), job("design", "1"), job("design", "2")]);
    expect(out.get("design")!.map((j) => j.id)).toEqual(["3", "1", "2"]);
  });

  it("тег більше не носиться в кожній вакансії: він і так ключ", () => {
    expect(groupByTag([job("design", "1")]).get("design")![0]).not.toHaveProperty("tag");
  });

  it("порожній вхід дає порожню мапу, а не помилку", () => {
    expect(groupByTag([]).size).toBe(0);
  });

  /**
   * Дві константи в РІЗНИХ пакетах: скільки скан кладе і скільки сайт
   * показує. Спільного модуля між scanner і web немає, тож розійтися вони
   * можуть мовчки — сторінка почала б показувати менше, ніж є, і ніхто б не
   * помітив. Читаємо чуже джерело файлом: негарно, зате ловить розбіжність у
   * ту саму мить, коли вона з'являється.
   */
  it("розмір списку збігається з PAGE_SIZE на сайті", () => {
    const web = readFileSync(new URL("../../web/src/lib/jobs-pages.ts", import.meta.url), "utf8");
    const size = Number(/export const PAGE_SIZE = (\d+)/.exec(web)?.[1]);
    expect(size, "PAGE_SIZE не знайдено в web/src/lib/jobs-pages.ts").toBeGreaterThan(0);
    expect(TAG_LIST_SIZE).toBe(size);
  });

  it("префікс ключа збігається з тим, що читає сайт", () => {
    const web = readFileSync(new URL("../../web/src/lib/site-stats.ts", import.meta.url), "utf8");
    expect(web).toContain(`export const TAG_LIST_PREFIX = "${TAG_LIST_PREFIX}"`);
  });
});
