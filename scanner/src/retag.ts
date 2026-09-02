/**
 * Перетегувати кеш, не чекаючи скану.
 *
 *   node dist/retag.js [--dry] [--days N]
 *
 * Навіщо це є. Теги переписуються рівно там, де вакансію записують, — у
 * `upsertJobs`. Тому нове правило в `tags.ts` доходить до бази лише тоді, коли
 * скан ЗНОВУ побачить ту саму вакансію. Скан ходить Пн–Пт, тож правка,
 * викочена в п'ятницю по обіді, не діє до понеділка.
 *
 * Так уже сталося двічі поспіль. Сферу «дизайн» додано 29.08 о 13:25 —
 * останній скан був о 13:02, за двадцять три хвилини до того, і жоден
 * дизайнер її не бачив. Правку тегу рівня («VP, Growth Marketing» лишався
 * без рівня й ішов junior-ам) викочено наступного дня — і вона так само
 * пролежала мертвою, доки скан не запустили руками.
 *
 * ДОДАЄМО, НЕ ЗАМІНЮЄМО. Новий тег з'являється, жоден наявний не зникає.
 * Прибирання зайвого — справа наступного справжнього скану, який перезаписує
 * теги цілком. Ці двоє не конфліктують: скан завжди правіший.
 *
 * Ніша ДЖЕРЕЛА відновлюється, і це друга половина роботи. Ніша дошки й
 * колекції прив'язана до `source`, а `source` у рядку кеша є. Тому перед
 * перетегуванням ми питаємо базу, які джерела нішеві, і передаємо це як
 * inheritedTags.
 *
 * Ніша КОМПАНІЇ відновлюється так само, і колись тут стояло, що це
 * неможливо. У рядку кеша лежить `company_key`, а в каталозі компаній —
 * тег ніші, тож зв'язок є. Це важливо саме для тих джерел, які про нішу
 * мовчать: вакансія Binance приїжджає і через `lever:binance` з тегом, і
 * через колекцію Getro без тега, і другий запис стирав перший.
 *
 * Без цього перетегування крипто-дошок не дало б нічого: правило дивиться в
 * назву вакансії, а «Senior Backend Engineer» у крипто-компанії слова
 * «crypto» в назві не має. Саме через це 2113 крипто-вакансій лежали в кеші
 * без тега `web3`.
 */
import { loadConfig } from "./config.js";
import { wranglerFetch } from "./wrangler-fetch.js";
import { D1Client } from "./d1.js";
import { deriveTags, withCompanyTags } from "./tags.js";

interface Row {
  id: string; title: string; company: string; company_key: string;
  source: string; remote: number; tags: string;
}

const parse = (raw: string): string[] => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v as string[] : []; }
  catch { return []; }
};

export interface RetagChange { id: string; added: string[]; tags: string[] }

/**
 * Що змінилося б. Чиста функція — саме вона й перевіряється тестом, бо решта
 * файлу це два запити до D1.
 */
export function planRetag(
  rows: Row[],
  nicheBySource: Map<string, string[]> = new Map(),
  nicheByCompany: Map<string, string[]> = new Map(),
): RetagChange[] {
  const out: RetagChange[] = [];
  for (const r of rows) {
    const old = parse(r.tags);
    const derived = withCompanyTags(deriveTags({
      url: "", company: r.company, title: r.title, location: null,
      remote: r.remote === 1, postedAt: null, source: r.source,
      inheritedTags: nicheBySource.get(r.source),
    }), nicheByCompany.get(r.company_key) ?? []);
    const added = derived.filter((t) => !old.includes(t));
    // «other» ставиться лише тоді, коли не знайшлось нічого іншого. Тут воно
    // означало б, що правила мовчать про рядок, у якого теги вже є, — і
    // додати його було б відвертою неправдою.
    const real = added.filter((t) => t !== "other" || old.length === 0);
    if (real.length === 0) continue;
    out.push({ id: r.id, added: real, tags: [...old, ...real] });
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const i = argv.indexOf("--days");
  const days = i === -1 ? 3 : Number.parseInt(argv[i + 1] ?? "3", 10);
  if (!Number.isFinite(days) || days <= 0) {
    console.log("--days має бути додатним числом");
    process.exitCode = 1;
    return;
  }

  const cfg = process.env.VIA_WRANGLER
    ? { cfAccountId: "x", cfDatabaseId: "x", cfApiToken: "x" }
    : loadConfig();
  const d1 = new D1Client(
    { accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken },
    process.env.VIA_WRANGLER ? { fetchImpl: wranglerFetch, attempts: 1, timeoutMs: 600_000 } : {});

  const rows = await d1.query<Row>(
    `SELECT id,title,company,company_key,source,remote,tags FROM jobs_cache
      WHERE fetched_at >= datetime('now', ?)`, [`-${days} day`]);
  console.log(`У вікні ${days} дн.: ${rows.length} вакансій.`);

  // Нішеві джерела: дошки й колекції Getro, які оголосили свій тег. Два
  // маленькі запити замість здогадів по назві вакансії.
  const niche = new Map<string, string[]>();
  for (const b of await d1.query<{ name: string; tags: string }>(
    "SELECT name, tags FROM country_boards WHERE tags IS NOT NULL AND tags <> '[]'")) {
    niche.set(b.name, parse(b.tags));
  }
  for (const c of await d1.query<{ collection_id: string; tags: string }>(
    "SELECT collection_id, tags FROM getro_collections WHERE tags IS NOT NULL AND tags <> '[]'")) {
    niche.set(`getro:${c.collection_id}`, parse(c.tags));
  }
  console.log(`Нішевих джерел: ${niche.size}.`);

  // Ніша компанії. Джерело каже про нішу не завжди — вакансія Binance
  // приїжджає і через `lever:binance`, і через колекцію Getro без тегів, —
  // а каталог компаній знає її незалежно від того, хто приніс рядок.
  const byCompany = new Map<string, string[]>();
  for (const c of await d1.query<{ slug: string; tags: string }>(
    "SELECT slug, tags FROM companies WHERE tags IS NOT NULL AND tags <> '[]'")) {
    byCompany.set(c.slug, parse(c.tags));
  }
  console.log(`Компаній з нішею: ${byCompany.size}.`);

  const plan = planRetag(rows, niche, byCompany);
  if (plan.length === 0) { console.log("Теги вже відповідають правилам — міняти нема чого."); return; }

  const gained = new Map<string, number>();
  for (const c of plan) for (const t of c.added) gained.set(t, (gained.get(t) ?? 0) + 1);
  const summary = [...gained.entries()].sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} +${n}`).join(", ");
  console.log(`Змінилось би рядків: ${plan.length}. Здобули б: ${summary}`);

  if (dry) { console.log("--dry: нічого не записано."); return; }

  await d1.batch(plan.map((c) => ({
    sql: "UPDATE jobs_cache SET tags=? WHERE id=?",
    params: [JSON.stringify(c.tags), c.id],
  })));
  console.log(`Записано: ${plan.length} рядків.`);
}

if (process.argv[1]?.endsWith("retag.js")) await main();
