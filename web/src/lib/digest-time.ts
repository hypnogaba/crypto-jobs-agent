/**
 * Заголовок добірки.
 *
 * Дві добірки за одну добу мали однаковий заголовок «2026-08-28» і
 * розрізнити їх було неможливо. Тепер день називається словом, а час
 * рахується в зоні людини — той самий момент є «сьогодні» в Києві й
 * «вчора» в Нью-Йорку.
 */
import { t } from "./i18n";
import type { Locale } from "./vocab";

const intlOf = (locale: Locale): string => (locale === "en" ? "en-GB" : locale);

/**
 * Зона, надіслана браузером.
 *
 * Приймаємо лише те, що справді розуміє Intl: підроблене або порожнє
 * значення мовчки стало б розкладом доставки. UTC — свідомий запасний
 * варіант, а не помилка.
 */
export function safeTimezone(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().slice(0, 64);
  if (!t) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: t });
    return t;
  } catch {
    return "UTC";
  }
}

/** Невідома зона не має валити сторінку кабінету. */
const safe = (timezone: string): string => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
};

export function dayLabel(createdAt: string, timezone: string, locale: Locale, now = new Date()): string {
  const tz = safe(timezone);
  // SQLite пише datetime('now') без зони й без «T». Без явного Z браузер
  // прочитав би це як місцевий час і зсунув добірку на кілька годин.
  const d = new Date(createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`);

  const ymd = (x: Date): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("en-GB",
    { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  const today = ymd(now);
  const yesterday = ymd(new Date(now.getTime() - 86_400_000));

  const day =
    ymd(d) === today ? t(locale, "time.today")
    : ymd(d) === yesterday ? t(locale, "time.yesterday")
    : new Intl.DateTimeFormat(intlOf(locale), { timeZone: tz, day: "numeric", month: "long" }).format(d);

  return `${day}, ${time}`;
}

/** Частини локального часу в зоні: рік-місяць-день, година, день тижня 0..6 (нд=0). */
function partsIn(tz: string, at: Date): { y: number; m: number; d: number; h: number; wd: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, weekday: "short",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, wd };
}

/** Момент, коли в зоні tz настає локальна дата y-m-d о h:00. Ітерація по зсуву — без бібліотек. */
function zonedTime(tz: string, y: number, m: number, d: number, h: number): Date {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 3; i++) {
    const p = partsIn(tz, new Date(guess));
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h);
    const want = Date.UTC(y, m - 1, d, h);
    if (seen === want) break;
    guess += want - seen;
  }
  return new Date(guess);
}

/**
 * Найближча планова доставка: робочий день (Пн–Пт) у зоні людини о hour:00,
 * не раніше за now. Той самий алгоритм у scanner/src/digest-copy.ts.
 */
export function nextDelivery(tz: string, hour: number, now: Date): Date {
  const zone = safe(tz);
  const p = partsIn(zone, now);
  for (let add = 0; add < 8; add++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + add, 12));
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const at = zonedTime(zone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour);
    if (at.getTime() >= now.getTime()) return at;
  }
  return now;
}

/** «понеділок, 31 серпня, 09:00» мовою людини, у її зоні. */
export function formatWhen(at: Date, tz: string, locale: Locale): string {
  const zone = safe(tz);
  const day = new Intl.DateTimeFormat(intlOf(locale), { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return `${day}, ${time}`;
}
