/**
 * Скільки справжніх локацій ми розбираємо.
 *
 *   node dist/places.coverage.js [--show 60]
 *
 * Зелений юніт-тест на вигаданих рядках уже одного разу пропустив дві живі
 * хиби в дошці DOU. Тому таблиця місць міряється по тому, що справді лежить
 * у кеші, і кожен нерозібраний рядок друкується — з нього й дописується
 * словник.
 *
 * Нічого не пише в базу.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { placeOf } from "./places.js";

async function main(): Promise<void> {
  const show = Number.parseInt(
    process.argv[process.argv.indexOf("--show") + 1] ?? "60", 10) || 60;
  const cfg = loadConfig();
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  const rows = await d1.query<{ location: string; n: number }>(
    `SELECT location, count(*) n FROM jobs_cache
      WHERE fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day') AND location IS NOT NULL AND location <> ''
      GROUP BY location ORDER BY n DESC`);

  let jobsKnown = 0, jobsTotal = 0, rowsKnown = 0;
  const misses: Array<{ location: string; n: number }> = [];
  for (const r of rows) {
    jobsTotal += r.n;
    if (placeOf(r.location).known) { jobsKnown += r.n; rowsKnown++; }
    else misses.push(r);
  }

  const pct = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);
  console.log(`Рядків з локацією: ${rows.length} різних, ${jobsTotal} вакансій.`);
  console.log(`Розібрано: ${rowsKnown} різних (${pct(rowsKnown, rows.length)}), ` +
              `${jobsKnown} вакансій (${pct(jobsKnown, jobsTotal)}).`);
  console.log(`\nНерозібране, найчастіше згори (${Math.min(show, misses.length)} з ${misses.length}):`);
  for (const m of misses.slice(0, show)) console.log(`  ${String(m.n).padStart(4)} | ${m.location}`);

  // Хибне спрацювання коштує дорожче за пропуск, тому розібране теж друкуємо:
  // спершу підозріле (кілька країн в одному рядку), далі випадкова вибірка.
  if (process.argv.includes("--audit")) {
    const parsed = rows.filter((r) => placeOf(r.location).known);
    const many = parsed.filter((r) => placeOf(r.location).countries.length > 1);
    const line = (r: { location: string; n: number }) => {
      const pl = placeOf(r.location);
      const tag = [pl.countries.join("+"), ...pl.regions, pl.anywhere ? "anywhere" : ""]
        .filter(Boolean).join(" ");
      return `  ${String(r.n).padStart(4)} | ${r.location}  ->  ${tag}`;
    };
    console.log(`\nКілька країн в одному рядку (${many.length}), перші ${show}:`);
    for (const r of many.slice(0, show)) console.log(line(r));
    console.log(`\nВипадкова вибірка розібраного:`);
    for (let i = 0; i < show; i++) console.log(line(parsed[Math.floor((i * 7919) % parsed.length)]!));
  }
}

if (process.argv[1]?.endsWith("places.coverage.js")) await main();
