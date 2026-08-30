/**
 * Порядок вакансій у кабінеті.
 *
 * Живе окремо, а не в `actions.ts`: там «use server», і такий файл може
 * віддавати назовні лише асинхронні функції. Сторінці ж потрібні і список
 * порядків, і тип — щоб намалювати перемикач.
 *
 * «День» — те, як кабінет жив досі: ранкова пачка як одиниця. Решта — плаский
 * список усього побаченого, бо питання «де та вакансія на п'ять тисяч» не має
 * відповіді, поки все розкладено по днях.
 */
export type MatchSort = "day" | "score" | "salary" | "fresh";

export const MATCH_SORTS: MatchSort[] = ["day", "score", "salary", "fresh"];

export const isMatchSort = (v: string | undefined): v is MatchSort =>
  MATCH_SORTS.includes(v as MatchSort);

/** Скільки рядків тримаємо в кабінеті. */
export const MATCH_LIMIT = 200;

/**
 * Готовий `ORDER BY` під обраний порядок.
 *
 * «NULLS LAST» вручну: бал з'явився міграцією 0023, тож усе, надіслане
 * раніше, його не має — і без цієї умови старі рядки очолили б список «за
 * відповідністю», нічого про відповідність не знаючи. Те саме з зарплатою:
 * її не публікує більшість дошок.
 */
export function orderFor(sort: string | undefined): string {
  if (!isMatchSort(sort) || sort === "day") return "s.created_at DESC";
  if (sort === "score")  return "s.score IS NULL, s.score DESC, s.created_at DESC";
  if (sort === "salary") return "j.salary_min IS NULL, j.salary_min DESC, s.created_at DESC";
  return "j.posted_at IS NULL, j.posted_at DESC, s.created_at DESC";
}
