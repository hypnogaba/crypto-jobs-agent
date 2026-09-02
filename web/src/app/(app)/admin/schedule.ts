/**
 * Коли сервер зробить наступний прогін.
 *
 * Чисті функції: час приходить аргументом, тож їх можна перевірити тестом,
 * не чекаючи неділі.
 */

/**
 * Годинник сервера, а не браузера.
 *
 * Таймери systemd спрацьовують за місцевим часом VPS, тож «наступний прогін»
 * має рахуватись у ньому. Взяти час машини, що малює сторінку, означало б
 * показувати різні відповіді залежно від того, звідки дивишся.
 */
export const VPS_ZONE = "Europe/Berlin";
export const DAY_NAME = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];

/** Котра година й котрий день тижня зараз на сервері. */
export function serverNow(now: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VPS_ZONE, weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const wd = parts.find((x) => x.type === "weekday")?.value ?? "Sun";
  const hh = Number.parseInt(parts.find((x) => x.type === "hour")?.value ?? "0", 10);
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour: hh };
}

/**
 * Через скільки днів наступний прогін і в який день.
 *
 * Рахуємо в цілих днях навмисно: точна мітка часу вимагала б відтворювати
 * перехід на літній час, а помилка тут коштувала б довіри до всього блоку.
 * «Неділя 06:00 · через 5 дн.» відповідає на питання власника повністю.
 */
export function nextRun(days: readonly number[], hour: number, now: Date): { label: string; inDays: number } {
  const { day, hour: h } = serverNow(now);
  for (let i = 0; i <= 7; i++) {
    const d = (day + i) % 7;
    if (!days.includes(d)) continue;
    if (i === 0 && h >= hour) continue;
    return { label: `${DAY_NAME[d]} ${String(hour).padStart(2, "0")}:00`, inDays: i };
  }
  return { label: "—", inDays: 0 };
}
