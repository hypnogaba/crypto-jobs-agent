/** Спільний словник для онбордингу, парсингу й підбору. Одне джерело правди. */

export const SPHERES = [
  { id: "engineering",   en: "Engineering",           uk: "Інженерія",              fr: "Ingénierie",          ru: "Инженерия" },
  { id: "data-ai",       en: "Data & AI",             uk: "Дані та AI",             fr: "Données et IA",       ru: "Данные и AI" },
  { id: "product",       en: "Product",               uk: "Продукт",                fr: "Produit",             ru: "Продукт" },
  // Окремо від продукту: дизайнер і продакт — різні вакансії, а спільна
  // кнопка змушувала дизайнера отримувати добірки з PM-ролями.
  { id: "design",        en: "Design",                uk: "Дизайн",                 fr: "Design",              ru: "Дизайн" },
  { id: "devrel",        en: "DevRel & Community",    uk: "DevRel і спільнота",     fr: "DevRel et communauté",ru: "DevRel и сообщество" },
  { id: "partnerships",  en: "Partnerships & BD",     uk: "Партнерства і BD",       fr: "Partenariats et BD",  ru: "Партнёрства и BD" },
  { id: "operations",    en: "Operations & Programs", uk: "Операції та проєкти",    fr: "Opérations",          ru: "Операции и проекты" },
  { id: "marketing",     en: "Marketing & Growth",    uk: "Маркетинг і зростання",  fr: "Marketing",           ru: "Маркетинг и рост" },
  { id: "sales",         en: "Sales & Success",       uk: "Продажі",                fr: "Ventes",              ru: "Продажи" },
  { id: "security",      en: "Security",              uk: "Безпека",                fr: "Sécurité",            ru: "Безопасность" },
  { id: "qa",            en: "QA & Testing",          uk: "QA і тестування",        fr: "QA et tests",         ru: "QA и тестирование" },
] as const;

export const INDUSTRIES = [
  { id: "web3",      en: "Web3 & Crypto",  uk: "Web3 і крипта",   fr: "Web3 et crypto",  ru: "Web3 и крипта" },
  { id: "ai",        en: "AI & Deep Tech", uk: "AI і deep-tech",  fr: "IA et deep tech", ru: "AI и deep tech" },
  { id: "fintech",   en: "Fintech",        uk: "Фінтех",          fr: "Fintech",         ru: "Финтех" },
  { id: "health",    en: "Health & Bio",   uk: "Здоров'я і біо",  fr: "Santé et bio",    ru: "Здоровье и био" },
  { id: "games",     en: "Games",          uk: "Ігри",            fr: "Jeux",            ru: "Игры" },
  { id: "ecommerce", en: "E-commerce",     uk: "E-commerce",      fr: "E-commerce",      ru: "E-commerce" },
  { id: "defence",   en: "Defence Tech",   uk: "Оборонні технології", fr: "Défense",     ru: "Оборонные технологии" },
  { id: "nonprofit", en: "Non-profit",     uk: "Некомерційний сектор", fr: "Associatif", ru: "Некоммерческий сектор" },
] as const;

export const SENIORITY = [
  { id: "junior", en: "Junior",         uk: "Junior",         fr: "Junior",        ru: "Junior" },
  { id: "middle", en: "Middle",         uk: "Middle",         fr: "Confirmé",      ru: "Middle" },
  { id: "senior", en: "Senior",         uk: "Senior",         fr: "Senior",        ru: "Senior" },
  { id: "lead",   en: "Lead and above", uk: "Lead і вище",    fr: "Lead et plus",  ru: "Lead и выше" },
] as const;

export const REMOTE_MODES = [
  { id: "remote_only",    en: "Remote only",                 uk: "Тільки віддалено",            fr: "100% à distance",        ru: "Только удалённо" },
  { id: "remote_or_city", en: "Remote, or office in my city",uk: "Віддалено або офіс у місті",  fr: "À distance ou au bureau",ru: "Удалённо или офис в городе" },
  { id: "relocate",       en: "Open to relocating",          uk: "Готовий/готова переїхати",    fr: "Prêt à déménager",       ru: "Готов(а) переехать" },
] as const;

export type SphereId = (typeof SPHERES)[number]["id"];
export type IndustryId = (typeof INDUSTRIES)[number]["id"];
export type SeniorityId = (typeof SENIORITY)[number]["id"];
export type RemoteModeId = (typeof REMOTE_MODES)[number]["id"];
export type Locale = "en" | "uk" | "fr" | "ru";

export const label = (
  item: { en: string; uk: string; fr: string; ru: string }, locale: Locale
): string => item[locale] ?? item.en;

/**
 * «Де хочеш працювати» — це набір, а не один вибір.
 *
 * Людина, готова і на офіс у своєму місті, і на переїзд, раніше мусила
 * викреслити одне з двох: поле було радіо-кнопкою. Тепер у стовпці
 * `remote_mode` лежить список ідентифікаторів через кому. Старі рядки —
 * це список з одного елемента, тож міграція не потрібна: формат читає
 * і те, що записано до цієї зміни.
 *
 * `remote_only` виключний за змістом: «тільки віддалено» разом з «офіс у
 * місті» — суперечність, і виграє те, що ширше.
 */
export const parseModes = (raw: string | null | undefined): RemoteModeId[] => {
  const ids = new Set(REMOTE_MODES.map((m) => m.id as string));
  const list = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter((s) => ids.has(s)))];
  const wide = list.filter((m) => m !== "remote_only");
  return (wide.length ? wide : list) as RemoteModeId[];
};

/** Порожній набір повертає порожній рядок: підставляти замовчування — справа того, хто пише в базу. */
export const serializeModes = (modes: string[]): string =>
  REMOTE_MODES.filter((m) => modes.includes(m.id)).map((m) => m.id).join(",");

/**
 * Дотик по одному варіанту. «Тільки віддалено» витісняє решту й витісняється
 * нею — інакше кнопка виглядала б зламаною: людина тисне, а галочка не
 * з'являється, бо parseModes мовчки викидає суперечність.
 */
export const toggleMode = (raw: string | null | undefined, id: string): string => {
  const cur = parseModes(raw);
  if (cur.includes(id as RemoteModeId)) return serializeModes(cur.filter((m) => m !== id));
  if (id === "remote_only") return "remote_only";
  return serializeModes([...cur.filter((m) => m !== "remote_only"), id]);
};

/** Місто питається лише в того, хто згоден не тільки на віддалену роботу. */
export const needsCity = (modes: string[]): boolean =>
  modes.some((m) => m === "remote_or_city" || m === "relocate");
