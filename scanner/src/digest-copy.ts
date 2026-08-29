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
  notRelevant: {
    en: "Not what I need", uk: "Не те, що треба",
    fr: "Pas ce qu'il me faut", ru: "Не то, что нужно",
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

export const thin = (locale: Locale, got: number, want: number): string => {
  const map: Phrase = {
    en: `Fewer than usual today — ${got} instead of ${want}. We dug deeper but found nothing better.`,
    uk: `Сьогодні менше ніж зазвичай — ${got} замість ${want}. Ми копали глибше, але кращого не знайшли.`,
    fr: `Moins que d'habitude aujourd'hui — ${got} au lieu de ${want}. Nous avons creusé plus loin sans trouver mieux.`,
    ru: `Сегодня меньше обычного — ${got} вместо ${want}. Мы копали глубже, но лучшего не нашли.`,
  };
  return map[locale] ?? map.en;
};

export const scanned = (locale: Locale, jobs: number, companies: number): string => {
  const n = jobs.toLocaleString(intlOf(locale));
  const map: Phrase = {
    en: `Scanned ${n} jobs at ${companies} companies.`,
    uk: `Переглянуто ${n} вакансій у ${companies} компаніях.`,
    fr: `${n} offres passées en revue dans ${companies} entreprises.`,
    ru: `Просмотрено ${n} вакансий в ${companies} компаниях.`,
  };
  return map[locale] ?? map.en;
};

/**
 * Рядок «чому ти» без моделі — з ідентифікаторів причин збігу.
 *
 * Досі explainLocally писав українською для всіх, і без ключа Anthropic саме
 * цей рядок бачив кожен француз. Сфери й індустрії лишаються сирими
 * ідентифікаторами: словник назв живе на сайті, сканер його навмисно не
 * бачить (див. MatchFact у match.ts).
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
    en: `${v} is one of your fields`, uk: `це ${v}, одна з твоїх сфер`,
    fr: `${v}, un de vos domaines`, ru: `это ${v}, одна из твоих сфер`,
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
    const ph = WHY[b.k]("v" in b ? b.v : "");
    return ph[locale] ?? ph.en;
  });
  return `${words.join(", ")}.`;
};
