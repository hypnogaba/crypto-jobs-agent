/** Спільний словник для онбордингу, парсингу й підбору. Одне джерело правди. */

export const SPHERES = [
  { id: "engineering",   en: "Engineering",           uk: "Інженерія",              fr: "Ingénierie",          ru: "Инженерия" },
  { id: "data-ai",       en: "Data & AI",             uk: "Дані та AI",             fr: "Données et IA",       ru: "Данные и AI" },
  { id: "product",       en: "Product & Design",      uk: "Продукт і дизайн",       fr: "Produit et design",   ru: "Продукт и дизайн" },
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
