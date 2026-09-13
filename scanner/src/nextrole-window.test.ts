import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { nextrolePostedSql } from "./nextrole-window.js";
import { isFresh } from "./normalize.js";

/**
 * Правило NextRole на читанні мусить бути ДОСЛІВНО тим, що сканер робив на
 * записі до 13.09: «опубліковано не раніше ніж за 14 днів до скану». Тут
 * воно виконується справжнім SQLite (D1 це SQLite), а не перевіряється на
 * вигляд: помилка формату дат уже раз пропускала кожен одинадцятий рядок
 * (див. sqldates.test.ts).
 */
function passes(rows: Array<{ id: string; posted_at: string | null; fetched_at: string }>): string[] {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE jobs_cache (id TEXT, posted_at TEXT, fetched_at TEXT)");
  const ins = db.prepare("INSERT INTO jobs_cache VALUES (?,?,?)");
  for (const r of rows) ins.run(r.id, r.posted_at, r.fetched_at);
  return (db.prepare(`SELECT id FROM jobs_cache j WHERE ${nextrolePostedSql("j", 14)} ORDER BY id`).all() as Array<{ id: string }>)
    .map((r) => r.id);
}

describe("nextrolePostedSql", () => {
  const scan = "2026-09-11T03:00:11.876Z";
  const before = (days: number, ms = 0) =>
    new Date(Date.parse(scan) - days * 86_400_000 - ms).toISOString();

  it("рівно межа проходить, мілісекунда за нею ні", () => {
    expect(passes([
      { id: "a-edge", posted_at: before(14), fetched_at: scan },
      { id: "b-past", posted_at: before(14, 1), fetched_at: scan },
    ])).toEqual(["a-edge"]);
  });

  it("крипто-рядок 20-денної давності NextRole не бачить, свіжий бачить", () => {
    expect(passes([
      { id: "old", posted_at: before(20), fetched_at: scan },
      { id: "new", posted_at: before(3), fetched_at: scan },
    ])).toEqual(["new"]);
  });

  it("порожня дата проходить", () => {
    expect(passes([{ id: "x", posted_at: null, fetched_at: scan }])).toEqual(["x"]);
  });

  it("збігається з isFresh на момент скану для будь-якої давності", () => {
    const rows = [0, 1, 7, 13.9, 14, 14.001, 15, 29, 31].map((d) => ({ id: `d${d}`, posted_at: before(d), fetched_at: scan }));
    const sql = new Set(passes(rows));
    for (const r of rows) {
      expect(sql.has(r.id), r.id).toBe(isFresh(r.posted_at, 14, new Date(scan)));
    }
  });

  it("без псевдоніма для запитів без `j.`", () => {
    expect(nextrolePostedSql("", 14)).toContain("(posted_at IS NULL OR posted_at >= strftime(");
  });
});
