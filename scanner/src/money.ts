/**
 * Вилка вакансії проти очікування людини.
 *
 * Досі порівнювались самі числа: «від 120 000 EUR» у профілі проти «від
 * 1 000 USD» у вакансії. Валюта не бралась до уваги зовсім, тож 120 000 USD
 * вважалось таким самим, як 120 000 EUR, а очевидно хибний розбір («1 000»
 * на рік) чесно зараховувався як мала зарплата й давав вакансії штраф
 * замість того, щоб бути проігнорованим.
 */

/**
 * Приблизні курси до євро. Саме приблизні — і це не недогляд.
 *
 * Зарплата тут м'який пріоритет, а не фільтр: різниця між 95 000 і 100 000
 * не змінює нічого, тож щоденний курс не вартий ані запиту, ані залежності.
 * Числа треба переглядати раз на рік, не частіше.
 */
const TO_EUR: Record<string, number> = {
  EUR: 1, USD: 0.92, GBP: 1.17, CHF: 1.05, CAD: 0.68, AUD: 0.60, NZD: 0.55,
  SEK: 0.088, NOK: 0.086, DKK: 0.134, PLN: 0.23, CZK: 0.040, HUF: 0.0026,
  RON: 0.20, BGN: 0.51, UAH: 0.022, TRY: 0.027, ILS: 0.25, AED: 0.25,
  SAR: 0.25, INR: 0.011, SGD: 0.69, HKD: 0.12, JPY: 0.0062, KRW: 0.00068,
  CNY: 0.13, BRL: 0.17, MXN: 0.050, ARS: 0.0009, ZAR: 0.050, PHP: 0.016,
  IDR: 0.000058, VND: 0.000037, THB: 0.026, MYR: 0.20, PKR: 0.0033, NGN: 0.00060,
};

/**
 * Нижче цього річна вилка — не вилка.
 *
 * «Senior National Account Executive … від 1 000 USD» — це або місячна сума,
 * або уламок тексту, який розбір узяв за вилку. Такі рядки не мають ні
 * нагороджуватись, ні каратись: ми просто не знаємо, скільки там платять.
 */
export const IMPLAUSIBLE_YEARLY = 10_000;

/** Сума в євро, або null, якщо валюта невідома чи сума неправдоподібна. */
export function toEur(amount: number | null | undefined, currency: string | null | undefined): number | null {
  if (!amount || amount <= 0) return null;
  const rate = TO_EUR[(currency ?? "EUR").toUpperCase()];
  if (rate === undefined) return null;         // невідома валюта — краще мовчати
  const eur = amount * rate;
  return eur < IMPLAUSIBLE_YEARLY ? null : eur;
}

/**
 * Чи вилку взагалі варто показувати людині.
 *
 * Той самий поріг, що й у підборі: «від 1 000 USD» під вакансією senior-рівня
 * виглядає як зламаний продукт, і воно ним і було.
 */
export function plausibleSalary(
  min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined,
): boolean {
  const rate = TO_EUR[(currency ?? "EUR").toUpperCase()] ?? 1;
  const top = Math.max(min ?? 0, max ?? 0) * rate;
  return top >= IMPLAUSIBLE_YEARLY;
}
