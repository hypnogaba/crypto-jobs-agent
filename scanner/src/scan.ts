import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { climbLadder, type LadderRungs } from "./ladder.js";
import { applySourceOutcomes, skipSet } from "./selfrepair.js";
import { runR1, runR2, runR3, runR4, harvestAtsFromJobs } from "./rungs.js";
import { prepare } from "./normalize.js";
import type { RawJob, SourceResult } from "./types.js";
import { fetchBoard } from "./sources/boards.js";
import { mapLimit, runSource } from "./http.js";

/** Колекції Getro, підтверджені живими. Перебір нових — окремою командою. */
const GETRO_COLLECTIONS = [100, 150, 200, 250, 300, 400, 550, 800, 858, 950, 1000, 1100, 1200, 1300, 1500];

async function main(): Promise<void> {
  const cfg = loadConfig();
  const now = new Date();
  const runId = crypto.randomUUID();

  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  const repo = new Repo(d1);

  await repo.startRun(runId, now.toISOString());
  const prior = await repo.listSourceStates();
  const skip = skipSet(prior);

  // Агрегатори — єдине джерело НЕВІДОМИХ компаній, тому саме вони сіють зростання
  let r2Jobs: RawJob[] = [];

  const rungs: LadderRungs = {
    R1: async () => {
      const companies = await repo.listCompanies();
      if (companies.length === 0) return { jobs: [], results: [] };
      return runR1(companies, {
        markScanned: (slug, found) => repo.markCompanyScanned(slug, found),
        learnAts: (slug, name, provider, atsSlug) =>
          repo.upsertCompany({ slug, name, provider, atsSlug, discoveredVia: "ats_probe" }),
      });
    },

    R2: async () => {
      const run = await runR2(skip);
      r2Jobs = run.jobs;          // знадобиться для зростання, щоб не тягнути двічі
      return run;
    },

    R3: async () => {
      const run = await runR3(GETRO_COLLECTIONS, skip);
      // 80% вакансій Getro ведуть прямо в ATS — забираємо ці компанії собі назавжди
      const harvested = harvestAtsFromJobs(run.jobs);
      for (const c of harvested) {
        await repo.upsertCompany({
          slug: c.slug, name: c.name, provider: c.provider, atsSlug: c.slug,
          tags: ["web3"], discoveredVia: "getro",
        });
      }
      if (harvested.length) console.log(`   R3 забрав ${harvested.length} компаній із ATS-лінків`);
      return run;
    },

    R4: async (pool: RawJob[]) => {
      const known = await repo.knownCompanyKeys();
      const run = await runR4(pool, known, {
        addCompany: (c) => repo.upsertCompany({
          slug: c.slug, name: c.name, provider: c.provider, atsSlug: c.atsSlug, discoveredVia: c.discoveredVia,
        }),
      });
      console.log(`   R4 знайшов ${run.added} нових компаній`);
      return run;
    },

    R5: async () => {
      if (!cfg.anthropicApiKey) {
        console.log("   R5 пропущено — немає ANTHROPIC_API_KEY");
        return { jobs: [], results: [] };
      }
      return { jobs: [], results: [] };
    },
  };

  try {
    const outcome = await climbLadder(rungs, {
      distinctCompanyTarget: cfg.distinctCompanyTarget,
      freshnessDays: cfg.freshnessDays,
      now,
      onRung: (line) => console.log(line),
    });

    await repo.upsertJobs(outcome.jobs);

    // ── Національні дошки — поза драбиною ────────────────────
    // Драбина зупиняється, щойно компаній вистачає, і на практиці це завжди
    // R2. Дошка, повішена сходинкою, не читалася б ніколи. Але вона й не
    // про достатність: людині з України київські вакансії потрібні навіть у
    // день, коли глобальних знайшлося вдосталь.
    const boardResults: SourceResult[] = [];
    try {
      const boards = (await repo.listBoards()).filter((b) => !skip.has(b.name));
      if (boards.length) {
        const runs = await mapLimit(boards, 4, (b) => runSource(b.name, () => fetchBoard(b)));
        boardResults.push(...runs);
        const jobs = prepare(runs.flatMap((r) => r.jobs), cfg.freshnessDays, now);
        await repo.upsertJobs(jobs);
        const alive = runs.filter((r) => r.ok).length;
        console.log(`Національні дошки: ${alive}/${boards.length} відповіли, ${jobs.length} вакансій`);
      }
    } catch (e) {
      console.log(`Дошки пропущено: ${e instanceof Error ? e.message : e}`);
    }

    // ── Зростання окремо від достатності ─────────────────────
    // Драбина відповідає на питання «чи вистачило сьогодні». Але список компаній
    // мусить рости КОЖЕН день, а не лише в бідні: інакше щойно R1 стає багатим,
    // R4 більше ніколи не запускається і система застигає. Тому обмежений
    // пошук нових компаній робиться завжди, після драбини.
    let grown = 0;
    if (!process.env.SKIP_GROWTH) {
      try {
        // Сіємо з агрегаторів, а не з R1: у R1 усі компанії вже наші.
        if (r2Jobs.length === 0) r2Jobs = (await runR2(skip)).jobs;
        const seedPool = r2Jobs;
        const known = await repo.knownCompanyKeys();
        const growth = await runR4(seedPool, known, {
          addCompany: (c) => repo.upsertCompany({
            slug: c.slug, name: c.name, provider: c.provider,
            atsSlug: c.atsSlug, discoveredVia: c.discoveredVia,
          }),
        }, 40);
        grown = growth.added;
        if (growth.jobs.length) {
          await repo.upsertJobs(prepare(growth.jobs, cfg.freshnessDays, now));
        }
        console.log(`Зростання: перевірено кандидатів, додано ${grown} нових компаній`);
      } catch (e) {
        console.log(`Зростання пропущено: ${e instanceof Error ? e.message : e}`);
      }
    }

    const { deprecated } = await applySourceOutcomes([...outcome.results, ...boardResults], repo, prior);
    if (deprecated.length) console.log(`Позначено мертвими: ${deprecated.join(", ")}`);

    const status = outcome.distinctCompanies >= cfg.distinctCompanyTarget ? "ok" : "short";
    await repo.finishRun(runId, {
      distinctCompanies: outcome.distinctCompanies,
      jobsFound: outcome.jobs.length,
      ladderReached: outcome.reached,
      status,
      notes: outcome.proofOfWork,
    });

    const total = await repo.countJobs();
    console.log(
      `\nПрогін ${runId.slice(0, 8)}: збережено ${outcome.jobs.length} вакансій, ` +
      `${outcome.distinctCompanies} різних компаній, драбина до ${outcome.reached}, статус ${status}.\n` +
      `У кеші всього: ${total} вакансій.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await repo.finishRun(runId, {
      distinctCompanies: 0, jobsFound: 0, ladderReached: "none", status: "failed", notes: msg });
    console.error(`Прогін ${runId.slice(0, 8)} впав: ${msg}`);
    process.exitCode = 1;
  }
}

await main();
