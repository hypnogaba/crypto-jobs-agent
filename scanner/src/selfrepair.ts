import type { SourceResult, SourceStatus } from "./types.js";

export interface SourceSnapshot {
  source: string; status: SourceStatus; consecutiveFailDays: number;
  /** Чи дало це джерело бодай одну вакансію за весь час. */
  everOk?: boolean;
}

export interface SelfRepairRepo {
  recordSourceOutcome: (source: string, ok: boolean, jobs: number, error?: string) => Promise<void>;
  deprecateSource: (source: string) => Promise<void>;
}

/** Два дні поспіль — межа між «збоїть» і «померло». */
const DEPRECATE_AFTER_DAYS = 2;

/**
 * Джерело, яке не дало жодної вакансії за весь час, помирає з першої невдачі.
 *
 * Такі беруться зі збору ATS-лінків у даних Getro: посилання в записі є, а дошка
 * вже 404. Одного разу їх набралось 143 — 7% списку, і кожне три доби марно
 * опитувалось. Запас у три дні заслуговує те, що колись працювало.
 */
const NEVER_WORKED_GRACE = 0;

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
    const prior = byName.get(r.source);
    const days = (prior?.consecutiveFailDays ?? 0) + 1;
    // everOk невідоме (undefined) для нового джерела — тоді поводимось як раніше
    const grace = prior?.everOk === false ? NEVER_WORKED_GRACE : DEPRECATE_AFTER_DAYS;
    if (days > grace) {
      await repo.deprecateSource(r.source);
      deprecated.push(r.source);
    }
  }
  return { deprecated };
}

/** Мертві пропускаємо; ті, що просто збоять, отримують ще шанс. */
export const skipSet = (states: SourceSnapshot[]): Set<string> =>
  new Set(states.filter((s) => s.status === "deprecated").map((s) => s.source));
