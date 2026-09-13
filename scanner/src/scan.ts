/**
 * Щоденний скан: `node dist/scan.js`. Сам прогін живе в scan-core.ts, тут
 * лише справжнє сховище (D1), числа для сайту й лист власнику.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { runScan } from "./scan-core.js";
import { notifyOwner } from "./notify.js";
import { refreshSiteStats } from "./site-stats.js";

const cfg = loadConfig();
const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

await runScan({
  cfg,
  repo: new Repo(d1),
  afterRun: () => refreshSiteStats(d1),
  notify: notifyOwner,
});
