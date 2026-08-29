/**
 * Часовий пояс для того, хто прийшов через бота.
 *
 * Telegram поясу не надсилає, а сайт бере його з браузера, якого в бота
 * немає. Досі всі ботові акаунти отримували UTC — і «09:00» приходило об
 * 11:00 у Париж, о 12:00 у Київ. Два способи дізнатись, обидва без
 * зайвого питання, де це можливо:
 *
 *   1. місто, яке людина вже написала (Львів → Europe/Kyiv);
 *   2. інакше — «Котра в тебе зараз година?» з кнопками, на яких стоїть
 *      поточний час у кількох поясах. Людина впізнає свій — і зона відома.
 *
 * Усе тут чисте: сама година береться ззовні, тож тести не залежать від
 * годинника.
 */
import type { Locale } from "./vocab";

type Phrase = { en: string; uk: string; fr: string; ru: string };

/** Пояси на кнопках — ті, де живе більшість наших людей. */
export const CANDIDATE_ZONES = [
  "Europe/Kyiv", "Europe/Paris", "Europe/London", "Europe/Warsaw", "America/New_York", "Asia/Dubai",
] as const;

/** Назва міста на кнопці — мовою людини, бо «Kyiv» українцеві читається гірше за «Київ». */
const ZONE_NAME: Record<string, Phrase> = {
  "Europe/Kyiv":      { en: "Kyiv",     uk: "Київ",     fr: "Kyiv",     ru: "Киев" },
  "Europe/Paris":     { en: "Paris",    uk: "Париж",    fr: "Paris",    ru: "Париж" },
  "Europe/London":    { en: "London",   uk: "Лондон",   fr: "Londres",  ru: "Лондон" },
  "Europe/Warsaw":    { en: "Warsaw",   uk: "Варшава",  fr: "Varsovie", ru: "Варшава" },
  "America/New_York": { en: "New York", uk: "Нью-Йорк", fr: "New York", ru: "Нью-Йорк" },
  "Asia/Dubai":       { en: "Dubai",    uk: "Дубай",    fr: "Dubaï",    ru: "Дубай" },
};

export const zoneName = (zone: string, locale: Locale): string =>
  ZONE_NAME[zone]?.[locale] ?? ZONE_NAME[zone]?.en ?? zone;

/**
 * Місто → пояс. Не довідник, а те, що люди пишуть насправді. Країни
 * (Франція, Польща…) уже покриває geo.ts через TZ_COUNTRY; тут — міста
 * поза тими країнами і найчастіші всередині них, щоб не залежати від
 * порядку у PLACES.
 */
const word = (alts: string) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, "iu");

const CITY_TZ: Array<[string, RegExp]> = [
  ["Europe/Kyiv",      word("kyiv|kiev|київ|киев|lviv|львів|львов|kharkiv|харків|odesa|odessa|одеса|dnipro|дніпро")],
  ["Europe/Paris",     word("paris|париж|lyon|ліон|лион|marseille|марсель|toulouse|bordeaux|nantes|lille|nice")],
  ["Europe/Warsaw",    word("warsaw|warszawa|варшава|krakow|kraków|краків|краков|wroclaw|wrocław|gdansk|gdańsk|poznan")],
  ["Europe/Berlin",    word("berlin|берлін|берлин|munich|münchen|мюнхен|hamburg|frankfurt|cologne|köln")],
  ["Europe/London",    word("london|лондон|manchester|edinburgh|bristol|glasgow|leeds")],
  ["Europe/Madrid",    word("madrid|мадрид|barcelona|барселона|valencia|seville|sevilla")],
  ["Europe/Lisbon",    word("lisbon|lisboa|лісабон|лиссабон|porto|порту")],
  ["Europe/Amsterdam", word("amsterdam|амстердам|rotterdam|utrecht|eindhoven")],
  ["Europe/Prague",    word("prague|praha|прага|brno|брно")],
  ["Europe/Vienna",    word("vienna|wien|відень|вена")],
  ["Europe/Zurich",    word("zurich|zürich|цюрих|цюріх|geneva|genève|женева|basel")],
  ["Asia/Dubai",       word("dubai|дубай|abu dhabi|абу-даби|абу-дабі")],
  ["America/New_York", word("new york|nyc|нью-йорк|boston|бостон|miami|маямі|майами")],
  ["America/Toronto",  word("toronto|торонто|montreal|монреаль|ottawa")],
  ["Asia/Tbilisi",     word("tbilisi|тбілісі|тбилиси|batumi|батумі|батуми")],
];

/** Пояс із написаного міста, або null. */
export function timezoneFromCity(location: string | null | undefined): string | null {
  if (!location?.trim()) return null;
  for (const [zone, re] of CITY_TZ) if (re.test(location)) return zone;
  return null;
}

/** Чи Intl знає таку зону. UTC тут теж «справжня». */
export function isKnownZone(zone: string | null | undefined): zone is string {
  if (!zone?.trim()) return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); return true; } catch { return false; }
}

/** «14:05» у зоні на цей момент. */
export function clockIn(zone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB",
    { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

const hourIn = (zone: string, now: Date): number => Number.parseInt(clockIn(zone, now).slice(0, 2), 10) % 24;

export interface TimeOption { zone: string; time: string }

/**
 * Кнопки «котра година». Однакові часи схлопуються: Париж і Варшава
 * майже завжди показують одне й те саме, і дві кнопки з «14:00» лише
 * заплутували б. Перша зона в списку виграє.
 */
export function timeOptions(now: Date, zones: readonly string[] = CANDIDATE_ZONES): TimeOption[] {
  const out: TimeOption[] = [];
  for (const zone of zones) {
    const time = clockIn(zone, now);
    if (!out.some((o) => o.time === time)) out.push({ zone, time });
  }
  return out;
}

/**
 * Людина написала «14:30» (або «14») — яка це зона? Порівнюємо лише
 * годину. Європа в пріоритеті: наша аудиторія здебільшого там, а на
 * одній годині сидять і Київ, і Каїр.
 */
export function zoneForHour(text: string, now: Date, zones: readonly string[] = CANDIDATE_ZONES): string | null {
  const m = /^\s*(\d{1,2})(?::\d{2})?\s*$/.exec(text);
  if (!m) return null;
  const hour = Number.parseInt(m[1]!, 10);
  if (hour < 0 || hour > 23) return null;
  const hits = zones.filter((z) => hourIn(z, now) === hour);
  return hits.find((z) => z.startsWith("Europe/")) ?? hits[0] ?? null;
}
