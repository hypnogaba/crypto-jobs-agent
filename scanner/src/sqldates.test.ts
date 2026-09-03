import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Сторож формату дат у SQL.
 *
 * `jobs_cache.fetched_at` і `scan_runs.started_at` пише JS через
 * `toISOString()`: «2026-09-03T03:00:09.128Z». `datetime('now', …)` віддає
 * «2026-08-31 11:20:02», з пробілом замість «T». SQLite порівнює їх як
 * рядки, а «T» (0x54) більша за пробіл (0x20) — тому все, зібране на межовій
 * добі, проходило порівняння незалежно від години.
 *
 * Це не гіпотеза: 03.09 у вікні кандидатів лежало 3 047 зайвих рядків із
 * 32 952, тобто кожна одинадцята вакансія могла піти людині вже знятою з
 * дошки. Помилку легко повторити, дописуючи новий запит, тому тут сторож.
 *
 * Стовпці з форматом SQLite (`sent.created_at`, `api_usage.at`) навпаки
 * ЗОБОВ'ЯЗАНІ порівнюватись через `datetime`, і їх це правило не чіпає.
 */
const ISO_COLUMNS = ["fetched_at", "started_at"];

describe("формат дат у SQL", () => {
  it("ISO-стовпці не порівнюються з datetime('now')", () => {
    const bad: string[] = [];
    for (const f of readdirSync("src").filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const text = readFileSync(`src/${f}`, "utf8");
      for (const line of text.split("\n")) {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        for (const col of ISO_COLUMNS) {
          if (new RegExp(`${col}\\s*[<>]=?\\s*datetime\\(`).test(line)) bad.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
