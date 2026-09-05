/**
 * Розвідка по мережі талантів a16z speedrun: вісімсот роботодавців за раз.
 *
 *   node dist/discover-speedrun.js [скільки компаній перевіряти]
 *
 * Навіщо це окремо від скану. У щоденному прогоні `aggregator:speedrun` бере
 * лише свіжі ролі — це передрук, оригінал якого лежить на Greenhouse чи Ashby
 * самої компанії. Справжній виграш в іншому: за кожним «Apply» на тому борді
 * стоїть адреса того самого Greenhouse, і з неї виходить ПОСТІЙНЕ джерело.
 * Компанія, знайдена тут один раз, далі опитується прямо, без посередника, і
 * віддає всі свої вакансії, а не лише ті, що потрапили в чужу добірку.
 *
 * Чим це краще за R4. R4 вгадує слаг із назви компанії й влучає в 45 випадках
 * зі ста. Тут адресу написав сам роботодавець, тож промахів немає взагалі —
 * ціна лише в двох запитах на компанію: список її ролей і деталь однієї ролі.
 *
 * Роботу зроблено щотижневою навмисно: список компаній росте повільно, а два
 * запити на кожну з восьмисот — не те, що варто робити щодня.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { Repo } from "./repo.js";
import { mapLimit } from "./http.js";
import { extractAts } from "./sources/getro.js";
import { isAggregatorBrand } from "./rungs.js";
import {
  collectionTag, fetchApplyUrl, fetchSpeedrunCollectionMembers, fetchSpeedrunCompanies,
  firstJobId, SPEEDRUN_TAG_COLLECTIONS, type SpeedrunCompany,
} from "./sources/speedrun.js";
import type { AtsProvider } from "./types.js";

/** Скільки невідомих компаній перевіряти за прогін, якщо не сказано інакше. */
const DEFAULT_BUDGET = 300;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const budget = Number.parseInt(process.argv[2] ?? String(DEFAULT_BUDGET), 10);

  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  const repo = new Repo(d1);

  const companies = await fetchSpeedrunCompanies();
  console.log(`Роботодавців у мережі speedrun: ${companies.length}`);

  // Ніша з колекцій — поверх ніші з міток галузей. Мітки не знають слова
  // «оборона» ніде, крім однієї компанії, а колекція `defense` знає десять.
  const byCollection = new Map<string, Set<string>>();
  await mapLimit(SPEEDRUN_TAG_COLLECTIONS, 4, async (slug) => {
    const tag = collectionTag(slug);
    if (!tag) return;
    try {
      const members = await fetchSpeedrunCollectionMembers(slug);
      for (const m of members) {
        const set = byCollection.get(m) ?? new Set<string>();
        set.add(tag);
        byCollection.set(m, set);
      }
      console.log(`  колекція ${slug} → ${tag}: ${members.length} компаній`);
    } catch (e) {
      console.log(`  колекція ${slug}: помилка — ${e instanceof Error ? e.message : e}`);
    }
  });

  const tagsOf = (c: SpeedrunCompany): string[] =>
    [...new Set([...c.tags, ...(byCollection.get(c.slug) ?? [])])];

  const known = await repo.knownCompanyKeys();

  /**
   * Порядок перевірки виміряно, а не вгаданий — на трьох вибірках по сорок
   * компаній кожного рівня (05.09):
   *
   *   a16z     (281 компанія) — 40 із 40 віддали справжній ATS: ashby 23,
   *                             greenhouse 14, lever 3. Жодного промаху.
   *   market   (480)          — 19 із 40. Двадцять промахів це Workday:
   *                             Walmart, CVS, P&G. `extractAts` його не знає.
   *   speedrun (39)           — нуль, і це не поразка: подача в них іде на
   *                             самому борді. Для цих тридцяти дев'яти
   *                             мережа speedrun не передрук, а ОРИГІНАЛ,
   *                             як DOU для України. Їхні ролі ми беремо
   *                             щодня через `aggregator:speedrun`, а ATS
   *                             шукати нема де.
   *
   * Тому бюджет іде спершу туди, де влучає кожен запит.
   */
  const TIER_ORDER: Record<string, number> = { a16z: 0, market: 1, speedrun: 2 };
  const unknown = companies
    .filter((c) => !known.has(c.slug) && !known.has(c.name.toLowerCase()))
    .filter((c) => !isAggregatorBrand(c.name))
    .sort((a, b) =>
      (TIER_ORDER[a.tier ?? ""] ?? 9) - (TIER_ORDER[b.tier ?? ""] ?? 9) ||
      b.openRoles - a.openRoles);
  const candidates = unknown.slice(0, Math.max(0, budget));

  console.log(`Невідомих нам: ${unknown.length}; бюджет ${budget}; перевіряю ${candidates.length}`);

  let added = 0;
  let noAts = 0;
  const byProvider = new Map<string, number>();

  await mapLimit(candidates, 4, async (c) => {
    try {
      const jobId = await firstJobId(c.slug, { retries: 1 });
      if (!jobId) { noAts++; return; }
      const applyUrl = await fetchApplyUrl(jobId, { retries: 1 });
      if (!applyUrl) { noAts++; return; }
      const hit = extractAts(applyUrl);
      // Роботодавець на власному домені або на ATS, якого ми ще не вміємо, —
      // це не помилка й не привід щось вигадувати. Пропускаємо мовчки.
      if (!hit) { noAts++; return; }
      if (isAggregatorBrand(hit.slug)) { noAts++; return; }

      await repo.upsertCompany({
        slug: hit.slug, name: c.name, provider: hit.provider as AtsProvider,
        atsSlug: hit.slug, tags: tagsOf(c), discoveredVia: "speedrun",
      });
      added++;
      byProvider.set(hit.provider, (byProvider.get(hit.provider) ?? 0) + 1);
      const tags = tagsOf(c);
      console.log(`  + ${c.name} → ${hit.provider}:${hit.slug} · ${c.openRoles} ролей` +
                  (tags.length ? ` · ${tags.join(", ")}` : ""));
    } catch (e) {
      console.log(`  ${c.name}: помилка — ${e instanceof Error ? e.message : e}`);
    }
  });

  const all = await repo.listCompanies();
  const providers = [...byProvider.entries()].sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}`).join(", ");
  console.log(`\nДодано компаній: ${added}. Без упізнаного ATS: ${noAts}. ` +
              (providers ? `За провайдерами: ${providers}. ` : "") +
              `Усього компаній у списку: ${all.length}.`);
}

await main();
