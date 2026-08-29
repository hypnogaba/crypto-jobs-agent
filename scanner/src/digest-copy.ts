/**
 * Усе, що каже ранкова добірка, — у чотирьох мовах.
 *
 * Досі formatDigest був зашитий українською, хоча решта бота вже говорила
 * мовою людини. Виходило, що найважливіше повідомлення продукту — те єдине,
 * заради якого людина підписалась, — приходило французу українською.
 *
 * Сканер — окремий пакет і не бачить web/src/lib/bot-copy.ts, тож форма
 * Phrase тут повторена навмисно. Один імпорт через межу пакета коштував би
 * дорожче, ніж двадцять рядків.
 */
export type Locale = "en" | "uk" | "fr" | "ru";

type Phrase = { en: string; uk: string; fr: string; ru: string };

export const asLocale = (raw: string | null | undefined): Locale =>
  raw === "uk" || raw === "fr" || raw === "ru" ? raw : "en";

const P = {
  greeting: {
    en: "Good morning. Look what I found for you today.",
    uk: "Доброго ранку. Дивись, що я знайшов саме для тебе.",
    fr: "Bonjour. Regardez ce que j'ai trouvé pour vous aujourd'hui.",
    ru: "Доброе утро. Смотри, что я нашёл именно для тебя.",
  },
  why: {
    en: "Why you", uk: "Чому ти", fr: "Pourquoi vous", ru: "Почему ты",
  },
  noSalary: {
    en: "no range given", uk: "вилку не вказано",
    fr: "fourchette non précisée", ru: "вилка не указана",
  },
  noLocation: {
    en: "location not given", uk: "локація не вказана",
    fr: "lieu non précisé", ru: "локация не указана",
  },
  remote: {
    en: "remote", uk: "віддалено", fr: "à distance", ru: "удалённо",
  },
  from: {
    en: "from", uk: "від", fr: "à partir de", ru: "от",
  },
  to: {
    en: "up to", uk: "до", fr: "jusqu'à", ru: "до",
  },
  // Запит «ще п'ять» уперся в денну стелю: людина отримала менше за п'ять
  // не тому, що вакансій мало, а тому, що добова квота закінчилась.
  capLast: {
    en: "These are the last for today — the cap is 20 jobs a day. The rest comes tomorrow.",
    uk: "Це останні на сьогодні — стеля 20 вакансій на день. Решта завтра.",
    fr: "Ce sont les dernières pour aujourd'hui — le plafond est de 20 offres par jour. La suite demain.",
    ru: "Это последние на сегодня — потолок 20 вакансий в день. Остальное завтра.",
  },
  // Кнопка лишає callback_data `not_relevant`, щоб вебхук не ламався;
  // змінився лише напис: «уточнити» кличе до діалогу, а не до скарги.
  notRelevant: {
    en: "Refine", uk: "Уточнити", fr: "Préciser", ru: "Уточнить",
  },
  apply: {
    en: "Apply", uk: "Податися", fr: "Postuler", ru: "Откликнуться",
  },
  capReached: {
    en: "That's the limit for today — 20 jobs. The rest comes tomorrow morning.",
    uk: "Ліміт на сьогодні — 20 вакансій. Решта прийде завтра вранці.",
    fr: "C'est la limite pour aujourd'hui — 20 offres. La suite arrive demain matin.",
    ru: "Лимит на сегодня — 20 вакансий. Остальное придёт завтра утром.",
  },
  more: {
    en: "Five more", uk: "Ще п'ять", fr: "Cinq de plus", ru: "Ещё пять",
  },
  checkin: {
    en: "Still looking? If so, press any button or write something. If not, I will pause the digests in a few days.",
    uk: "Ти ще шукаєш роботу? Якщо так — просто натисни будь-яку кнопку або напиши щось. Якщо ні, я поставлю добірки на паузу за кілька днів.",
    fr: "Vous cherchez toujours ? Si oui, appuyez sur un bouton ou écrivez quelque chose. Sinon, je mettrai les sélections en pause dans quelques jours.",
    ru: "Ты ещё ищешь работу? Если да — просто нажми любую кнопку или напиши что-нибудь. Если нет, я поставлю подборки на паузу через несколько дней.",
  },
  nothingNew: {
    en: "Nothing new for your profile just now. The next digest comes in the morning.",
    uk: "Поки що більше нічого нового під твій профіль. Наступна добірка — вранці.",
    fr: "Rien de nouveau pour votre profil pour l'instant. La prochaine sélection arrive demain matin.",
    ru: "Пока больше ничего нового под твой профиль. Следующая подборка — утром.",
  },
} satisfies Record<string, Phrase>;

export const say = (locale: Locale, key: keyof typeof P): string =>
  P[key][locale] ?? P[key].en;

/** Локаль керує і словами, і форматом чисел: «15 200» проти «15,200». */
export const intlOf = (locale: Locale): string => (locale === "en" ? "en-GB" : locale);

/**
 * Вилка одним рядком: «від 120 000 до 150 000 USD» / «120,000–150,000 USD».
 *
 * Українська, французька й російська кажуть словами («від … до»), англійська
 * — тире. Лише підлога → «від X», лише стеля → «до X». Нічого не відомо —
 * порожньо: картка рядок пропускає, а не пише «вилку не вказано».
 */
export function salaryLine(
  locale: Locale, min: number | null | undefined, max: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (!min && !max) return null;
  const fmt = (n: number) => n.toLocaleString(intlOf(locale));
  const cur = currency ? ` ${currency}` : "";
  if (min && max && min !== max) {
    return locale === "en"
      ? `${fmt(min)}–${fmt(max)}${cur}`
      : `${say(locale, "from")} ${fmt(min)} ${say(locale, "to")} ${fmt(max)}${cur}`;
  }
  if (min) return `${say(locale, "from")} ${fmt(min)}${cur}`;
  return `${say(locale, "to")} ${fmt(max!)}${cur}`;
}

export const thin = (locale: Locale, got: number, want: number): string => {
  const map: Phrase = {
    en: `Fewer than usual today — ${got} instead of ${want}. We dug deeper but found nothing better.`,
    uk: `Сьогодні менше ніж зазвичай — ${got} замість ${want}. Ми копали глибше, але кращого не знайшли.`,
    fr: `Moins que d'habitude aujourd'hui — ${got} au lieu de ${want}. Nous avons creusé plus loin sans trouver mieux.`,
    ru: `Сегодня меньше обычного — ${got} вместо ${want}. Мы копали глубже, но лучшего не нашли.`,
  };
  return map[locale] ?? map.en;
};

/**
 * Назви сфер та індустрій людською мовою.
 *
 * Повний словник живе на сайті (web/src/lib/vocab.ts), і сканер його
 * навмисно не імпортує. Але в рядку «чому ти» сире «finance-legal» виглядає
 * як помилка, тому тут — маленька копія лише назв. Невідомий id повертається
 * як є: краще сирий рядок, ніж порожнеча.
 */
const LABELS: Record<string, Phrase> = {
  engineering:     { en: "Engineering",           uk: "Інженерія",              fr: "Ingénierie",           ru: "Инженерия" },
  "data-ai":       { en: "Data & AI",             uk: "Дані та AI",             fr: "Données et IA",        ru: "Данные и AI" },
  product:         { en: "Product",               uk: "Продукт",                fr: "Produit",              ru: "Продукт" },
  design:          { en: "Design",                uk: "Дизайн",                 fr: "Design",               ru: "Дизайн" },
  devrel:          { en: "DevRel & Community",    uk: "DevRel і спільнота",     fr: "DevRel et communauté", ru: "DevRel и сообщество" },
  partnerships:    { en: "Partnerships & BD",     uk: "Партнерства і BD",       fr: "Partenariats et BD",   ru: "Партнёрства и BD" },
  operations:      { en: "Operations & Programs", uk: "Операції та проєкти",    fr: "Opérations",           ru: "Операции и проекты" },
  marketing:       { en: "Marketing & Growth",    uk: "Маркетинг і зростання",  fr: "Marketing",            ru: "Маркетинг и рост" },
  sales:           { en: "Sales & Success",       uk: "Продажі",                fr: "Ventes",               ru: "Продажи" },
  security:        { en: "Security",              uk: "Безпека",                fr: "Sécurité",             ru: "Безопасность" },
  qa:              { en: "QA & Testing",          uk: "QA і тестування",        fr: "QA et tests",          ru: "QA и тестирование" },
  support:         { en: "Support",               uk: "Підтримка",              fr: "Support",              ru: "Поддержка" },
  "finance-legal": { en: "Finance & Legal",       uk: "Фінанси і право",        fr: "Finance et juridique", ru: "Финансы и право" },
  web3:      { en: "Web3 & Crypto",  uk: "Web3 і крипта",        fr: "Web3 et crypto",  ru: "Web3 и крипта" },
  ai:        { en: "AI & Deep Tech", uk: "AI і deep-tech",       fr: "IA et deep tech", ru: "AI и deep tech" },
  fintech:   { en: "Fintech",        uk: "Фінтех",               fr: "Fintech",         ru: "Финтех" },
  health:    { en: "Health & Bio",   uk: "Здоров'я і біо",       fr: "Santé et bio",    ru: "Здоровье и био" },
  games:     { en: "Games",          uk: "Ігри",                 fr: "Jeux",            ru: "Игры" },
  ecommerce: { en: "E-commerce",     uk: "E-commerce",           fr: "E-commerce",      ru: "E-commerce" },
  defence:   { en: "Defence Tech",   uk: "Оборонні технології",  fr: "Défense",         ru: "Оборонные технологии" },
  nonprofit: { en: "Non-profit",     uk: "Некомерційний сектор", fr: "Associatif",      ru: "Некоммерческий сектор" },
};

export const labelOf = (id: string, locale: Locale): string =>
  LABELS[id]?.[locale] ?? LABELS[id]?.en ?? id;

/** Назва мови для системного промпту моделі: «uk» їй каже менше, ніж слово. */
export const languageName = (locale: Locale): string =>
  ({ en: "English", uk: "Ukrainian", fr: "French", ru: "Russian" })[locale] ?? "English";

/**
 * Рядок «чому ти» без моделі — з ідентифікаторів причин збігу.
 *
 * Досі explainLocally писав українською для всіх, і без ключа Anthropic саме
 * цей рядок бачив кожен француз. Сфери й індустрії підставляються вже
 * назвами через labelOf, а не сирими id.
 */
export type WhyBit =
  | { k: "sphere"; v: string }
  | { k: "role"; v: string }
  | { k: "industry"; v: string }
  | { k: "remote" }
  | { k: "salary" }
  | { k: "title" };

const WHY: Record<WhyBit["k"], (v: string) => Phrase> = {
  sphere: (v) => ({
    en: `${v} is one of your fields`, uk: `це «${v}», одна з твоїх сфер`,
    fr: `${v}, un de vos domaines`, ru: `это «${v}», одна из твоих сфер`,
  }),
  role: (v) => ({
    en: `${v}, as you asked`, uk: `це ${v}, як ти й просив`,
    fr: `${v}, comme vous l'avez demandé`, ru: `это ${v}, как ты и просил`,
  }),
  industry: (v) => ({
    en: `${v} industry`, uk: `індустрія ${v}`, fr: `secteur ${v}`, ru: `индустрия ${v}`,
  }),
  remote: () => ({
    en: "fully remote", uk: "повністю віддалено", fr: "entièrement à distance", ru: "полностью удалённо",
  }),
  salary: () => ({
    en: "salary above your floor", uk: "вилка вища за твій поріг",
    fr: "salaire au-dessus de votre seuil", ru: "вилка выше твоего порога",
  }),
  title: () => ({
    en: "role title matches your profile", uk: "збігається з профілем за назвою ролі",
    fr: "l'intitulé correspond à votre profil", ru: "совпадает с профилем по названию роли",
  }),
};

export const whyLine = (locale: Locale, bits: WhyBit[]): string => {
  const words = bits.map((b) => {
    // Сфера й індустрія приходять як id словника — показуємо назву.
    const v = "v" in b ? (b.k === "role" ? b.v : labelOf(b.v, locale)) : "";
    const ph = WHY[b.k](v);
    return ph[locale] ?? ph.en;
  });
  return `${words.join(", ")}.`;
};
