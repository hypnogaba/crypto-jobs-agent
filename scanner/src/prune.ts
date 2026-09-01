/**
 * Прибирання кеша вакансій.
 *
 *   node dist/prune.js [--dry] [--days N]
 *
 * Навіщо це є. `jobs_cache` не чистився ніколи: 29 тисяч рядків і жодного
 * DELETE у коді. Місця це поки не коштує, а от читань D1 — коштує, і саме
 * читання є нашим вузьким місцем.
 *
 * ЧОМУ ЦЕ НЕ МОЖНА РОБИТИ НАЇВНО. У схемі стоїть
 *
 *     sent.job_id REFERENCES jobs_cache(id) ON DELETE CASCADE
 *
 * тобто `DELETE FROM jobs_cache` тягне за собою рядки `sent` — а вони тримають
 * дві речі, які не відновлюються:
 *
 *   1. Захист від повтору. Розсилка виключає те, що вже в `sent`. Ідентифікатор
 *      вакансії виводиться з її адреси, тож видалена сьогодні вакансія, яку
 *      завтра скан побачить знову, отримає ТОЙ САМИЙ id — і піде людині вдруге.
 *      Вона вже її бачила, можливо вже подалась.
 *   2. Історію: кабінет, «Історія зводок» у панелі, і сенс кожного рядка
 *      `feedback`, який посилається на добірку.
 *
 * Тому правило одне й просте: **вакансію, яку комусь надсилали, не видаляємо
 * ніколи.** Таких мало — на сьогодні 155 рядків проти 29 тисяч, — тож кеш усе
 * одно лишається обмеженим, а історія цілою.
 *
 * `job_i18n` зовнішнього ключа НЕ має (див. 0013), тож переклади осиротіли б
 * мовчки. Прибираємо їх окремо, після вакансій.
 *
 * Вікно. Кандидати в розсилку беруться за останні 3 дні, свіжість важить до
 * 14. Рядок, якого скан не бачив 30 днів, — це вакансія, яку джерело вже не
 * віддає. Тридцять, а не чотирнадцять: різниця в кілька тисяч рядків нічого
 * не коштує, а зайвий запас захищає від джерела, що мовчало тиждень.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";

/** Скільки рядків видаляємо за один запит. D1 не любить довгих транзакцій. */
const BATCH = 500;

export interface PruneCounts { stale: number; kept: number; orphanI18n: number }

/**
 * Що саме видалити. Чиста функція — саме її й перевіряє тест.
 *
 * `sentIds` — ідентифікатори вакансій, які комусь надсилали. Вони не
 * видаляються, скільки б їм не було років.
 */
export function planPrune(stale: string[], sentIds: Set<string>): { drop: string[]; kept: number } {
  const drop = stale.filter((id) => !sentIds.has(id));
  return { drop, kept: stale.length - drop.length };
}

/** Розбити на пакети: один DELETE з тисячами параметрів D1 не приймає. */
export function chunk<T>(xs: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const i = argv.indexOf("--days");
  const days = i === -1 ? 30 : Number.parseInt(argv[i + 1] ?? "30", 10);
  if (!Number.isFinite(days) || days <= 0) {
    console.log("--days має бути додатним числом");
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig();
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  const before = (await d1.query<{ n: number }>("SELECT COUNT(*) n FROM jobs_cache"))[0]?.n ?? 0;

  // Старі рядки і надіслані читаємо окремо: з'єднання по 29 тисячах рядків
  // D1 виконує довго, а два простих запити — миттєво.
  const stale = (await d1.query<{ id: string }>(
    "SELECT id FROM jobs_cache WHERE fetched_at < datetime('now', ?)", [`-${days} day`])).map((r) => r.id);
  const sentIds = new Set((await d1.query<{ job_id: string }>(
    "SELECT DISTINCT job_id FROM sent")).map((r) => r.job_id));

  const { drop, kept } = planPrune(stale, sentIds);
  console.log(`У кеші ${before}. Старших за ${days} дн.: ${stale.length}.`);
  console.log(`Видалити: ${drop.length}. Лишити попри вік (їх надсилали людям): ${kept}.`);

  if (drop.length === 0) { console.log("Прибирати нема чого."); return; }
  if (dry) { console.log("--dry: нічого не видалено."); return; }

  for (const part of chunk(drop)) {
    const marks = part.map(() => "?").join(",");
    await d1.query(`DELETE FROM jobs_cache WHERE id IN (${marks})`, part);
  }

  // Переклади без вакансії. Окремим кроком, бо зовнішнього ключа тут немає
  // і каскад їх не забирає.
  const orphans = (await d1.query<{ job_id: string }>(
    `SELECT i.job_id FROM job_i18n i
      LEFT JOIN jobs_cache j ON j.id = i.job_id
      WHERE j.id IS NULL`)).map((r) => r.job_id);
  for (const part of chunk(orphans)) {
    const marks = part.map(() => "?").join(",");
    await d1.query(`DELETE FROM job_i18n WHERE job_id IN (${marks})`, part);
  }

  const after = (await d1.query<{ n: number }>("SELECT COUNT(*) n FROM jobs_cache"))[0]?.n ?? 0;
  console.log(`Готово. Кеш: ${before} → ${after}. Перекладів прибрано: ${orphans.length}.`);
}

if (process.argv[1]?.endsWith("prune.js")) await main();
