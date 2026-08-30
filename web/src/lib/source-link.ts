/**
 * Посилання → джерело.
 *
 * Досі, щоб додати джерело, треба було знати, ЯКОГО ВОНО РОДУ: компанія на
 * ATS ішла у форму «слаг + провайдер», національна дошка — у форму «країна +
 * назва + RSS», а глобальна стрічка не йшла нікуди, крім правки коду сканера
 * й деплою. Три різні форми на одне й те саме питання «читай ще й звідси».
 *
 * Тут рід визначається з самої адреси. Людина вставляє те, що бачила в
 * браузері, — сторінку вакансій компанії, стрічку дошки, будь-що, — а розбір
 * лишається на нас.
 *
 * Модуль навмисно чистий: жодних запитів, лише розбір рядка. Мережа —
 * в `probe*` нижче, і вона повертає числа, а не рішення.
 */

/**
 * Скільки посилань беремо за один раз.
 *
 * Кожне коштує один-два зовнішні запити, а Worker має ліміт підзапитів на
 * одне виконання. Десять напевно доїде до кінця; решта лишається в полі, і
 * власник тисне ще раз. Мовчки з'їсти більше було б гірше за будь-яку межу:
 * людина думала б, що додала двадцять.
 *
 * Число живе тут, а не в actions.ts: файл із "use server" не може віддавати
 * назовні нічого, крім асинхронних функцій, — а сторінці воно потрібне, щоб
 * сказати про межу вголос.
 */
export const INTAKE_LIMIT = 10;

/** Провайдери, яких уміє читати сканер (scanner/src/sources/ats.ts). */
export type Provider =
  | "greenhouse" | "lever" | "ashby" | "workable"
  | "smartrecruiters" | "breezy" | "personio" | "rippling" | "bamboohr";

/**
 * Ті самі взірці, що в `scanner/src/sources/getro.ts`.
 *
 * Дублювання свідоме: сканер — окремий процес на сервері, у веб він не
 * імпортується взагалі (різні tsconfig, різні збірки). Спільним тут є не код,
 * а факт: адреса вакансії на Greenhouse виглядає рівно так. Якщо взірець
 * колись зміниться, зміняться обидва місця — і тест нижче на це вкаже.
 */
const ATS: Array<[Provider, RegExp]> = [
  ["greenhouse", /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i],
  ["lever", /jobs\.lever\.co\/([a-z0-9_-]+)/i],
  ["ashby", /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i],
  ["workable", /apply\.workable\.com\/([a-z0-9_-]+)/i],
  ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/i],
  ["breezy", /([a-z0-9_-]+)\.breezy\.hr/i],
  ["rippling", /ats\.rippling\.com\/([a-z0-9_-]+)/i],
  ["personio", /([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)/i],
  ["bamboohr", /([a-z0-9_-]+)\.bamboohr\.com\/careers/i],
];

/**
 * Хвости, які не є слагом компанії.
 *
 * `boards.greenhouse.io/embed/job_board?for=deepl` — теж Greenhouse, але
 * перша група взірця тут упіймає «embed». Компанія «embed» опитувалась би
 * щодня й ніколи нічого не давала: рівно так у нас і з'явилась половина
 * мертвих джерел.
 */
const NOT_A_SLUG = new Set(["embed", "api", "v1", "jobs", "job", "careers", "www", "search"]);

/**
 * Стрічка чи ні — за адресою.
 *
 * Не вирок: остаточно вирішує вміст (`probeFeed`). Але дошка на кшталт DOU
 * віддає HTML за тією ж адресою без `/feed`, тож розрізняти варто до запиту.
 */
// «feeds» у множині — це шлях DOU, і без `s?` вона читалась як звичайна сторінка.
const FEEDISH = /\.(?:xml|rss|atom)(?:$|\?)|\/(?:feeds?|rss|atom)\b|[?&]feed=/i;

/**
 * Країна з домену верхнього рівня.
 *
 * Тільки ccTLD і тільки однозначні. `.io`, `.co`, `.me`, `.tv` формально теж
 * країни, але ними користується весь світ — вакансія з `remoteok.com` не
 * «британська» від того, що домен колись видала Британська територія в
 * Індійському океані. Здогад тут коштує дорого: країна в вакансії означає
 * «показувати ЛИШЕ людям звідти», тож помилковий здогад ховає вакансію від
 * усіх, а порожня країна — лише показує її всім.
 */
const CC: Record<string, string> = {
  ua: "UA", pl: "PL", fr: "FR", de: "DE", es: "ES", it: "IT", pt: "PT",
  nl: "NL", be: "BE", ch: "CH", at: "AT", cz: "CZ", sk: "SK", hu: "HU",
  ro: "RO", bg: "BG", gr: "GR", se: "SE", no: "NO", fi: "FI", dk: "DK",
  ee: "EE", lv: "LV", lt: "LT", ie: "IE", is: "IS", hr: "HR", si: "SI",
  rs: "RS", tr: "TR", il: "IL", ae: "AE", ca: "CA", br: "BR", mx: "MX",
  ar: "AR", au: "AU", nz: "NZ", jp: "JP", kr: "KR", sg: "SG", in: "IN",
  za: "ZA", ge: "GE", md: "MD", kz: "KZ",
};

/** Дошки, чия країна не читається з домену, але відома. */
const KNOWN_COUNTRY: Record<string, string> = {
  "djinni.co": "UA",
  "justjoin.it": "PL",
  "nofluffjobs.com": "PL",
  "welcometothejungle.com": "FR",
  "apec.fr": "FR",
};

export interface Guess {
  /** ats — компанія на ATS; feed — стрічка; page — звичайна сторінка. */
  kind: "ats" | "feed" | "page";
  provider?: Provider;
  slug?: string;
  /** ISO-3166 alpha-2, або «*» — глобальне джерело без прив'язки до країни. */
  country: string;
  host: string;
  url: string;
}

/** Нормалізує вставлене: люди копіюють із пробілами, лапками й без схеми. */
export function tidy(raw: string): string | null {
  const t = raw.trim().replace(/^[<"'(]+|[>"'),.]+$/g, "");
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function countryOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "*";
  }
  const known = Object.entries(KNOWN_COUNTRY).find(([d]) => host === d || host.endsWith(`.${d}`));
  if (known) return known[1];
  const tld = host.split(".").pop() ?? "";
  return CC[tld] ?? "*";
}

/** Що це за посилання. Мережі не торкається. */
export function classify(url: string): Guess | null {
  const clean = tidy(url);
  if (!clean) return null;
  const host = new URL(clean).hostname.toLowerCase().replace(/^www\./, "");
  const country = countryOf(clean);

  for (const [provider, rx] of ATS) {
    const slug = rx.exec(clean)?.[1]?.toLowerCase();
    // ATS — це завжди глобальна компанія, навіть якщо домен національний:
    // вакансія в Greenhouse адресована всім, хто на неї підійде.
    if (slug && !NOT_A_SLUG.has(slug)) return { kind: "ats", provider, slug, country: "*", host, url: clean };
  }

  if (FEEDISH.test(clean)) return { kind: "feed", country, host, url: clean };
  return { kind: "page", country, host, url: clean };
}

/** Адреса відкритого API провайдера — те саме, що читає сканер. */
export function atsApi(provider: Provider, slug: string): string {
  switch (provider) {
    case "greenhouse":      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`;
    case "lever":           return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby":           return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    case "workable":        return `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
    case "smartrecruiters": return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`;
    case "breezy":          return `https://${slug}.breezy.hr/json`;
    case "rippling":        return `https://api.rippling.com/platform/api/ats/v1/board/${slug}/jobs`;
    case "personio":        return `https://${slug}.jobs.personio.de/xml`;
    case "bamboohr":        return `https://${slug}.bamboohr.com/careers/list`;
  }
}

/**
 * Скільки вакансій у відповіді. Рахуємо грубо, без повного розбору.
 *
 * Точна кількість тут не потрібна: питання одне — «щось є чи порожньо». Повний
 * розбір означав би десять різних форматів у вебі поруч із тими самими
 * десятьма в сканері, і рано чи пізно вони б розійшлись.
 */
export function countJobs(body: string): number {
  // Скісна риска в класі обов'язкова: порожній `<item/>` інакше не рахується.
  const rss = (body.match(/<(?:item|entry|position)[\s>/]/gi) ?? []).length;
  if (rss > 0) return rss;
  try {
    const j: unknown = JSON.parse(body);
    if (Array.isArray(j)) return j.length;
    if (j && typeof j === "object") {
      for (const key of ["jobs", "content", "data", "results", "positions", "postings"]) {
        const v = (j as Record<string, unknown>)[key];
        if (Array.isArray(v)) return v.length;
      }
    }
  } catch {
    // не JSON — значить, і не список вакансій у JSON
  }
  return 0;
}

/**
 * Стрічка, схована в HTML сторінки.
 *
 * Людина вставляє те, що бачила в браузері: `https://jobs.dou.ua/`, а не
 * `https://jobs.dou.ua/vacancies/feeds/`. Спершу питаємо тег, для якого це й
 * придумано, — `<link rel="alternate">`.
 *
 * Якщо тега немає — дивимось на звичайні посилання. Це не здогад: на живій
 * сторінці DOU, нашої найбільшої дошки, оголошеного тега НЕМАЄ взагалі, а
 * стрічка стоїть у футері звичайним `<a href>`. Правило «тільки тег» ламалось
 * би саме там, де воно найпотрібніше, — і жодного зайвого запиту цей другий
 * прохід не коштує, бо сторінку ми вже завантажили.
 */
export function feedInPage(html: string, base: string): string | null {
  const absolute = (href: string): string | null => {
    try { return new URL(href, base).toString(); } catch { return null; }
  };

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    // Лапки в HTML необов'язкові, і cryptocurrencyjobs.co ними не користується:
    // `<link rel=alternate href=/index.xml ...>`. Вимога лапок ховала від нас
    // стрічку, яку ми й так читаємо в сканері.
    const href = /href=(?:["']([^"']+)["']|([^\s"'>]+))/i.exec(tag);
    const url = href ? absolute(href[1] ?? href[2]!) : null;
    if (url) return url;
  }

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1]!;
    if (!FEEDISH.test(href)) continue;
    const url = absolute(href);
    // Чужа стрічка з чужого домену — не наша дошка.
    if (url && new URL(url).hostname === new URL(base).hostname) return url;
  }
  return null;
}

/**
 * УСІ компанії на ATS, згадані в сторінці.
 *
 * Раніше бралася перша-ліпша, і це виявилось помилкою на живому прикладі:
 * `cryptojobslist.com` — агрегатор, у його оголошеннях сотні чужих компаній,
 * і ми мовчки підписались на випадкову з них («re7-capital»), ніби це і є
 * вставлений сайт.
 *
 * Насправді кількість і є відповіддю на питання, що це за сторінка. Одна
 * компанія — це її власний «Careers». Кілька — це дошка, і тоді потрібні всі:
 * саме так влаштовані борди Getro (jobs.solana.com, jobs.avax.network), де
 * 80% посилань ведуть просто в ATS роботодавця. Для них «додати сайт»
 * означає «забрати собі його компанії».
 */
export function atsListInPage(html: string): Array<{ provider: Provider; slug: string }> {
  const out = new Map<string, Provider>();
  for (const [provider, rx] of ATS) {
    // Взірці вище без прапорця `g` — для пошуку всіх збігів потрібна копія.
    for (const m of html.matchAll(new RegExp(rx.source, "gi"))) {
      const slug = m[1]?.toLowerCase();
      if (slug && !NOT_A_SLUG.has(slug) && !out.has(slug)) out.set(slug, provider);
    }
  }
  return [...out].map(([slug, provider]) => ({ provider, slug }));
}

/**
 * Мітка дошки — з домену, а не з назви стрічки.
 *
 * Назву стрічки ми пробували першою й відмовились, побачивши живу: DOU
 * називає свою «Вакансії в категорії Python на DOU.ua». У колонці таблиці це
 * речення, а не мітка, і воно ламає групування — адмінка вважає дошкою те,
 * що стоїть до « · », тож кожна рубрика ставала б окремою «дошкою».
 *
 * Домен же однаковий у всіх рубрик однієї дошки, і саме це нам потрібно.
 */
function brandOf(host: string): string {
  const core = host
    .replace(/^(?:www|jobs|job|careers|api|feeds?)\./, "")
    .replace(/\.[a-z.]{2,6}$/i, "");
  const word = core.split(".").pop() ?? core;
  // Короткі — це абревіатури: DOU, WWR. Довгі — слова, і капсом вони кричать.
  return word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1);
}

/** Рубрика всередині дошки — вона стоїть у запиті: `?category=Python`. */
function rubricOf(url: string): string | null {
  let q: URLSearchParams;
  try { q = new URL(url).searchParams; } catch { return null; }
  for (const key of ["category", "cat", "tag", "topic", "specialization", "q"]) {
    const v = q.get(key)?.trim();
    // Одне слово, не речення й не число сторінки.
    if (v && v.length <= 24 && /^[\p{L}\d][\p{L}\d +.#-]*$/u.test(v) && !/^\d+$/.test(v)) {
      return v.charAt(0).toUpperCase() + v.slice(1);
    }
  }
  return null;
}

/**
 * Мітка дошки: «DOU · Python». Та сама форма, що вже лежить у базі, тож нові
 * рубрики стають до наявної дошки, а не поруч із нею.
 */
export function labelOf(feedUrl: string, host: string): string {
  const rubric = rubricOf(feedUrl);
  return rubric ? `${brandOf(host)} · ${rubric}` : brandOf(host);
}

/** Ім'я рядка дошки. Мусить збігатися з тим, що пише сканер у jobs_cache.source. */
export function boardName(country: string, label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const cc = country === "*" ? "global" : country.toLowerCase();
  return `board:${cc}-${slug || "feed"}`;
}
