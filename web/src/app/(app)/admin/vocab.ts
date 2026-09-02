/**
 * Словник панелі: стани джерел, їхні роди, відрізки часу, дрібні форматери.
 *
 * Винесено зі сторінки, бо це опис предметної області, а не верстка. Разом
 * із трьома сусідніми файлами це знімає зі сторінки п'ятсот рядків: вона
 * була на 2 107, і жодна правка в ній не була дешевою.
 */

export const STATE = {
  ok:         { tag: "tag-ok",   c: "var(--ok)",   text: "працює" },
  degraded:   { tag: "tag-warn", c: "var(--warn)", text: "збоїть" },
  deprecated: { tag: "tag-bad",  c: "var(--bad)",  text: "мертве" },
} as const;

/**
 * Роди джерел. Порядок — від того, що дає найбільше нового, до довідника.
 *
 * Агрегатори — єдине джерело НЕВІДОМИХ компаній; ATS — найбільший обсяг, але
 * лише від тих, кого ми вже знаємо; дошка країни — єдине місце, де вакансія
 * взагалі існує.
 */
export const FAMILIES = [
  { key: "ats", label: "компанії на ATS", note: "прямо з дошки роботодавця — найточніше, що є" },
  { key: "aggregator", label: "агрегатори", note: "єдине джерело компаній, яких ми ще не знаємо" },
  { key: "board", label: "національні дошки", note: "вакансія, якої більше ніде немає" },
  { key: "getro", label: "колекції Getro", note: "борди екосистем фондів — і найбільше нових компаній" },
] as const;

/** Рід джерела одним словом — для щільної таблиці, де довгий підпис не влазить. */
export const FAMILY_WORD: Record<string, string> = {
  board: "дошка", aggregator: "агрегатор", getro: "Getro", ats: "ATS",
};

/** Чим скінчилась спроба додати посилання. */
export const VERDICT: Record<string, { tag: string; text: string }> = {
  added:       { tag: "tag-ok",   text: "додано" },
  duplicate:   { tag: "tag-flat", text: "вже було" },
  empty:       { tag: "tag-warn", text: "порожньо" },
  unreachable: { tag: "tag-bad",  text: "не відповіло" },
  unknown:     { tag: "tag-bad",  text: "не розпізнано" },
};

/**
 * Вікно графіків зростання.
 *
 * Було сталою на два тижні. Продукт житиме роками, і питання «як ми ростемо»
 * на двох тижнях відповіді не має — за пів року видно тенденцію, за два тижні
 * лише шум. Вибір лишається в адресі, щоб його можна було зберегти.
 */
export const RANGES = [
  { id: "14", days: 14, label: "два тижні" },
  { id: "30", days: 30, label: "місяць" },
  { id: "90", days: 90, label: "квартал" },
  { id: "365", days: 365, label: "рік" },
] as const;
export const DEFAULT_DAYS = 14;

/**
 * Крок графіка людей.
 *
 * Вікно й крок — різні речі, і плутати їх дорого: рік із денним кроком це
 * 365 однакових стовпчиків, а тиждень із місячним — один. Питання «скільки в
 * нас користувачів» на шести людях узагалі не має графічної відповіді, тому
 * поруч зі стовпчиками стоять числа.
 */
export const BUCKETS = [
  { id: "day",   label: "по днях",    sql: "date(created_at)" },
  { id: "week",  label: "по тижнях",  sql: "strftime('%Y-%W', created_at)" },
  { id: "month", label: "по місяцях", sql: "strftime('%Y-%m', created_at)" },
] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Скільки змін показуємо в дні одразу; решта — під «ще N». */
export const KEY_CHANGES = 6;
export const num = (n: number) => n.toLocaleString("uk-UA");
export const usd = (n: number): string => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
export const day = (iso: string) => iso.slice(5).replace("-", ".");
