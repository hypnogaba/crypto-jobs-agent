import type { RawJob } from "./types.js";

/**
 * Теги — основа маршрутизації за нішами. Вакансія отримує їх із назви посади
 * і з джерела, а профіль людини вирішує, які брати до уваги. Тому один скан
 * обслуговує і web3-профіль, і фінтех-профіль.
 */

const SPHERE_RULES: Array<[string, RegExp]> = [
  // «platform», «infrastructure» і «mobile» самі по собі звідси прибрані.
  //
  // Вони ловили посаду за словом із назви продукту, а не за фахом: «Staff
  // Product Manager, SaaS platform», «The Ride Platform - Senior Manager,
  // Paid Media», «Head of Marketing (B2C Product / Mobile App)» і навіть
  // «Client Account Executive, T-Mobile» приходили людині, що обрала
  // «Інженерію». У свіжому кеші таких 318. Справжня платформна інженерія
  // слова «engineer» не втрачає («Platform Engineer», «Infrastructure
  // Engineer»), тож збіг лишається, а привід для чужих зникає.
  //
  // «engineering» додано теж: без нього «Engineering Manager - Platform» і
  // «Senior Engineering Manager, Infrastructure» трималися в сфері рівно за
  // те слово, яке звідси прибрано, і разом із чужими посадами втратили б і
  // свою. Слово «engineer» їх не ловить: після нього стоїть «ing».
  ["engineering",  /\b(engineer(?:s|ing)?|developers?|programmers?|swe|backend|frontend|full[- ]?stack|ios|android|devops|sre|sysadmin|architects?)\b/i],
  ["data-ai",      /\b(data scientists?|data engineers?|machine learning|ml engineers?|ai engineers?|analytics engineers?|research scientists?|mlops|nlp)\b/i],
  // Дизайн — окрема сфера: «product» лишається як був, але дизайнер тепер
  // отримує і власний тег, під який людина може підписатися.
  ["design",       /\b(designers?|ux|ui|product design|graphic|figma|brand design|motion)\b/i],
  // Дизайнери звідси прибрані: у них є власна сфера.
  //
  // Правило лишалось із часів, коли «design» кнопкою не існував, і тепер
  // кожен дизайнер вважався продуктовцем. У свіжому кеші 313 рядків із
  // тегом «product» не мають слова «product» у назві взагалі, і це суцільно
  // «Senior Industrial Designer», «Civil Engineer - Experienced Designer»,
  // «Junior Creative Visual Designer». Людина, що обрала «Продукт»,
  // отримувала промислових дизайнерів.
  ["product",      /\b(product managers?|product owners?|product leads?|product design(?:ers?)?)\b/i],
  ["devrel",       /\b(developers? relations|devrel|developers? advocates?|community managers?|community leads?|evangelists?)\b/i],
  ["partnerships", /\b(partnerships?|business development|bd managers?|alliances|ecosystems?)\b/i],
  ["operations",   /\b(operations|program managers?|project managers?|chief of staff|people ops|hr managers?|recruiters?)\b/i],
  ["marketing",    /\b(marketing|growth|content|brand|seo|demand generation|communications)\b/i],
  ["sales",        /\b(sales|account executives?|account managers?|customer success|solutions engineers?)\b/i],
  // «compliance» саме по собі звідси прибрано. Воно ловило «Head of
  // Anti-Financial Crime Compliance» і «Legal & Compliance Ops» — це фінанси
  // й право, а не інформаційна безпека, і людина, що обрала «Безпека»,
  // отримувала їх у пʼятірці. Справжні ролі з безпеки все одно містять саме
  // слово «security» («Security Compliance Analyst») або «grc».
  ["security",     /\b(security|appsec|infosec|penetration|pentest|grc|soc ?2|iso ?27001)\b/i],
  ["qa",           /\b(qa engineers?|quality assurance|test engineers?|sdet)\b/i],
  ["support",      /\b(support|technical support|helpdesk|customer service)\b/i],
  ["finance-legal",/\b(finance|accountant|controller|legal|counsel|compliance officer|tax)\b/i],
];

const INDUSTRY_RULES: Array<[string, RegExp]> = [
  ["web3",      /\b(web3|blockchain|crypto|defi|nft|solana|ethereum|protocol|onchain|on-chain|dao)\b/i],
  ["ai",        /\b(ai|artificial intelligence|machine learning|llm|genai|deep learning)\b/i],
  ["fintech",   /\b(fintech|payments|banking|trading|insurance|lending)\b/i],
  ["health",    /\b(health|medical|clinical|biotech|pharma)\b/i],
  ["games",     /\b(game|gaming|gamedev)\b/i],
  ["ecommerce", /\b(e-?commerce|retail|marketplace)\b/i],
  ["defence",   /\b(defen[cs]e|military|aerospace|dual[- ]use)\b/i],
  ["nonprofit", /\b(non-?profit|ngo|foundation|humanitarian|united nations)\b/i],
];

/**
 * Тегів рівня тут більше немає.
 *
 * Вони жили тільки заради одного правила в scoreJob, і те правило прибрано
 * разом із питанням про рівень. Тримати тег, якого ніхто не читає, — саме
 * та тиха розбіжність, що й породила початкову ваду: `middle` стояв кнопкою
 * на сайті, а в цьому списку його не було ніколи, тож збіг за ним не міг
 * статися в принципі.
 *
 * Старі рядки в кеші свої junior/senior/lead ще носять. Вони нічому не
 * заважають: жоден запит їх не питає, а `onTopicSql` шукає лише сфери, з
 * якими ці слова не збігаються. Зникнуть вони на першому ж скані —
 * `upsertJobs` перезаписує теги цілком. `retag` тут не поможе: він лише
 * додає нові теги й ніколи не знімає наявних.
 */

/** Джерело саме по собі несе інформацію про нішу. */
const SOURCE_TAGS: Array<[string, string[]]> = [
  // «getro:» тут більше немає. Getro — це хостинг бордів, а не ніша: серед
  // його колекцій є і Solana, і ізраїльська дошка з Teva. Тепер нішу диктує
  // конкретна колекція через inheritedTags (див. runR3).
  ["aggregator:remoteok", ["remote"]],
  ["aggregator:remotive", ["remote"]],
  ["aggregator:wwr", ["remote"]],
  ["aggregator:workingnomads", ["remote"]],
  ["aggregator:jobicy", ["remote"]],
  ["aggregator:himalayas", ["remote"]],
  ["aggregator:landingjobs", ["europe"]],
  ["aggregator:arbeitnow", ["europe"]],
  ["personio:", ["europe"]],
];

export function deriveTags(job: RawJob): string[] {
  const tags = new Set<string>(job.inheritedTags ?? []);
  const title = job.title ?? "";

  for (const [tag, rx] of SPHERE_RULES) if (rx.test(title)) tags.add(tag);
  for (const [tag, rx] of INDUSTRY_RULES) if (rx.test(`${title} ${job.company}`)) tags.add(tag);
  for (const [prefix, extra] of SOURCE_TAGS) {
    if (job.source.startsWith(prefix)) extra.forEach((t) => tags.add(t));
  }
  if (job.remote) tags.add("remote");
  if (tags.size === 0) tags.add("other");
  return [...tags];
}

/**
 * Ніша компанії, яку ми ВЖЕ знаємо, доходить до її вакансії.
 *
 * Виміряно 02.09: у каталозі 312 компаній із тегом `web3`, і 173 свіжих
 * вакансій цих самих компаній лежали в кеші без нього. Причина не в тому, що
 * успадкування не написане — у R1 і в дошках воно є, — а в тому, що ОСТАННІЙ
 * запис перемагає: `upsertJobs` ставить `tags=excluded.tags`, тож вакансія
 * Binance, знайдена спершу через `lever:binance` з тегом ніші, а потім того
 * самого дня через колекцію Getro без тегів, лишалась без ніші.
 *
 * Тому ніша компанії додається В ОДНОМУ місці — перед самим записом, — а не
 * в кожній сходинці драбини окремо. Чотири виклики `upsertJobs` означали б
 * чотири нагоди забути про п'ятий.
 *
 * Беремо лише галузеві теги. Сфера («engineering», «sales») — це про посаду,
 * і компанія про неї нічого не знає: у Binance є і бекендери, і юристи.
 */
const INDUSTRY_TAGS = new Set(INDUSTRY_RULES.map(([tag]) => tag));

export function withCompanyTags(tags: string[], companyTags: string[]): string[] {
  const extra = companyTags.filter((t) => INDUSTRY_TAGS.has(t) && !tags.includes(t));
  if (extra.length === 0) return tags;
  // «other» означає «не знаємо нічого». Щойно дізнались — воно зайве.
  const kept = tags.filter((t) => t !== "other");
  return [...kept, ...extra];
}
