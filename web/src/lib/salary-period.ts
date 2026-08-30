/**
 * Зарплата: місячна на екрані, річна в базі.
 *
 * Дві одиниці виміру в одній колонці вже коштували нам мовчазної втрати:
 * людина писала «3000 євро», розбір відкидав усе менше за 20 000 як помилку, і
 * профіль лишався зовсім без зарплати. Тому правило одне на всю систему:
 * у `profiles.salary_min` завжди РІЧНА сума, а людині показуємо й питаємо
 * місячну — так думають і в Європі, і в Україні.
 */
export const MONTHS = 12;

/** Річне з бази → місячне для екрана. */
export const monthlyFrom = (yearly: number | null): number | null =>
  yearly === null ? null : Math.round(yearly / MONTHS);

/** Місячне з форми → річне для бази. */
export const yearlyFrom = (monthly: number | null): number | null =>
  monthly === null ? null : monthly * MONTHS;
