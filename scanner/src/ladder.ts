import { prepare } from "./normalize.js";
import type { NormalizedJob, RawJob, Rung, SourceResult } from "./types.js";

export interface RungOutput { jobs: RawJob[]; results: SourceResult[] }

export interface LadderRungs {
  R1: () => Promise<RungOutput>;
  R2: () => Promise<RungOutput>;
  R3: () => Promise<RungOutput>;
  R4: (poolSoFar: RawJob[]) => Promise<RungOutput>;
  R5: () => Promise<RungOutput>;
}

export interface LadderOptions {
  distinctCompanyTarget: number;
  freshnessDays: number;
  now?: Date;
  onRung?: (line: string) => void;
}

export interface LadderOutcome {
  jobs: NormalizedJob[];
  distinctCompanies: number;
  reached: Rung;
  results: SourceResult[];
  /** Доказ роботи: що саме пройдено. Порожній день без цього неприпустимий. */
  proofOfWork: string;
}

const ORDER: Rung[] = ["R1", "R2", "R3", "R4", "R5"];

/**
 * Лізе R1 → R5 і зупиняється, щойно день дав достатньо РІЗНИХ компаній.
 * Порожній рівень ніколи не є підставою зупинитись — у цьому весь сенс драбини.
 */
export async function climbLadder(rungs: LadderRungs, o: LadderOptions): Promise<LadderOutcome> {
  const now = o.now ?? new Date();
  const pool: RawJob[] = [];
  const results: SourceResult[] = [];
  const trace: string[] = [];

  let prepared: NormalizedJob[] = [];
  let distinct = 0;
  let reached: Rung = "R1";

  for (const rung of ORDER) {
    reached = rung;
    const run = rung === "R4" ? await rungs.R4(pool) : await rungs[rung]();

    pool.push(...run.jobs);
    results.push(...run.results);

    prepared = prepare(pool, o.freshnessDays, now);
    distinct = new Set(prepared.map((j) => j.companyKey)).size;

    const broken = run.results.filter((r) => !r.ok).map((r) => r.source);
    const line =
      `${rung}: +${run.jobs.length} сирих, ${prepared.length} після фільтрів, ` +
      `${distinct} різних компаній` +
      (broken.length ? `, недоступні: ${broken.slice(0, 6).join(", ")}${broken.length > 6 ? ` та ще ${broken.length - 6}` : ""}` : "");
    trace.push(line);
    o.onRung?.(line);

    if (distinct >= o.distinctCompanyTarget) break;
  }

  return { jobs: prepared, distinctCompanies: distinct, reached, results, proofOfWork: trace.join("\n") };
}
