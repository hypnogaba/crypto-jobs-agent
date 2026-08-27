export interface Config {
  cfAccountId: string;
  cfDatabaseId: string;
  cfApiToken: string;
  anthropicApiKey: string | null;
  freshnessDays: number;
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

export function loadConfig(): Config {
  return {
    cfAccountId: required("CF_ACCOUNT_ID"),
    cfDatabaseId: required("CF_D1_DATABASE_ID"),
    cfApiToken: required("CF_API_TOKEN"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    freshnessDays: num("FRESHNESS_DAYS", 14),
    distinctCompanyTarget: num("DISTINCT_COMPANY_TARGET", 7),
    watchdogFloor: num("WATCHDOG_FLOOR", 5),
  };
}
