/**
 * Покроковий онбординг у чаті.
 *
 * Раніше бот просив написати все одним реченням. На «тест» він відповідав
 * «Сфери: не визначено, Рівень: не визначено» і мовчки зберігав порожній
 * профіль. Людині не було зрозуміло, що саме писати, а система приймала
 * будь-що.
 *
 * Тепер ті самі чотири питання, що й на сайті, але кнопками. Словник спільний
 * (`vocab.ts`), тож бот і сайт не можуть розійтись у варіантах.
 *
 * Чисті функції зверху, робота з базою й Telegram — знизу.
 */
import {
  SPHERES, INDUSTRIES, SENIORITY, REMOTE_MODES, label, type Locale,
} from "./vocab";
import { timezoneFromCity, timeOptions, zoneName } from "./tz";
import { timezoneFor } from "./geo";

export type Step = "spheres" | "wishes" | "industries" | "seniority" | "where" | "city" | "tz" | "salary";

/**
 * Порядок питань. «Побажання» одразу після сфер: людина щойно побачила
 * кнопки й знає, чого в них немає. «Година» після міста: якщо місто вже
 * назвало пояс, питання не ставиться.
 */
export const STEPS: Step[] = ["spheres", "wishes", "industries", "seniority", "where", "city", "tz", "salary"];

/** Поля, які людина редагує по одному через /profile. Мова й година живуть у users, не в profiles. */
export const EDITABLE: Step[] = ["spheres", "industries", "seniority", "where", "salary", "wishes", "tz"];

export interface Draft {
  spheres: string[];
  /** Своя назва ролі, коли жодна сфера не підійшла. */
  customRole?: string | null;
  /** Своя індустрія, свій рівень, своя локація — те саме для решти питань. */
  customIndustry?: string | null;
  customSeniority?: string | null;
  customWhere?: string | null;
  industries: string[];
  seniority: string | null;
  remoteMode: string | null;
  /**
   * Місто. Питається лише в того, хто готовий працювати не тільки віддалено:
   * саме звідси береться країна для ботових акаунтів. Telegram часового поясу
   * не надсилає, тож усі вони мають UTC — і без цього питання країни в них не
   * буде ніколи, а отже й локальних вакансій.
   */
  location?: string | null;
  /** Вільний текст: чого немає в кнопках. */
  wishes?: string | null;
  /** Пояс, обраний кнопкою «котра година» або виведений із міста. */
  timezone?: string | null;
  salaryMin: number | null;
  salaryCurrency: string | null;
}

export const emptyDraft = (): Draft => ({
  spheres: [], customRole: null, industries: [], customIndustry: null,
  customSeniority: null, customWhere: null, seniority: null,
  remoteMode: null, location: null, wishes: null, timezone: null,
  salaryMin: null, salaryCurrency: null,
});

/**
 * Пояс із того, що вже відомо: місто → країна → мова. Null лише коли
 * жоден сигнал нічого не каже — тоді питаємо годину.
 */
export function draftTimezone(draft: Draft, locale: Locale): string | null {
  if (draft.timezone) return draft.timezone;
  const byCity = timezoneFromCity(draft.location) ?? timezoneFromCity(draft.customWhere);
  if (byCity) return byCity;
  const guessed = timezoneFor(locale, draft.location);
  return guessed === "UTC" ? null : guessed;
}

/**
 * Кому питання про місто не ставиться: тому, хто хоче лише віддалену роботу,
 * і тому, хто вже назвав місце своїми словами на попередньому кроці.
 */
const skipsCity = (draft: Draft): boolean =>
  draft.remoteMode === "remote_only" || Boolean(draft.location?.trim());

/**
 * Наступне питання, або null якщо це було останнє.
 *
 * Питання про місто умовне: тому, хто хоче лише віддалену роботу, воно
 * нічого не додає, а зайве питання коштує більше, ніж дає.
 */
export function nextStep(step: Step, draft?: Draft): Step | null {
  const i = STEPS.indexOf(step);
  if (i === -1 || i === STEPS.length - 1) return null;
  const after = STEPS[i + 1]!;
  if (after === "city" && draft && skipsCity(draft)) return nextStep(after, draft);
  // Питання про годину лише тому, чий пояс не вивівся з міста чи країни.
  // Мова тут не рахується: «uk» у Варшаві — звичайна річ.
  if (after === "tz" && draft && (draft.timezone || timezoneFromCity(draft.location) || timezoneFromCity(draft.customWhere))) {
    return nextStep(after, draft);
  }
  return after;
}

/** Перемикач для питань із кількома відповідями. */
export function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// ── Тексти ────────────────────────────────────────────────────
// Тримаємо тут, поруч зі словником варіантів, а не в i18n.ts: питання й
// відповіді читаються разом і змінюються разом.

type Phrase = { en: string; uk: string; fr: string; ru: string };

const ASK: Record<Step, Phrase> = {
  spheres: {
    en: "1 of 4 · What kind of work?\nPick everything that fits.",
    uk: "1 з 4 · Яка робота?\nОбери все, що підходить.",
    fr: "1 sur 4 · Quel type de poste ?\nChoisissez tout ce qui convient.",
    ru: "1 из 4 · Какая работа?\nВыбери всё, что подходит.",
  },
  industries: {
    en: "2 of 4 · Any industry you care about?\nOptional — skip if it does not matter.",
    uk: "2 з 4 · Якісь індустрії цікавлять?\nНеобов'язково — пропусти, якщо байдуже.",
    fr: "2 sur 4 · Un secteur en particulier ?\nFacultatif — passez si peu importe.",
    ru: "2 из 4 · Какие-то индустрии интересуют?\nНеобязательно — пропусти, если всё равно.",
  },
  seniority: {
    en: "3 of 4 · Your level?",
    uk: "3 з 4 · Твій рівень?",
    fr: "3 sur 4 · Votre niveau ?",
    ru: "3 из 4 · Твой уровень?",
  },
  where: {
    en: "4 of 4 · Where do you want to work?",
    uk: "4 з 4 · Де хочеш працювати?",
    fr: "4 sur 4 · Où voulez-vous travailler ?",
    ru: "4 из 4 · Где хочешь работать?",
  },
  wishes: {
    en: "Anything important that is not in the buttons?\nWrite it, or skip.",
    uk: "Є щось важливе, чого нема в кнопках?\nНапиши або пропусти.",
    fr: "Quelque chose d'important qui n'est pas dans les boutons ?\nÉcrivez-le, ou passez.",
    ru: "Есть что-то важное, чего нет в кнопках?\nНапиши или пропусти.",
  },
  tz: {
    en: "What time is it for you right now?\nThis sets when the digest arrives.",
    uk: "Котра в тебе зараз година?\nВід цього залежить, коли приходить добірка.",
    fr: "Quelle heure est-il chez vous en ce moment ?\nCela règle l'heure d'envoi.",
    ru: "Который у тебя сейчас час?\nОт этого зависит, когда приходит подборка.",
  },
  city: {
    en: "Which city?\nWrite it however you like — Berlin, Kyiv, Paris. It unlocks local job boards.",
    uk: "Яке місто?\nНапиши як зручно — Берлін, Київ, Париж. Це відкриває місцеві дошки вакансій.",
    fr: "Quelle ville ?\nÉcrivez-la comme vous voulez — Berlin, Kyiv, Paris. Cela débloque les sites d'emploi locaux.",
    ru: "Какой город?\nНапиши как удобно — Берлин, Киев, Париж. Это открывает местные доски вакансий.",
  },
  salary: {
    en: "Last one · Salary floor, per year, before tax?\nA soft preference, not a hard filter — most postings show no range at all.",
    uk: "Останнє · Зарплата від, за рік, до податків?\nМ'який пріоритет, не жорсткий фільтр — більшість вакансій вилку взагалі не вказує.",
    fr: "Dernière · Salaire minimum, par an, avant impôts ?\nUne préférence, pas un filtre — la plupart des offres n'affichent aucune fourchette.",
    ru: "Последнее · Зарплата от, за год, до налогов?\nМягкий приоритет, не жёсткий фильтр — большинство вакансий вилку не указывает.",
  },
};

const WORD = {
  done:     { en: "Done", uk: "Готово", fr: "Terminé", ru: "Готово" },
  skip:     { en: "Skip", uk: "Пропустити", fr: "Passer", ru: "Пропустить" },
  pickOne:  { en: "Pick at least one", uk: "Обери хоча б одне", fr: "Choisissez au moins un", ru: "Выбери хотя бы одно" },
  noMatter: { en: "Does not matter", uk: "Не важливо", fr: "Peu importe", ru: "Не важно" },
  other:    { en: "Another amount", uk: "Інша сума", fr: "Autre montant", ru: "Другая сумма" },
  perYear:  { en: "yr", uk: "рік", fr: "an", ru: "год" },
  askOther: {
    en: "Write the yearly amount and currency, for example: 90000 EUR",
    uk: "Напиши річну суму й валюту, наприклад: 90000 EUR",
    fr: "Écrivez le montant annuel et la devise, par exemple : 90000 EUR",
    ru: "Напиши годовую сумму и валюту, например: 90000 EUR",
  },
  otherTime: { en: "Another time", uk: "Інша", fr: "Autre", ru: "Другое" },
  askTime: {
    en: "Write your current time as HH:MM, for example 14:30",
    uk: "Напиши свій поточний час як ГГ:ХХ, наприклад 14:30",
    fr: "Écrivez votre heure actuelle au format HH:MM, par exemple 14:30",
    ru: "Напиши своё текущее время как ЧЧ:ММ, например 14:30",
  },
  askWishes: {
    en: "Write what matters — one message.",
    uk: "Напиши, що важливо, — одним повідомленням.",
    fr: "Écrivez ce qui compte — en un message.",
    ru: "Напиши, что важно, — одним сообщением.",
  },
  mine: {
    en: "Not in the list",
    uk: "Немає в списку",
    fr: "Pas dans la liste",
    ru: "Нет в списке",
  },
  askIndustry: {
    en: "Write the industry in your own words, for example: climate tech, logistics, esports.",
    uk: "Напиши індустрію своїми словами — наприклад: кліматтех, логістика, кіберспорт.",
    fr: "Écrivez le secteur avec vos mots, par exemple : climat, logistique, esport.",
    ru: "Напиши индустрию своими словами — например: климаттех, логистика, киберспорт.",
  },
  askLevel: {
    en: "Write your level in your own words, for example: founder, head of, C-level, first job.",
    uk: "Напиши свій рівень своїми словами — наприклад: засновник, керівник напряму, C-level, перша робота.",
    fr: "Écrivez votre niveau avec vos mots : fondateur, responsable, C-level, premier emploi.",
    ru: "Напиши свой уровень своими словами — например: основатель, руководитель направления, C-level, первая работа.",
  },
  askWhere: {
    en: "Write where you want to work, for example: Berlin only, EU time zones, anywhere but the US.",
    uk: "Напиши, де хочеш працювати — наприклад: тільки Берлін, часові пояси ЄС, будь-де крім США.",
    fr: "Écrivez où vous voulez travailler : Berlin uniquement, fuseaux UE, partout sauf les États-Unis.",
    ru: "Напиши, где хочешь работать — например: только Берлин, часовые пояса ЕС, где угодно кроме США.",
  },
  askMine: {
    en: "Write your role in your own words, for example: technical recruiting, grant writing, smart contract audit.",
    uk: "Напиши свою роль своїми словами — наприклад: технічний рекрутинг, grant writing, аудит смартконтрактів.",
    fr: "Écrivez votre rôle avec vos mots, par exemple : recrutement technique, rédaction de subventions, audit de smart contracts.",
    ru: "Напиши свою роль своими словами — например: технический рекрутинг, grant writing, аудит смартконтрактов.",
  },
  // Три кроки, а не гола готовність. І «завтра о 09:00» тут більше не
  // писали б правду: профіль одразу замовляє позачергову добірку.
  ready: {
    en: "You are set.\n\n\u2713 Profile saved\n\u25cf First batch \u2014 within the hour\n\u25cb Then \u2014 every day at your time",
    uk: "Готово.\n\n\u2713 Профіль збережено\n\u25cf Перша добірка \u2014 протягом години\n\u25cb Далі \u2014 щодня у твій час",
    fr: "C'est prêt.\n\n\u2713 Profil enregistré\n\u25cf Première sélection \u2014 dans l'heure\n\u25cb Ensuite \u2014 chaque jour à votre heure",
    ru: "Готово.\n\n\u2713 Профиль сохранён\n\u25cf Первая подборка \u2014 в течение часа\n\u25cb Дальше \u2014 каждый день в твоё время",
  },
  commands: {
    en: "/profile — your profile, edit any field\n/time — delivery hour\n/lang — language\n/pause and /resume\n/site — sign in on the web",
    uk: "/profile — твій профіль, правка по пунктах\n/time — година доставки\n/lang — мова\n/pause і /resume — пауза\n/site — вхід на сайт",
    fr: "/profile — votre profil, champ par champ\n/time — heure d'envoi\n/lang — langue\n/pause et /resume\n/site — accès au site",
    ru: "/profile — твой профиль, правка по пунктам\n/time — час доставки\n/lang — язык\n/pause и /resume — пауза\n/site — вход на сайт",
  },
  // Підписи рядків у /profile — що саме редагувати.
  fSpheres:    { en: "Fields",     uk: "Сфери",      fr: "Domaines",  ru: "Сферы" },
  fIndustries: { en: "Industries", uk: "Індустрії",  fr: "Secteurs",  ru: "Индустрии" },
  fSeniority:  { en: "Level",      uk: "Рівень",     fr: "Niveau",    ru: "Уровень" },
  fWhere:      { en: "Place",      uk: "Місце",      fr: "Lieu",      ru: "Место" },
  fSalary:     { en: "Salary",     uk: "Зарплата",   fr: "Salaire",   ru: "Зарплата" },
  fWishes:     { en: "Wishes",     uk: "Побажання",  fr: "Souhaits",  ru: "Пожелания" },
  fLang:       { en: "Language",   uk: "Мова",       fr: "Langue",    ru: "Язык" },
  fTz:         { en: "Hour",       uk: "Година",     fr: "Heure",     ru: "Час" },
} satisfies Record<string, Phrase>;

const say = (p: Phrase, locale: Locale): string => p[locale] ?? p.en;

/** Звичайні суми в євро. Хто хоче іншу — напише сам. */
const SALARY_STEPS = [40_000, 60_000, 80_000, 100_000, 120_000];

export interface Button { text: string; callback_data: string }

export interface KeyboardOptions {
  /** `ob` — онбординг, `ed` — правка одного поля з /profile. Обробники різні, клавіатура одна. */
  prefix?: "ob" | "ed";
  /** Момент, від якого рахуються кнопки «котра година». Ззовні — заради тестів. */
  now?: Date;
}

/**
 * Клавіатура під питанням. Обране позначається галочкою просто в тексті
 * кнопки: Telegram не має стану кнопок, тож стан має бути видимим.
 */
export function keyboard(step: Step, draft: Draft, locale: Locale, opts: KeyboardOptions = {}): Button[][] {
  const pre = opts.prefix ?? "ob";
  const rows: Button[][] = [];
  const pair = (items: Button[]): void => {
    for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  };

  if (step === "spheres" || step === "industries") {
    const src = step === "spheres" ? SPHERES : INDUSTRIES;
    const chosen = step === "spheres" ? draft.spheres : draft.industries;
    pair(src.map((it) => ({
      text: `${chosen.includes(it.id) ? "✓ " : ""}${label(it, locale)}`,
      callback_data: `${pre}:${step}:${it.id}`,
    })));
    // Ця кнопка справжня: написане шукається в назвах вакансій
    // (див. matchesCustomRole у сканері), а не лежить мертвим текстом.
    const written = step === "spheres" ? draft.customRole : draft.customIndustry;
    rows.push([{
      text: `${written ? "✓ " : ""}${say(WORD.mine, locale)}`,
      callback_data: `${pre}:${step}:__mine`,
    }]);
    const canFinish = step === "industries" || chosen.length > 0 || Boolean(draft.customRole);
    rows.push([{
      text: canFinish
        ? say(step === "industries" && chosen.length === 0 ? WORD.skip : WORD.done, locale)
        : say(WORD.pickOne, locale),
      callback_data: canFinish ? `${pre}:${step}:__next` : `${pre}:noop:0`,
    }]);
    return rows;
  }

  // «Немає в списку» стоїть під кожним питанням: жоден словник не покриває
  // всіх, а мовчазний вибір «найближчого» псує підбір гірше за порожнє поле.
  if (step === "seniority") {
    pair(SENIORITY.map((it) => ({ text: label(it, locale), callback_data: `${pre}:seniority:${it.id}` })));
    rows.push([{ text: say(WORD.mine, locale), callback_data: `${pre}:seniority:__mine` }]);
    return rows;
  }

  // Місто й побажання — вільний текст: жодного списку тут бути не може.
  // Єдина кнопка дозволяє не відповідати.
  if (step === "city" || step === "wishes") {
    return [[{ text: say(WORD.skip, locale), callback_data: `${pre}:${step}:__next` }]];
  }

  if (step === "where") {
    for (const it of REMOTE_MODES) {
      rows.push([{ text: label(it, locale), callback_data: `${pre}:where:${it.id}` }]);
    }
    rows.push([{ text: say(WORD.mine, locale), callback_data: `${pre}:where:__mine` }]);
    return rows;
  }

  // Котра година: на кнопках поточний час у кількох поясах, однакові
  // схлопнуто. Людина впізнає свій — і пояс відомий без жодного «Europe/…».
  if (step === "tz") {
    pair(timeOptions(opts.now ?? new Date()).map((o) => ({
      text: `${o.time} · ${zoneName(o.zone, locale)}`,
      callback_data: `${pre}:tz:${o.zone}`,
    })));
    rows.push([{ text: say(WORD.otherTime, locale), callback_data: `${pre}:tz:__other` }]);
    return rows;
  }

  // salary
  pair(SALARY_STEPS.map((n) => ({ text: `€${n / 1000}k / ${say(WORD.perYear, locale)}`, callback_data: `${pre}:salary:${n}` })));
  rows.push([{ text: say(WORD.noMatter, locale), callback_data: `${pre}:salary:0` }]);
  rows.push([{ text: say(WORD.other, locale), callback_data: `${pre}:salary:__other` }]);
  return rows;
}

/** Рядки-пункти під /profile: кожен відкриває клавіатуру одного питання. */
export function profileMenu(locale: Locale): Button[][] {
  const b = (p: Phrase, step: string): Button => ({ text: say(p, locale), callback_data: `ed:${step}` });
  return [
    [b(WORD.fSpheres, "spheres"), b(WORD.fIndustries, "industries")],
    [b(WORD.fSeniority, "seniority"), b(WORD.fWhere, "where")],
    [b(WORD.fSalary, "salary"), b(WORD.fWishes, "wishes")],
    [b(WORD.fLang, "lang"), b(WORD.fTz, "tz")],
  ];
}

/**
 * Запис ОДНОГО поля з /profile. Повертає частину SET і параметри —
 * назви стовпців тут літеральні, з форми нічого не підставляється.
 * Null для кроків, що живуть не в profiles (година → users.timezone).
 */
export function profileUpdateFor(step: Step, draft: Draft): { set: string; params: unknown[] } | null {
  switch (step) {
    case "spheres":
      return { set: "spheres=?, custom_role=?", params: [JSON.stringify(draft.spheres), draft.customRole ?? null] };
    case "industries":
      return { set: "industries=?, custom_industry=?", params: [JSON.stringify(draft.industries), draft.customIndustry ?? null] };
    case "seniority":
      return { set: "seniority=?, custom_seniority=?", params: [draft.seniority ?? null, draft.customSeniority ?? null] };
    case "where":
    case "city":
      return { set: "remote_mode=?, location=?", params: [draft.remoteMode ?? "remote_only", draft.location ?? null] };
    case "salary":
      return { set: "salary_min=?, salary_currency=?", params: [draft.salaryMin ?? null, draft.salaryCurrency ?? null] };
    case "wishes":
      return { set: "wishes=?", params: [draft.wishes?.trim() || null] };
    default:
      return null;
  }
}

export const questionText = (step: Step, locale: Locale): string => say(ASK[step], locale);
export const askOtherAmount = (locale: Locale): string => say(WORD.askOther, locale);
export const askTime = (locale: Locale): string => say(WORD.askTime, locale);
export const askWishes = (locale: Locale): string => say(WORD.askWishes, locale);
export const askCustomRole = (locale: Locale): string => say(WORD.askMine, locale);
export const askCustomFor = (step: Step, locale: Locale): string => say(
  step === "industries" ? WORD.askIndustry
  : step === "seniority" ? WORD.askLevel
  : step === "where" ? WORD.askWhere : WORD.askMine, locale);

/** Що вийшло — людськими словами, а не ідентифікаторами. */
export function summary(draft: Draft, locale: Locale): string {
  const names = (ids: string[], src: readonly { id: string; en: string; uk: string; fr: string; ru: string }[]): string =>
    ids.map((id) => { const it = src.find((x) => x.id === id); return it ? label(it, locale) : id; }).join(", ") || "—";

  const level = SENIORITY.find((x) => x.id === draft.seniority);
  const where = REMOTE_MODES.find((x) => x.id === draft.remoteMode);
  const money = draft.salaryMin
    ? `${draft.salaryMin.toLocaleString("uk-UA")} ${draft.salaryCurrency ?? "EUR"}`
    : say(WORD.noMatter, locale);

  const both = (ids: string[], src: readonly { id: string; en: string; uk: string; fr: string; ru: string }[],
                own: string | null | undefined): string | null =>
    [ids.length ? names(ids, src) : null, own].filter(Boolean).join(" · ") || null;

  return [
    both(draft.spheres, SPHERES, draft.customRole) ?? "—",
    both(draft.industries, INDUSTRIES, draft.customIndustry),
    draft.customSeniority ?? (level ? label(level, locale) : null),
    draft.customWhere ?? (where ? label(where, locale) : null),
    draft.location ?? null,
    money,
    draft.wishes?.trim() ? `«${draft.wishes.trim()}»` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Що робити з вільним текстом поза командами. Чиста функція, бо саме тут
 * колись жила «реєстрація одним реченням», яка переписувала профіль
 * підключеній людині порожніми сферами.
 *
 *   inFlow      — анкета йде, слово посеред питань нічого не запускає;
 *   hasProfile  — це побажання, профіль лишається як є;
 *   known       — акаунт є, профілю нема: підказка про /start;
 *   інакше      — новачок, ведемо в анкету.
 */
export type FreeTextAction = "useButtons" | "wish" | "hint" | "register";
export function freeTextAction(known: boolean, hasProfile: boolean, inFlow: boolean): FreeTextAction {
  if (inFlow) return "useButtons";
  if (hasProfile) return "wish";
  if (known) return "hint";
  return "register";
}

export const readyText = (locale: Locale): string =>
  `${say(WORD.ready, locale)}\n\n${say(WORD.commands, locale)}`;
