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
 * Одна вакансія на компанію.
 *
 * Без цього великий роботодавець забирає всі три рядки, і людина бачить не
 * «які бувають посади», а «які посади є в Polygon». Це та сама пастка, що
 * вже ловила вікно кандидатів у сканері, лише в меншому масштабі.
 */
export function pickSamples(rows: JobSample[], limit: number): JobSample[] {
  const seen = new Set<string>();
  const out: JobSample[] = [];
  for (const r of rows) {
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
  const where = words.map(() => "LOWER(title) LIKE ?").join(" OR ");
  try {
    const rows = await all<JobSample>(
      `SELECT title, company FROM jobs_cache
        WHERE fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
          AND (${where})
        ORDER BY posted_at DESC
        LIMIT ?`,
      ...words.map((w) => `%${w}%`), limit * 5);
    return pickSamples(rows, limit);
  } catch {
    // Приклади — прикраса підтвердження, а не його зміст. Збій бази тут не
    // має права зупинити анкету.
    return [];
  }
}
