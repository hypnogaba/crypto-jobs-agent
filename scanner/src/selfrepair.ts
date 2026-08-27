import type { SourceResult, SourceStatus } from "./types.js";

export interface SourceSnapshot { source: string; status: SourceStatus; consecutiveFailDays: number }

export interface SelfRepairRepo {
  recordSourceOutcome: (source: string, ok: boolean, jobs: number, error?: string) => Promise<void>;
  deprecateSource: (source: string) => Promise<void>;
}

/** Два дні поспіль — межа між «збоїть» і «померло». */
const DEPRECATE_AFTER_DAYS = 2;

export async function applySourceOutcomes(
  results: SourceResult[], repo: SelfRepairRepo, prior: SourceSnapshot[]
): Promise<{ deprecated: string[] }> {
  const byName = new Map(prior.map((p) => [p.source, p]));
  const deprecated: string[] = [];

  for (const r of results) {
    // Вгадування, що не влучило, — не джерело; не засмічуємо таблицю здоров'я
    if (r.source.startsWith("guess:") || r.source.startsWith("unknown:")) continue;
    await repo.recordSourceOutcome(r.source, r.ok, r.jobs.length, r.error);
    if (r.ok) continue;
    const days = (byName.get(r.source)?.consecutiveFailDays ?? 0) + 1;
    if (days > DEPRECATE_AFTER_DAYS) {
      await repo.deprecateSource(r.source);
      deprecated.push(r.source);
    }
  }
  return { deprecated };
}

/** Мертві пропускаємо; ті, що просто збоять, отримують ще шанс. */
export const skipSet = (states: SourceSnapshot[]): Set<string> =>
  new Set(states.filter((s) => s.status === "deprecated").map((s) => s.source));
