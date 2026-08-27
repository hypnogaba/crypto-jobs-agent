/**
 * Разова розвідка: перебирає id колекцій Getro і сіє знайдені компанії
 * в постійний список. Живих колекцій приблизно 890, і 80% вакансій у них
 * ведуть прямо в ATS роботодавця.
 *
 *   node dist/discover.js [відId] [доId] [крок]
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { discoverGetroCollections, harvestAtsFromJobs } from "./rungs.js";
import { fetchGetro } from "./sources/getro.js";
import { mapLimit } from "./http.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const from = Number.parseInt(process.argv[2] ?? "20", 10);
  const to = Number.parseInt(process.argv[3] ?? "600", 10);
  const step = Number.parseInt(process.argv[4] ?? "1", 10);

  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  const repo = new Repo(d1);

  const ids: number[] = [];
  for (let i = from; i <= to; i += step) ids.push(i);
  console.log(`Перевіряю ${ids.length} id колекцій Getro (${from}–${to})…`);

  const live = await discoverGetroCollections(ids, 12);
  console.log(`Живих колекцій: ${live.length} → ${live.join(", ")}`);

  let added = 0;
  await mapLimit(live, 4, async (id) => {
    try {
      const jobs = await fetchGetro(id, { retries: 0 }, 2);
      const companies = harvestAtsFromJobs(jobs);
      for (const c of companies) {
        await repo.upsertCompany({
          slug: c.slug, name: c.name, provider: c.provider, atsSlug: c.slug,
          tags: c.tags, discoveredVia: `getro:${id}`,
        });
        added++;
      }
      const niches = [...new Set(companies.flatMap((c) => c.tags))];
      console.log(`  колекція ${id}: ${jobs.length} вакансій → ${companies.length} компаній` +
                  (niches.length ? ` · ${niches.join(", ")}` : ""));
    } catch (e) {
      console.log(`  колекція ${id}: помилка — ${e instanceof Error ? e.message : e}`);
    }
  });

  const all = await repo.listCompanies();
  console.log(`\nДодано записів компаній: ${added}. Усього в списку: ${all.length}.`);
}

await main();
