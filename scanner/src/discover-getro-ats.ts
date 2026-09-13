/**
 * Щотижневий збір роботодавців з колекцій Getro: `node dist/discover-getro-ats.js [--dry]`.
 *
 * З 13.09.2026 щоденний скан Getro не читає (GETRO_MODE=discover). Причина в
 * умовах Getro: користувач не може робити нічого, що «crawls, scrapes or
 * spiders» будь-яку сторінку чи дані сервісу. А нижчий за ризиком шлях уже
 * був: 80% вакансій у колекціях ведуть прямо в ATS роботодавця (Greenhouse,
 * Lever, Ashby…), чиї публічні API існують саме для того, щоб вакансії
 * читали. Тож із Getro ми беремо тільки ОДНЕ: хто роботодавець і де його ATS.
 * Вакансії далі читає R1 з ATS самої компанії, щодня, як і всі інші.
 *
 * Раз на тиждень замість щодня: п'ята частина запитів до Getro, і жодної
 * вакансії, взятої з Getro, у кеші.
 *
 * Ніша компанії береться з галузей самої організації (`industry_tags`,
 * `topics`), а не з колекції цілком. Колекція «Coinbase» це портфель
 * Coinbase Ventures, і в ній Notion, Ashby, Greenhouse: з тегом колекції вони
 * ставали «крипто-компаніями» (саме тому NextCryptoJob тримає власний список
 * не-крипто компаній). Тег колекції лишається запасом лише для організацій,
 * про галузь яких Getro не знає нічого.
 *
 * Теги наявної компанії тут лише ДОПОВНЮЮТЬСЯ, не замінюються: інакше тиждень,
 * коли Getro забув галузь, стер би нішу, поставлену руками чи міграцією.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { harvestAtsFromJobs } from "./rungs.js";
import { extractAts, fetchGetro } from "./sources/getro.js";
import type { AtsProvider, RawJob } from "./types.js";

/** Ніша вакансії для збору: галузь організації, а колекція лише як запас. */
export function discoveryTags(jobs: RawJob[], collectionTags: string[]): RawJob[] {
  return jobs.map((j) => (j.inheritedTags?.length || !collectionTags.length
    ? j : { ...j, inheritedTags: collectionTags }));
}

/** Наявні теги плюс нові, без повторів; порядок наявних зберігається. */
export function unionTags(existing: string[], found: string[]): string[] {
  return [...new Set([...existing, ...found])];
}

export interface CollectionYield {
  id: number; jobs: number; withAts: number; companies: number; web3Companies: number;
}

/** Що дала одна колекція. Чиста функція: її й перевіряє тест. */
export function collectionYield(
  id: number, jobs: RawJob[], companies: Array<{ tags: string[] }>,
): CollectionYield {
  return {
    id, jobs: jobs.length,
    withAts: jobs.filter((j) => extractAts(j.url) !== null).length,
    companies: companies.length,
    web3Companies: companies.filter((c) => c.tags.includes("web3")).length,
  };
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const cfg = loadConfig();
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  const repo = new Repo(d1);

  const collections = await repo.listGetroCollections();
  const known = new Map((await repo.listCompanies()).map((c) => [c.slug, c]));
  console.log(`Колекцій увімкнено: ${collections.length}. Компаній у списку: ${known.size}.`);

  const yields: CollectionYield[] = [];
  let added = 0;
  let updated = 0;
  // По одній колекції за раз і з паузою між сторінками (fetchGetro):
  // поспіх тут коштує 429, а тиждень чекати нікуди не спішить.
  for (const c of collections) {
    let jobs: RawJob[];
    try {
      jobs = await fetchGetro(c.id, { retries: 3, retryDelayMs: 2_000 }, undefined, 600);
    } catch (e) {
      console.log(`  getro:${c.id}: не відповіла (${e instanceof Error ? e.message : e})`);
      continue;
    }
    const harvested = harvestAtsFromJobs(discoveryTags(jobs, c.tags));
    yields.push(collectionYield(c.id, jobs, harvested));

    for (const h of harvested) {
      const prior = known.get(h.slug);
      const tags = unionTags(prior?.tags ?? [], h.tags);
      // Нічого нового про наявну компанію: не пишемо зовсім. Запис у D1
      // коштує в тисячу разів більше за читання.
      if (prior && prior.atsProvider && tags.length === prior.tags.length) continue;
      if (!dry) {
        await repo.upsertCompany({
          slug: h.slug, name: prior?.name ?? h.name, provider: h.provider as AtsProvider,
          atsSlug: h.slug, tags, discoveredVia: prior?.discoveredVia ?? `getro:${c.id}`,
        });
      }
      if (prior) updated++; else added++;
      known.set(h.slug, {
        slug: h.slug, name: prior?.name ?? h.name, atsProvider: h.provider as AtsProvider,
        atsSlug: h.slug, tags, discoveredVia: prior?.discoveredVia ?? `getro:${c.id}`,
        lastFitAt: prior?.lastFitAt ?? null, lastScannedAt: prior?.lastScannedAt ?? null,
        dryScans: prior?.dryScans ?? 0,
      });
    }
    const y = yields[yields.length - 1]!;
    console.log(`  getro:${c.id}: ${y.jobs} вакансій, ${y.withAts} з публічним ATS ` +
                `(${y.jobs ? Math.round((100 * y.withAts) / y.jobs) : 0}%), ${y.companies} компаній, з них крипто ${y.web3Companies}`);
  }

  const jobs = yields.reduce((a, y) => a + y.jobs, 0);
  const withAts = yields.reduce((a, y) => a + y.withAts, 0);
  console.log(`\nРазом: ${jobs} вакансій, ${withAts} ведуть у публічний ATS ` +
              `(${jobs ? Math.round((100 * withAts) / jobs) : 0}%). ` +
              `Нових компаній ${added}, доповнено тегами ${updated}${dry ? " (--dry: нічого не записано)" : ""}.`);
}

if (process.argv[1]?.endsWith("discover-getro-ats.js")) await main();
