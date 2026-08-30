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
import { fetchCollectionMeta, fetchGetro } from "./sources/getro.js";
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
  let remembered = 0;
  const yields: Array<{ id: number; name: string; jobs: number; companies: number }> = [];

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

      // Досі саме тут знайдене й губилось: компанії лишались, а список живих
      // колекцій розвідка друкувала в журнал і забувала. Через це в базі
      // тримався той самий десяток рядків, а кожен наступний тиждень
      // відкривав ті самі колекції заново.
      const meta = await fetchCollectionMeta(id, { retries: 1 });
      await repo.rememberGetroCollection(id, meta.name, meta.url);
      remembered++;

      const niches = [...new Set(companies.flatMap((c) => c.tags))];
      yields.push({ id, name: meta.name ?? `Колекція ${id}`, jobs: jobs.length, companies: companies.length });
      console.log(`  ${id} ${meta.name ?? "(без назви)"}: ${jobs.length} вакансій → ${companies.length} компаній` +
                  (niches.length ? ` · ${niches.join(", ")}` : ""));
    } catch (e) {
      console.log(`  колекція ${id}: помилка — ${e instanceof Error ? e.message : e}`);
    }
  });

  // Найврожайніші — щоб було видно, які колекції варто увімкнути руками.
  const top = [...yields].sort((a, b) => b.companies - a.companies).slice(0, 15);
  if (top.length) {
    console.log(`\nНайбільше компаній дали:`);
    for (const t of top) console.log(`  ${String(t.companies).padStart(3)} компаній · ${t.id} ${t.name}`);
  }

  const all = await repo.listCompanies();
  console.log(`\nДодано записів компаній: ${added}. Записано колекцій: ${remembered}. ` +
              `Усього компаній у списку: ${all.length}.`);
}

await main();
