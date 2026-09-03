import { all } from "./db";

/**
 * Три справжні вакансії за словами людини — для підтвердження в анкеті.
 *
 * Скарга, з якої це виросло: у боті не зрозуміло, ЯКА ПОСАДА може бути за
 * питанням. Число вакансій на це не відповідає, а назви відповідають прямо.
 */

export interface JobSample { title: string; company: string }

/**
 * Слова назви посади, за якими варто шукати.
 *
 * «manager», «senior», «lead» стоять майже в кожній другій назві: приклад за
 * ними був би правдивий і безглуздий, бо показав би випадкову вакансію.
 *
 * Список навмисно короткий і живе ТУТ, а не в сканері. Точну логіку збігу за
 * роллю (синоніми, межі слів) має `match.ts`, і копіювати її сюди означало б
 * завести друге джерело правди для найтоншої частини продукту. Тому ми
 * показуємо приклади, а не число: приклад нічого не обіцяє про обсяг, тож
 * розбіжність із пізнішою добіркою нікого не обманює.
 */
const GENERIC = new Set([
  "senior", "junior", "lead", "head", "chief", "principal", "staff", "middle",
  "manager", "specialist", "director", "officer", "intern", "associate",
  "менеджер", "керівник", "старший", "молодший", "спеціаліст",
  "of", "and", "the", "for", "with",
]);

export function meaningfulWords(role: string | null | undefined): string[] {
  if (!role) return [];
  return role.toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((w) => w.length > 2 && !GENERIC.has(w));
}

/**
 * Слово має ПОЧИНАТИ слово в назві, а не ховатись усередині нього.
 *
 * Знайдено прогоном на живих ролях: «direct» збігалося з «Analyst I,
 * Directed Content». Та сама пастка, яку вже ловив сканер, де
 * «communication» жило всередині «Telecommunications». SQL цього не вміє
 * (`LIKE` меж слова не знає), тому LIKE лише звужує вибірку, а межу
 * перевіряємо тут.
 *
 * Межа — усе, що не літера й не цифра: дефіс у «Full-Stack» і дужка в
 * «(Python)» починають слово так само, як пробіл.
 */
export function startsWord(title: string, word: string): boolean {
  const t = title.toLowerCase();
  const w = word.toLowerCase();
  let i = t.indexOf(w);
  while (i !== -1) {
    const before = i === 0 ? "" : t[i - 1]!;
    if (!/[\p{L}\p{N}]/u.test(before)) return true;
    i = t.indexOf(w, i + 1);
  }
  return false;
}

/**
 * Потрібні ВСІ слова ролі, а не будь-яке.
 *
 * Найгірша хиба, яку знайшов прогін: слова з'єднувались через АБО, і «solana
 * auditor» діставав «Night Auditor (H/F) — Hôtel les Barmes de l'Ours», а
 * «solana developer» — «Senior Mobile APP (IOS/AOS) Developer». Приклад без
 * стосунку до людини гірший за відсутність прикладів: він каже їй, що ми не
 * зрозуміли жодного слова.
 */
export const matchesAll = (title: string, words: string[]): boolean =>
  words.every((w) => startsWord(title, w));

/**
 * Назви в кеші зберігають HTML-сутності: «Python &amp;amp; JS».
 *
 * У добірку вони йдуть через власне екранування, а тут текст показується
 * людині напряму, тож розкодовуємо. Список короткий навмисно: це прибирання
 * відомого сміття, а не розбір HTML.
 */
export const unescapeTitle = (title: string): string =>
  title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");

/**
 * Одна вакансія на компанію.
 *
 * Без цього великий роботодавець забирає всі три рядки, і людина бачить не
 * «які бувають посади», а «які посади є в Polygon». Це та сама пастка, що
 * вже ловила вікно кандидатів у сканері, лише в меншому масштабі.
 */
/**
 * Найдовша назва, яку ще можна показати.
 *
 * У кеші є рядки, де в `title` лежить цілий абзац опису компанії (живий
 * приклад: Norm Ai, понад 700 символів). Обрізати такий рядок нема сенсу —
 * вийде беззмістовний уривок, — тож він просто не годиться в приклад. Це
 * захист показу, а не спроба полагодити кеш: у добірку такі рядки й далі
 * потрапляють, і це окреме питання.
 */
const TITLE_MAX = 90;

export function pickSamples(rows: JobSample[], limit: number): JobSample[] {
  const seen = new Set<string>();
  const out: JobSample[] = [];
  for (const r of rows) {
    if (r.title.length > TITLE_MAX) continue;
    const key = r.company.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Правило навмисно простіше за підбір: свіжий рядок, значуще слово в назві.
 *
 * **Роль сюди треба давати англійською.** Назви вакансій у кеші англійські, тож
 * «комуніті менеджер» не збігся б із жодною, і людина, що пише кирилицею, не
 * побачила б прикладів ніколи. Переклад робить `normalizeFreeText` — той самий,
 * що наповнює `custom_role_en`, — і викликає його той, хто будує підтвердження.
 * Те саме правило, що `roleText` у сканері: англійська, якщо є, інакше як є.
 *
 * Ціна: `idx_jobs_fetched` покриває діапазон дат, далі йде фільтр по назві.
 * Найгірший випадок — рідке слово й повний прохід свіжого зрізу, близько
 * тридцяти тисяч рядків, один раз на людину за всю анкету. Якщо реєстрації
 * доростуть до сотень на добу, приклади треба буде брати з підготовленої
 * таблиці, як `source_stats`.
 */
export async function sampleJobs(role: string | null | undefined, limit = 3): Promise<JobSample[]> {
  const words = meaningfulWords(role).slice(0, 2);
  if (words.length === 0) return [];

  const fetch = async (need: string[]): Promise<JobSample[]> => {
    const where = need.map(() => "LOWER(title) LIKE ?").join(" AND ");
    const rows = await all<JobSample>(
      `SELECT title, company FROM jobs_cache
        WHERE fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
          AND (${where})
        ORDER BY posted_at DESC
        LIMIT ?`,
      ...need.map((w) => `%${w}%`), limit * 20);
    // LIKE звузив, межу слова перевіряємо тут: SQL її не вміє.
    return rows.filter((r) => matchesAll(r.title, need))
      .map((r) => ({ title: unescapeTitle(r.title), company: r.company }));
  };

  try {
    let rows = await fetch(words);
    /**
     * Запасний захід — ПЕРШЕ слово, а не будь-яке.
     *
     * Перше слово ролі майже завжди те, що її вирізняє: «solana», «web3»,
     * «community», «regulatory». Друге частіше загальне («developer»,
     * «auditor»), і саме воно давало готельного нічного аудитора людині, що
     * шукала аудит смартконтрактів.
     */
    if (rows.length === 0 && words.length > 1) rows = await fetch([words[0]!]);
    return pickSamples(rows, limit);
  } catch {
    // Приклади — прикраса підтвердження, а не його зміст. Збій бази тут не
    // має права зупинити анкету.
    return [];
  }
}
