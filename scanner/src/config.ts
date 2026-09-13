export interface Config {
  cfAccountId: string;
  cfDatabaseId: string;
  cfApiToken: string;
  anthropicApiKey: string | null;
  freshnessDays: number;
  /**
   * Вікно свіжості для крипто-вакансій (тег `web3`), днів.
   *
   * Крипто-вакансії стоять відкритими місяцями: на 23 публічних крипто-дошках
   * 13.09 з 1 572 відкритих позицій 14 днів і новіші мали 14%, 30 днів і
   * новіші 27%. Решта кешу лишається на `freshnessDays`. Щоб повернути старе
   * правило, досить поставити тут те саме число, що й у FRESHNESS_DAYS.
   */
  cryptoFreshnessDays: number;
  /**
   * Як читати колекції Getro. `discover` (типово): щоденний скан їх не
   * читає, щотижнева розвідка забирає з них лише посилання на ATS
   * роботодавців, а вакансії приходять з публічного API самого ATS.
   * `hybrid`: щодня, але в кеш лише ті вакансії, у яких немає такого ATS.
   * `jobs`: як до 13.09, усі вакансії з Getro щодня.
   */
  getroMode: GetroMode;
  distinctCompanyTarget: number;
  watchdogFloor: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана змінна оточення: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${name} має бути числом, отримано: ${raw}`);
  return n;
}

export type GetroMode = "discover" | "hybrid" | "jobs";

export function getroMode(): GetroMode {
  const v = (process.env.GETRO_MODE ?? "discover").trim().toLowerCase();
  if (v === "discover" || v === "hybrid" || v === "jobs") return v;
  throw new Error(`GETRO_MODE має бути discover, hybrid або jobs, отримано: ${v}`);
}

/** Крипто-вікно ніколи не вужче за загальне: інакше ми б різали крипту сильніше за решту. */
export function cryptoFreshnessDays(): number {
  return Math.max(num("CRYPTO_FRESHNESS_DAYS", 30), num("FRESHNESS_DAYS", 14));
}

export function loadConfig(): Config {
  return {
    cfAccountId: required("CF_ACCOUNT_ID"),
    cfDatabaseId: required("CF_D1_DATABASE_ID"),
    cfApiToken: required("CF_API_TOKEN"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    freshnessDays: num("FRESHNESS_DAYS", 14),
    cryptoFreshnessDays: cryptoFreshnessDays(),
    getroMode: getroMode(),
    distinctCompanyTarget: num("DISTINCT_COMPANY_TARGET", 7),
    watchdogFloor: num("WATCHDOG_FLOOR", 5),
  };
}
