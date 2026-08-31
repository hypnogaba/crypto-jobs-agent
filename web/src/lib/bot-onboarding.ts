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
  SPHERES, INDUSTRIES, REMOTE_MODES, label, needsCity, parseModes,
  serializeModes, type Locale,
} from "./vocab";
import { timezoneFromCity, timeOptions, zoneName } from "./tz";
import { monthlyFrom } from "./salary-period";
import { timezoneFor } from "./geo";

export type Step = "spheres" | "wishes" | "industries" | "where" | "city" | "tz" | "salary";

/**
 * Порядок питань. «Побажання» одразу після сфер: людина щойно побачила
 * кнопки й знає, чого в них немає. «Година» після міста: якщо місто вже
 * назвало пояс, питання не ставиться.
 */
export const STEPS: Step[] = ["spheres", "wishes", "industries", "where", "city", "tz", "salary"];

/** Поля, які людина редагує по одному через /profile. Мова й година живуть у users, не в profiles. */
export const EDITABLE: Step[] = ["spheres", "industries", "where", "salary", "wishes", "tz"];

export interface Draft {
  spheres: string[];
  /** Своя назва ролі, коли жодна сфера не підійшла. */
  customRole?: string | null;
  /** Своя індустрія і своя локація — те саме для решти питань. */
  customIndustry?: string | null;
  customWhere?: string | null;
  industries: string[];
  /** Набір варіантів через кому: «офіс у місті» і «переїзд» сумісні. */
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
  customWhere: null,
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
  !needsCity(parseModes(draft.remoteMode)) || Boolean(draft.location?.trim());

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
    en: "1 of 3 · What kind of work?\nPick everything that fits.",
    uk: "1 з 3 · Яка робота?\nОбери все, що підходить.",
    fr: "1 sur 3 · Quel type de poste ?\nChoisissez tout ce qui convient.",
    ru: "1 из 3 · Какая работа?\nВыбери всё, что подходит.",
  },
  industries: {
    en: "2 of 3 · Any industry you care about?\nOptional — skip if it does not matter.",
    uk: "2 з 3 · Якісь індустрії цікавлять?\nНеобов'язково — пропусти, якщо байдуже.",
    fr: "2 sur 3 · Un secteur en particulier ?\nFacultatif — passez si peu importe.",
    ru: "2 из 3 · Какие-то индустрии интересуют?\nНеобязательно — пропусти, если всё равно.",
  },
  where: {
    en: "3 of 3 · Where do you want to work?",
    uk: "3 з 3 · Де хочеш працювати?",
    fr: "3 sur 3 · Où voulez-vous travailler ?",
    ru: "3 из 3 · Где хочешь работать?",
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
    en: "Last one · Salary floor, per month, before tax?\nA soft preference, not a hard filter — most postings show no range at all.",
    uk: "Останнє · Зарплата від, на місяць, до податків?\nМ'який пріоритет, не жорсткий фільтр — більшість вакансій вилку взагалі не вказує.",
    fr: "Dernière · Salaire minimum, par mois, avant impôts ?\nUne préférence, pas un filtre — la plupart des offres n'affichent aucune fourchette.",
    ru: "Последнее · Зарплата от, в месяц, до налогов?\nМягкий приоритет, не жёсткий фильтр — большинство вакансий вилку не указывает.",
  },
};

const WORD = {
  done:     { en: "Done", uk: "Готово", fr: "Terminé", ru: "Готово" },
  back:     { en: "\u2190 Back", uk: "\u2190 Назад", fr: "\u2190 Retour", ru: "\u2190 Назад" },
  skip:     { en: "Skip", uk: "Пропустити", fr: "Passer", ru: "Пропустить" },
  pickOne:  { en: "Pick at least one", uk: "Обери хоча б одне", fr: "Choisissez au moins un", ru: "Выбери хотя бы одно" },
  noMatter: { en: "Does not matter", uk: "Не важливо", fr: "Peu importe", ru: "Не важно" },
  other:    { en: "Another amount", uk: "Інша сума", fr: "Autre montant", ru: "Другая сумма" },
  perMonth: { en: "mo", uk: "міс", fr: "mois", ru: "мес" },
  askOther: {
    en: "Write the monthly amount and currency, for example: 3000 EUR",
    uk: "Напиши місячну суму й валюту, наприклад: 3000 EUR",
    fr: "Écrivez le montant mensuel et la devise, par exemple : 3000 EUR",
    ru: "Напиши месячную сумму и валюту, например: 3000 EUR",
  },
  otherTime: { en: "Another time", uk: "Інша", fr: "Autre", ru: "Другое" },
  askTime: {
    en: "Write your current time as HH:MM, for example 14:30",
    uk: "Напиши свій поточний час як ГГ:ХХ, наприклад 14:30",
    fr: "Écrivez votre heure actuelle au format HH:MM, par exemple 14:30",
    ru: "Напиши своё текущее время как ЧЧ:ММ, например 14:30",
  },
  askWishes: {
    en: "Write what matters — one message. Your level too, if it matters: senior or above, first job, head of.",
    uk: "Напиши, що важливо, — одним повідомленням. Рівень теж, якщо він важливий: senior і вище, перша робота, керівник напряму.",
    fr: "Écrivez ce qui compte — en un message. Votre niveau aussi, si besoin : senior ou plus, premier emploi, responsable.",
    ru: "Напиши, что важно, — одним сообщением. Уровень тоже, если он важен: senior и выше, первая работа, руководитель направления.",
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
  // Три кроки з датою: планова добірка йде лише в робочі дні, а перша —
  // тільки на прохання (кнопка «Прислати 5 зараз»), не автоматично.
  ready: {
    en: "You are set.\n\n\u2713 Profile saved\n\u25cb Batches come on weekdays at {h} ({tz})\n\u25cf Next one: {when}\n\nWant to see how it looks right now?",
    uk: "Готово.\n\n\u2713 Профіль збережено\n\u25cb Добірки приходять у робочі дні о {h} ({tz})\n\u25cf Найближча: {when}\n\nХочеш побачити, як це виглядає, вже зараз?",
    fr: "C'est prêt.\n\n\u2713 Profil enregistré\n\u25cb Les sélections arrivent en semaine à {h} ({tz})\n\u25cf Prochaine : {when}\n\nVoir à quoi ça ressemble dès maintenant ?",
    ru: "Готово.\n\n\u2713 Профиль сохранён\n\u25cb Подборки приходят в рабочие дни в {h} ({tz})\n\u25cf Ближайшая: {when}\n\nХочешь увидеть, как это выглядит, прямо сейчас?",
  },
  commands: {
    en: "/profile — your profile, edit any field\n/time — delivery hour\n/lang — language\n/pause and /resume\n/site — sign in on the web\n/news — channel @nextroleinfo",
    uk: "/profile — твій профіль, правка по пунктах\n/time — година доставки\n/lang — мова\n/pause і /resume — пауза\n/site — вхід на сайт\n/news — канал @nextroleinfo",
    fr: "/profile — votre profil, champ par champ\n/time — heure d'envoi\n/lang — langue\n/pause et /resume\n/site — accès au site\n/news — canal @nextroleinfo",
    ru: "/profile — твой профиль, правка по пунктам\n/time — час доставки\n/lang — язык\n/pause и /resume — пауза\n/site — вход на сайт\n/news — канал @nextroleinfo",
  },
  // Підписи рядків у /profile — що саме редагувати.
  fSpheres:    { en: "Fields",     uk: "Сфери",      fr: "Domaines",  ru: "Сферы" },
  fIndustries: { en: "Industries", uk: "Індустрії",  fr: "Secteurs",  ru: "Индустрии" },
  fWhere:      { en: "Place",      uk: "Місце",      fr: "Lieu",      ru: "Место" },
  fSalary:     { en: "Salary",     uk: "Зарплата",   fr: "Salaire",   ru: "Зарплата" },
  fWishes:     { en: "Wishes",     uk: "Побажання",  fr: "Souhaits",  ru: "Пожелания" },
  fLang:       { en: "Language",   uk: "Мова",       fr: "Langue",    ru: "Язык" },
  fTz:         { en: "Hour",       uk: "Година",     fr: "Heure",     ru: "Час" },
} satisfies Record<string, Phrase>;

const say = (p: Phrase, locale: Locale): string => p[locale] ?? p.en;

/**
 * Звичайні суми в євро НА МІСЯЦЬ. Хто хоче іншу — напише сам.
 *
 * Місячні, а не річні, бо так само підписане поле на сайті, і так думають
 * і в Європі, і в Україні. У чернетці й у базі лежить річна: перехід робить
 * yearlyFrom() у обробнику кнопки, а не цей список.
 */
const SALARY_STEPS = [2_000, 3_000, 4_000, 6_000, 8_000];

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
  // Побажання — вільний текст: жодного списку тут бути не може, а єдина
  // кнопка дозволяє не відповідати.
  if (step === "wishes") {
    return [[{ text: say(WORD.skip, locale), callback_data: `${pre}:wishes:__next` }]];
  }

  // Місто теж вільний текст, але «Пропустити» тут немає: питання ставиться
  // лише тому, хто сам обрав офіс у своєму місті чи переїзд. Пропущене місто
  // означало б профіль без країни — тобто без жодної національної дошки, і
  // людина ніколи б не дізналась, чому їй приходить сама лише глобальна стрічка.
  if (step === "city") return [];

  // Кілька відповідей: офіс у своєму місті й готовність переїхати одне одного
  // не виключають. Виключне тільки «тільки віддалено» — див. toggleMode.
  if (step === "where") {
    const chosen = parseModes(draft.remoteMode);
    for (const it of REMOTE_MODES) {
      rows.push([{
        text: `${chosen.includes(it.id) ? "✓ " : ""}${label(it, locale)}`,
        callback_data: `${pre}:where:${it.id}`,
      }]);
    }
    rows.push([{
      text: `${draft.customWhere ? "✓ " : ""}${say(WORD.mine, locale)}`,
      callback_data: `${pre}:where:__mine`,
    }]);
    const canFinish = chosen.length > 0 || Boolean(draft.customWhere);
    rows.push([{
      text: say(canFinish ? WORD.done : WORD.pickOne, locale),
      callback_data: canFinish ? `${pre}:where:__next` : `${pre}:noop:0`,
    }]);
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
  pair(SALARY_STEPS.map((n) => ({ text: `€${n / 1000}k / ${say(WORD.perMonth, locale)}`, callback_data: `${pre}:salary:${n}` })));
  rows.push([{ text: say(WORD.noMatter, locale), callback_data: `${pre}:salary:0` }]);
  rows.push([{ text: say(WORD.other, locale), callback_data: `${pre}:salary:__other` }]);
  return rows;
}

/**
 * «Назад» під питанням правки. Одна кнопка на всі поля: повертає те саме
 * повідомлення в меню, не питаючи нічого й нічого не записуючи.
 */
export const backButton = (locale: Locale): Button => ({
  text: say(WORD.back, locale), callback_data: "ed:back",
});

/** Рядки-пункти під /profile: кожен відкриває клавіатуру одного питання. */
/**
 * Підпис поля людськими словами — для підтвердження «що саме я записав».
 *
 * Ті самі назви, що на кнопках меню правки: людина щойно їх бачила, і
 * вигадувати для підтвердження другий словник означало б змусити її
 * здогадуватись, що «роль» і «Сфери» — те саме місце.
 */
export function fieldLabel(step: Step | "role" | "industry", locale: Locale): string {
  const map: Record<string, Phrase> = {
    spheres: WORD.fSpheres, industries: WORD.fIndustries, where: WORD.fWhere,
    city: WORD.fWhere, salary: WORD.fSalary, wishes: WORD.fWishes, tz: WORD.fTz,
    role: { en: "Your role", uk: "Своя роль", fr: "Votre rôle", ru: "Своя роль" },
    industry: { en: "Your industry", uk: "Своя галузь", fr: "Votre secteur", ru: "Своя отрасль" },
  };
  return say(map[step] ?? WORD.fSpheres, locale);
}

export function profileMenu(locale: Locale): Button[][] {
  const b = (p: Phrase, step: string): Button => ({ text: say(p, locale), callback_data: `ed:${step}` });
  return [
    [b(WORD.fSpheres, "spheres"), b(WORD.fIndustries, "industries")],
    [b(WORD.fWhere, "where"), b(WORD.fSalary, "salary")],
    [b(WORD.fWishes, "wishes")],
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
    case "where":
    case "city":
      return { set: "remote_mode=?, location=?",
        params: [serializeModes(parseModes(draft.remoteMode)) || "remote_only", draft.location ?? null] };
    case "salary":
      return { set: "salary_min=?, salary_currency=?", params: [draft.salaryMin ?? null, draft.salaryCurrency ?? null] };
    case "wishes":
      return { set: "wishes=?", params: [draft.wishes?.trim() || null] };
    default:
      return null;
  }
}

/**
 * Текст питання. `bare` знімає лічильник «1 з 4»: в анкеті він показує шлях,
 * а в правці одного поля просто бреше — кроків там рівно один.
 */
export const questionText = (step: Step, locale: Locale, opts: { bare?: boolean } = {}): string => {
  const text = say(ASK[step], locale);
  return opts.bare ? text.replace(/^[^\n\u00b7]{1,24}\u00b7\s*/, "") : text;
};
export const askOtherAmount = (locale: Locale): string => say(WORD.askOther, locale);
export const askTime = (locale: Locale): string => say(WORD.askTime, locale);
export const askWishes = (locale: Locale): string => say(WORD.askWishes, locale);
export const askCustomRole = (locale: Locale): string => say(WORD.askMine, locale);
export const askCustomFor = (step: Step, locale: Locale): string => say(
  step === "industries" ? WORD.askIndustry
  : step === "where" ? WORD.askWhere : WORD.askMine, locale);

/** Що вийшло — людськими словами, а не ідентифікаторами. */
export function summary(draft: Draft, locale: Locale): string {
  const names = (ids: string[], src: readonly { id: string; en: string; uk: string; fr: string; ru: string }[]): string =>
    ids.map((id) => { const it = src.find((x) => x.id === id); return it ? label(it, locale) : id; }).join(", ") || "—";

  const where = parseModes(draft.remoteMode)
    .map((id) => REMOTE_MODES.find((x) => x.id === id))
    .filter(Boolean)
    .map((x) => label(x!, locale)).join(" + ") || null;
  // Місячна, бо саме її ми й питали. У чернетці лежить річна — одна одиниця
  // виміру на всю систему, — тож показувати її як є означало б відповісти
  // людині вдванадцятеро більшим числом, ніж вона щойно назвала.
  const monthly = monthlyFrom(draft.salaryMin);
  const money = monthly
    ? `${monthly.toLocaleString("uk-UA")} ${draft.salaryCurrency ?? "EUR"} / ${say(WORD.perMonth, locale)}`
    : say(WORD.noMatter, locale);

  const both = (ids: string[], src: readonly { id: string; en: string; uk: string; fr: string; ru: string }[],
                own: string | null | undefined): string | null =>
    [ids.length ? names(ids, src) : null, own].filter(Boolean).join(" · ") || null;

  return [
    both(draft.spheres, SPHERES, draft.customRole) ?? "—",
    both(draft.industries, INDUSTRIES, draft.customIndustry),
    draft.customWhere ?? where,
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

export const readyText = (locale: Locale, v: { h: string; tz: string; when: string }): string =>
  `${say(WORD.ready, locale).replace("{h}", v.h).replace("{tz}", v.tz).replace("{when}", v.when)}\n\n${say(WORD.commands, locale)}`;
