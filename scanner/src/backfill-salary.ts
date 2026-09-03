/**
 * Разове дозаповнення вилки для вакансій, які вже лежать у кеші.
 *
 *   node dist/backfill-salary.js [--dry-run] [--refetch N]
 *
 * Джерело — колонка summary: це витяг на ≤240 символів, а не повний текст
 * оголошення (повний текст у базу не пишеться ніколи, див. summary.ts).
 * Витяг зазвичай про роль, а не про гроші, тому знаходить він небагато;
 * повний текст ловить сканер у момент запису (repo.ts) і добірка при
 * поштучному довантаженні (digest.ts).
 *
 * --refetch N — для N найсвіжіших вакансій без вилки, у яких текст можна
 * взяти поштучно (Greenhouse, Rippling, SmartRecruiters), сходити по
 * повний текст. Це N мережевих запитів до чужих API, тому не за замовчуванням.
 *
 * --dry-run — лише порахувати, нічого не писати.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { extractSalary } from "./salary.js";
import { fetchDescription, hasLazyDescription } from "./digest.js";

const BATCH = 500;

interface Row { id: string; url: string; summary: string | null; fetched_at: string }

function parseArgs(argv: string[]): { dryRun: boolean; refetch: number } {
  const i = argv.indexOf("--refetch");
  const n = i === -1 ? 0 : Number.parseInt(argv[i + 1] ?? "0", 10);
  return { dryRun: argv.includes("--dry-run"), refetch: Number.isFinite(n) ? Math.max(0, n) : 0 };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { dryRun, refetch } = parseArgs(process.argv.slice(2));
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  // ── 1. З витягу ──
  let scanned = 0, filled = 0, lastId = "";
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  for (;;) {
    const rows = await d1.query<Row>(
      `SELECT id,url,summary,fetched_at FROM jobs_cache
       WHERE summary IS NOT NULL AND salary_min IS NULL AND salary_max IS NULL AND id > ?
       ORDER BY id LIMIT ?`, [lastId, BATCH]);
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1]!.id;
    scanned += rows.length;
    for (const r of rows) {
      const s = extractSalary(r.summary);
      if (!s) continue;
      filled++;
      updates.push({
        sql: "UPDATE jobs_cache SET salary_min=?, salary_max=?, salary_currency=? WHERE id=? AND salary_min IS NULL AND salary_max IS NULL",
        params: [s.min, s.max, s.currency, r.id],
      });
    }
    process.stdout.write(`  переглянуто ${scanned}, знайдено ${filled}\r`);
  }
  if (!dryRun && updates.length) await d1.batch(updates);
  console.log(`З витягу: переглянуто ${scanned}, знайдено вилку в ${filled}${dryRun ? " (сухий прогін, не записано)" : ""}.`);

  // ── 2. З повного тексту, поштучно ──
  if (refetch > 0) {
    const fresh = await d1.query<Row>(
      `SELECT id,url,summary,fetched_at FROM jobs_cache
       WHERE salary_min IS NULL AND salary_max IS NULL AND fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
       ORDER BY fetched_at DESC LIMIT ?`, [refetch * 5]);
    const lazy = fresh.filter((r) => hasLazyDescription(r.url)).slice(0, refetch);
    let got = 0, hit = 0;
    const more: Array<{ sql: string; params: unknown[] }> = [];
    for (const r of lazy) {
      const text = await fetchDescription(r.url);
      if (!text) continue;
      got++;
      const s = extractSalary(text);
      if (!s) continue;
      hit++;
      more.push({
        sql: "UPDATE jobs_cache SET salary_min=?, salary_max=?, salary_currency=? WHERE id=? AND salary_min IS NULL AND salary_max IS NULL",
        params: [s.min, s.max, s.currency, r.id],
      });
    }
    if (!dryRun && more.length) await d1.batch(more);
    console.log(`З повного тексту: запитано ${lazy.length}, отримано ${got}, знайдено вилку в ${hit}${dryRun ? " (сухий прогін)" : ""}.`);
  }
}

await main();
