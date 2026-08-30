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

/**
 * Індустрії — за розміром у кеші, а не за нашим уявленням про важливість.
 *
 * Порядок тут не косметика: людина читає перші три уважно, решту гортає. На
 * 30 серпня 2026 в кеші 6 977 вакансій з AI, 4 513 з фінтеху і лише 893 з
 * web3 — тобто крипта, з якої продукт починався, це 3% того, що ми маємо.
 * Тримати її першою означало б обіцяти те, чого найменше.
 *
 * Жодну не прибрано: у найменшої (ігри) все одно 233 вакансії, а порожня
 * галочка гірша за незнайому — вона нічого не знайде й забере три бали в
 * усього іншого.
 *
 * «Deep tech» прибрано з назви AI: це жаргон, і людина, яка його не знає,
 * читає всю кнопку як незрозумілу. Тег під нею й так називається просто `ai`.
 */
export const INDUSTRIES = [
  { id: "ai",        en: "AI",             uk: "AI",              fr: "IA",              ru: "AI" },
  { id: "fintech",   en: "Fintech",        uk: "Фінтех",          fr: "Fintech",         ru: "Финтех" },
  { id: "health",    en: "Health & Bio",   uk: "Здоров'я і біо",  fr: "Santé et bio",    ru: "Здоровье и био" },
  { id: "defence",   en: "Defence Tech",   uk: "Оборонні технології", fr: "Défense",     ru: "Оборонные технологии" },
  { id: "ecommerce", en: "E-commerce",     uk: "E-commerce",      fr: "E-commerce",      ru: "E-commerce" },
  { id: "web3",      en: "Web3 & Crypto",  uk: "Web3 і крипта",   fr: "Web3 et crypto",  ru: "Web3 и крипта" },
  { id: "games",     en: "Games",          uk: "Ігри",            fr: "Jeux",            ru: "Игры" },
  { id: "nonprofit", en: "Non-profit",     uk: "Громадські організації", fr: "Associatif", ru: "Общественные организации" },
] as const;

/**
 * Рівня тут більше немає, і це навмисно.
 *
 * Питання стояло третім із чотирьох, а працювало гірше за випадковість.
 * Бал за рівень спирався на тег, який сканер брав із НАЗВИ вакансії, — і
 * 62% кеша (14 049 рядків із 22 674) не мали того тегу взагалі. Тобто на
 * двох третинах вакансій відповідь людини не робила нічого.
 *
 * Гірше: тега `middle` не існувало ніколи. Кнопка на сайті була, збігу за
 * нею не могло бути в принципі, а невідповідність із senior і lead коштувала
 * −2 і −4. Людина, що чесно назвала свій рівень, діставала за це лише штраф
 * на 7 867 вакансіях.
 *
 * За весь час жодна скарга не назвала рівень причиною, і всі seniority_weight
 * лишились одиницями. Тому питання прибране цілком, а не полагоджене:
 * слова про рівень людина й далі може написати в побажаннях, і вони там
 * справді шукаються — на відміну від цих чотирьох кнопок.
 */

export const REMOTE_MODES = [
  { id: "remote_only",    en: "Remote only",                 uk: "Тільки віддалено",            fr: "100% à distance",        ru: "Только удалённо" },
  { id: "remote_or_city", en: "Remote, or office in my city",uk: "Віддалено або офіс у місті",  fr: "À distance ou au bureau",ru: "Удалённо или офис в городе" },
  { id: "relocate",       en: "Open to relocating",          uk: "Готовий/готова переїхати",    fr: "Prêt à déménager",       ru: "Готов(а) переехать" },
] as const;

export type SphereId = (typeof SPHERES)[number]["id"];
export type IndustryId = (typeof INDUSTRIES)[number]["id"];
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
  // Порядок завжди словниковий, а не той, у якому людина натискала: інакше
  // той самий набір показувався б по-різному в боті й на сайті.
  const written = new Set((raw ?? "").split(",").map((s) => s.trim()));
  const list = REMOTE_MODES.map((m) => m.id).filter((id) => written.has(id));
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
