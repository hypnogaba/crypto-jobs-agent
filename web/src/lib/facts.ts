/**
 * Читання причин збігу, які записав сканер.
 *
 * Сканер — окремий пакет і спільного коду з сайтом не має, тому контракт
 * між ними — JSON у sent.match_facts. Тут його розкривають у назви за
 * локаллю через той самий словник, який бачила людина в онбордингу.
 */
import { INDUSTRIES, SPHERES, label, type Locale } from "./vocab";
import { t } from "./i18n";

export type MatchFact =
  | { k: "sphere"; v: string }
  | { k: "role"; v: string }
  | { k: "industry"; v: string }
  | { k: "place"; v: string }
  | { k: "level" }
  | { k: "remote" }
  | { k: "salary" }
  | { k: "fresh" };

const KINDS = new Set(["sphere", "role", "industry", "place", "level", "remote", "salary", "fresh"]);

const isFact = (x: unknown): x is MatchFact =>
  typeof x === "object" && x !== null && KINDS.has((x as { k?: unknown }).k as string);

export function parseFacts(raw: string | null | undefined): MatchFact[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isFact) : [];
  } catch {
    return [];
  }
}

const named = (src: readonly { id: string; en: string; uk: string; fr: string; ru: string }[],
               id: string, locale: Locale): string => {
  const it = src.find((x) => x.id === id);
  // Невідомий ідентифікатор показуємо як є: краще сире слово, ніж порожня
  // картка або виняток на сервері.
  return it ? label(it, locale) : id;
};

/** Підписи чіпів, від сильнішого до слабшого. Максимум п'ять. */
export function factLabels(facts: MatchFact[], locale: Locale, max = 5): string[] {
  return facts.slice(0, max).map((f) => {
    switch (f.k) {
      case "sphere":   return named(SPHERES, f.v, locale);
      case "industry": return named(INDUSTRIES, f.v, locale);
      case "role":     return f.v;
      case "place":    return f.v;
      case "level":    return t(locale, "fact.level");
      case "remote":   return t(locale, "fact.remote");
      case "salary":   return t(locale, "fact.salary");
      case "fresh":    return t(locale, "fact.fresh");
    }
  });
}
