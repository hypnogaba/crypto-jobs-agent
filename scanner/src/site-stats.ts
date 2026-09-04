import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";

/**
 * Числа для публічних сторінок, пораховані один раз на скан.
 *
 * Тут живуть ЄДИНІ копії цих запитів. Сайт їх не повторює й не має
 * запасного шляху: дві копії того самого SQL у двох пакетах розійшлися б
 * першою ж правкою, а мовчазна розбіжність у числах на головній гірша за
 * порожнє місце.
 *
 * Чому взагалі: одне відкриття головної коштувало 236 тисяч прочитаних
 * рядків, і за добу дві третини всіх читань бази припадали на неї. Дані під
 * цими числами змінюються двічі на добу, разом зі сканом.
 */

/** Ключі, які читає сайт. Змінювати їх можна лише разом із читачем. */
export const STAT_KEYS = {
  jobs: "home.jobs",
  companies: "home.companies",
  sources: "home.sources",
  feed: "home.feed",
  tagCounts: "jobs.tagCounts",
} as const;

/** Префікс ключів зі списками вакансій: `jobs.list.<тег>`. */
export const TAG_LIST_PREFIX = "jobs.list.";

/** Скільки вакансій показує сторінка-добірка. Мусить збігатися з PAGE_SIZE на сайті. */
export const TAG_LIST_SIZE = 60;

/**
 * Списки вакансій для сторінок-добірок, пораховані раз на скан.
 *
 * Кожна така сторінка робила `tags LIKE '%"design"%'` по свіжому вікну, і
 * жоден індекс під це не лягає: JSON-масив у стовпці шукається тільки
 * проходом. Виміряно на живій базі: **33 541 прочитаний рядок, щоб показати
 * сорок**. Сторінок двадцять чотири, усі публічні й відкриті пошуковикам.
 *
 * Порахуймо стелю: безкоштовний D1 дає п'ять мільйонів читань на добу, тобто
 * **149 переглядів вичерпують усе** — разом із добірками, ботом і адмінкою.
 * Один краулер, що обходить двадцять чотири сторінки кілька разів на день,
 * кладе продукт. У цьому продукті вже була така аварія на іншому відкритому
 * маршруті, тож це не здогад.
 *
 * Той самий вихід, що й для чисел: рахує скан, сайт лише читає. Один прохід
 * по свіжому вікну на добу замість проходу на кожен перегляд.
 *
 * Записів це додає двадцять чотири на прогін — саме тому список лежить JSON-ом
 * в одному рядку на тег, а не окремою таблицею «вакансія-тег». Та коштувала б
 * близько вісімдесяти тисяч записів на добу при стелі в сто тисяч.
 */
const TAG_LIST_SQL = `
  SELECT tag, id, title, company, location, remote, url, posted_at,
         salary_min, salary_max, salary_currency, source
    FROM (
      SELECT t.value AS tag, j.id, j.title, j.company, j.location, j.remote, j.url,
             j.posted_at, j.salary_min, j.salary_max, j.salary_currency, j.source,
             ROW_NUMBER() OVER (PARTITION BY t.value
                                ORDER BY j.posted_at DESC, j.fetched_at DESC) rn
        FROM jobs_cache j, json_each(j.tags) t
       WHERE j.fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
    )
   WHERE rn <= ${TAG_LIST_SIZE}`;

interface TagListRow {
  tag: string; id: string; title: string; company: string; location: string | null;
  remote: number; url: string; posted_at: string | null;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null;
  source: string;
}

/** Рядки одного запиту -> по списку на тег, у порядку, який дав SQL. */
export function groupByTag(rows: TagListRow[]): Map<string, Array<Omit<TagListRow, "tag">>> {
  const out = new Map<string, Array<Omit<TagListRow, "tag">>>();
  for (const { tag, ...job } of rows) {
    const list = out.get(tag) ?? [];
    list.push(job);
    out.set(tag, list);
  }
  return out;
}

/**
 * Вітрина на головній: десять свіжих вакансій, по дві на компанію, без
 * повторів за змістом і лише зі сфер, які сторінка й обіцяє.
 *
 * Перелік тегів тут не випадковий: без нього поруч із обіцянкою «крипта,
 * web3 і IT» стояв лаборант і фахівець із підготовки зразків.
 */
const FEED_SQL = `
  SELECT company, title, location, remote, url
  FROM (
    SELECT company, title, location, remote, url, posted_at, fetched_at,
           ROW_NUMBER() OVER (PARTITION BY company_key
                              ORDER BY posted_at DESC, fetched_at DESC) per_company
    FROM (
      SELECT company, company_key, title, location, remote, url, posted_at, fetched_at,
             ROW_NUMBER() OVER (PARTITION BY dedupe_key
                                ORDER BY posted_at DESC, fetched_at DESC) dup
      FROM jobs_cache
      WHERE fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
        AND (tags LIKE '%"web3"%' OR tags LIKE '%"engineering"%' OR tags LIKE '%"data-ai"%'
             OR tags LIKE '%"product"%' OR tags LIKE '%"design"%' OR tags LIKE '%"devrel"%'
             OR tags LIKE '%"security"%' OR tags LIKE '%"qa"%' OR tags LIKE '%"ai"%'
             OR tags LIKE '%"fintech"%')
    )
    WHERE dup = 1
  )
  WHERE per_company <= 2
  ORDER BY posted_at DESC, fetched_at DESC
  LIMIT 10`;

export interface FeedRow {
  company: string; title: string; location: string | null; remote: number; url: string;
}

export async function refreshSiteStats(d1: D1Client): Promise<void> {
  const [counts] = await d1.query<{ jobs: number; companies: number; sources: number }>(
    `SELECT (SELECT COUNT(*) FROM jobs_cache) jobs,
            (SELECT COUNT(DISTINCT company_key) FROM jobs_cache) companies,
            -- Лише ті джерела, які справді опитуються: мертві лишаються в
            -- таблиці як історія, але обіцяти їх людині нечесно.
            (SELECT COUNT(*) FROM companies c
               WHERE NOT EXISTS (
                 SELECT 1 FROM sources_state s
                  WHERE s.source_name = c.ats_provider || ':' || c.ats_slug
                    AND s.status = 'deprecated')) sources`);

  const feed = await d1.query<FeedRow>(FEED_SQL);

  // Числа для сторінок-добірок: усі теги одним запитом із GROUP BY. Двадцять
  // два окремі рахунки коштували 1.8 мільйона рядків на одне відкриття.
  const tags = await d1.query<{ tag: string; n: number }>(
    `SELECT t.value AS tag, count(*) AS n
       FROM jobs_cache j, json_each(j.tags) t
      WHERE j.fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
      GROUP BY t.value`);

  const lists = groupByTag(await d1.query<TagListRow>(TAG_LIST_SQL));

  const rows: Array<[string, string]> = [
    ...[...lists].map(([tag, jobs]): [string, string] =>
      [`${TAG_LIST_PREFIX}${tag}`, JSON.stringify(jobs)]),
    [STAT_KEYS.jobs, String(counts?.jobs ?? 0)],
    [STAT_KEYS.companies, String(counts?.companies ?? 0)],
    [STAT_KEYS.sources, String(counts?.sources ?? 0)],
    [STAT_KEYS.feed, JSON.stringify(feed)],
    [STAT_KEYS.tagCounts, JSON.stringify(Object.fromEntries(tags.map((t) => [t.tag, t.n])))],
  ];

  for (const [key, value] of rows) {
    await d1.execute(
      `INSERT INTO site_stats (key,value,updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      [key, value]);
  }
}

/**
 * Запуск руками: `node dist/site-stats.js`.
 *
 * Потрібен рівно двічі в житті: одразу після викочування, щоб сторінки не
 * стояли порожні до першого нічного скану, і коли щось пішло не так і числа
 * треба перерахувати негайно.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  await refreshSiteStats(d1);
  console.log("Числа для сайту оновлено.");
}

if (process.argv[1]?.endsWith("site-stats.js")) await main();
