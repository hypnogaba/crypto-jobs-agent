import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { spawnSync } from "node:child_process";
import { notifyOwner } from "./notify.js";

export interface RunSummary { id: string; distinctCompanies: number; status: string }
export interface Verdict { rerun: boolean; reason: string }

/**
 * Судить день за РЕЗУЛЬТАТОМ, а не за фактом запуску. Прогін, який завершився
 * успішно й дав чотири компанії, — це провал, і саме це тут ловиться.
 * Живий підрахунок із кеша важливіший за те, що записав сам прогін.
 */
export function judgeDay(run: RunSummary | null, liveDistinct: number, floor: number): Verdict {
  if (!run) return { rerun: true, reason: "сьогодні скан не запускався" };
  if (run.status === "failed") return { rerun: true, reason: `прогін ${run.id.slice(0, 8)} впав` };
  if (liveDistinct < floor) {
    return { rerun: true, reason: `у сьогоднішньому кеші лише ${liveDistinct} різних компаній, поріг ${floor}` };
  }
  return { rerun: false, reason: `${liveDistinct} різних компаній, це не нижче порога ${floor}` };
}

const startOfTodayIso = (now: Date): string => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

async function main(): Promise<void> {
  const cfg = loadConfig();
  const since = startOfTodayIso(new Date());
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  const repo = new Repo(d1);

  const run = await repo.lastRunSince(since);
  const live = await repo.countDistinctCompaniesSince(since);
  const verdict = judgeDay(run, live, cfg.watchdogFloor);

  console.log(`Вердикт watchdog: ${verdict.reason}`);
  if (!verdict.rerun) return;

  console.log("Watchdog форсує глибший повторний скан.");
  const rerun = spawnSync(process.execPath, ["dist/scan.js"], { stdio: "inherit", env: process.env });
  if (rerun.status !== 0) {
    console.error(`Повторний скан завершився зі статусом ${rerun.status}`);
    // Тут кінець лінії: watchdog — остання перевірка дня, і якщо навіть його
    // повторний скан не вдався, більше нічого не спрацює саме собою.
    await notifyOwner(
      `NextRole: день без вакансій.\n\n${verdict.reason}.\nПовторний скан теж упав (код ${rerun.status}).\n\n`
      + `Добірки сьогодні або не підуть, або підуть зі старого кеша.`);
    process.exitCode = 1;
    return;
  }
  await notifyOwner(`NextRole: watchdog рятував день.\n\n${verdict.reason}.\nПовторний скан пройшов, кеш поповнено.`);
}

if (process.argv[1]?.endsWith("watchdog.js")) await main();
