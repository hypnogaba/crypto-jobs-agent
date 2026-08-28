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
