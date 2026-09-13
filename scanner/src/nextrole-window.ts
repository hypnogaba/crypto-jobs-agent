/**
 * Вікно свіжості NextRole на ЧИТАННІ.
 *
 * До 13.09.2026 сканер сам викидав усе, опубліковане раніше ніж за 14 днів
 * (`FRESHNESS_DAYS`), і NextRole ніде більше дату публікації не перевіряв:
 * добірка брала рядки, побачені за останні три доби, і все.
 *
 * Тепер сканер тримає крипто-вакансії 30 днів (`CRYPTO_FRESHNESS_DAYS`): кеш
 * спільний із NextCryptoJob, а крипто-вакансії стоять відкритими місяцями.
 * Щоб NextRole від цього не змінився, його власне правило переїхало сюди, на
 * читання, і воно ДОСЛІВНО те саме, що було на записі: «опубліковано не
 * раніше ніж за N днів до моменту, коли скан цей рядок побачив».
 *
 * Саме `fetched_at`, а не `now`: скан порівнював дату з власним часом, і
 * рядок, що пройшов тоді, мусить проходити й тепер, навіть якщо добірка
 * читає його через дві доби. Порівняння з `now` робило б NextRole суворішим,
 * ніж він був.
 *
 * Формат `%fZ` дає мілісекунди, тобто рівно те, що пише `toISOString()`, і
 * рядкове порівняння в SQLite не спотикається на межі секунди.
 *
 * Порожня дата проходить, як і раніше: більшість дошок дати не публікують.
 */
export function nextrolePostedDays(): number {
  const n = Number.parseInt(process.env.FRESHNESS_DAYS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/** Умова для WHERE. `alias`: псевдонім `jobs_cache` у запиті, або порожньо. */
export function nextrolePostedSql(alias = "j", days = nextrolePostedDays()): string {
  const d = Math.max(1, Math.floor(days));
  const c = (col: string) => (alias ? `${alias}.${col}` : col);
  return `(${c("posted_at")} IS NULL OR ${c("posted_at")} >= strftime('%Y-%m-%dT%H:%M:%fZ', ${c("fetched_at")}, '-${d} day'))`;
}
