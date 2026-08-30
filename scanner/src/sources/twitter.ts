/**
 * Твіттер як джерело ДЖЕРЕЛ.
 *
 * Ми не беремо звідси вакансії — їх там мало й вони брудні. Ми питаємо
 * інше: куди люди ставлять посилання, коли наймають. Відповідь — список
 * доменів, серед яких трапляються дошки, про які ми не знали.
 *
 * Два різні шляхи, бо знаходять вони різне:
 *
 *   hashtag  — справжні оголошення (#hiring, #jobs). Дають посилання на
 *              дошку, де вакансія лежить. Це сильніший сигнал: він показує,
 *              ЧИМ КОРИСТУЮТЬСЯ, а не що радять.
 *   keywords — треди-поради («best job boards 2026»). Дають назви дошок
 *              текстом, часто взагалі без посилання.
 *
 * Дві пастки, обидві коштували б мовчазної поразки — перевірено руками
 * 2026-08-30, обидві спрацювали з першого прогону:
 *
 * 1. Порожня відповідь означає ЛІМІТ ЧАСТОТИ, а не «нічого не знайшлось».
 *    Той самий запит через кілька секунд віддає 50 рядків. Перший прогін
 *    дав «нуль» на 47 запитах із 59, і всі 47 були брехнею.
 *
 * 2. `t.co` віддає чесний 301 лише НЕ-браузерному клієнту. Браузерному він
 *    показує сторінку з `location.replace()` усередині — тобто редіректу на
 *    рівні HTTP немає, і всі 1 040 «розгорнутих» посилань вийшли `t.co`.
 */
import { fetchJson, mapLimit, type FetchOptions } from "../http.js";

const API = "https://ai.6551.io/open/twitter_search";

export interface Tweet {
  id: string;
  text: string;
  userScreenName: string;
}

interface SearchResponse {
  data?: Array<{ id?: string; text?: string; userScreenName?: string }>;
}

/**
 * Хештеги живих оголошень. Саме вони дають посилання на дошки.
 * Перелік навмисно широкий по сферах: вузька дошка (дизайн, безпека) не
 * трапиться в загальному `#hiring` — вона живе у своєму хештезі.
 */
export const HASHTAGS = [
  "hiring", "jobs", "remotejobs", "techjobs", "jobsearch", "hiringnow",
  "web3jobs", "cryptojobs", "devjobs", "remotework", "jobopening",
  "nowhiring", "vacancy", "developerjobs", "datajobs", "designjobs",
  "productjobs", "cybersecurityjobs", "marketingjobs", "salesjobs",
  "startupjobs",
];

/**
 * Запити словами. Фразовий пошук у лапках віддає нуль — не підтримується,
 * тож запит це набір слів. Довший набір помітно точніший: «job board crypto
 * web3 hiring» дав 16 доречних із 19, а «crypto job board» — 5 із 20.
 */
export const KEYWORD_QUERIES = [
  "best job boards developers remote",
  "niche job boards tech list underrated",
  "where to find remote jobs sites",
  "job board crypto web3 hiring",
  "AI machine learning jobs board hiring",
  "design jobs board hiring portfolio",
  "cybersecurity infosec jobs board hiring",
  "europe tech jobs board hiring english",
  "asia latam africa remote jobs board hiring",
  "startup jobs board hiring engineers",
];

/**
 * Код країни → як її називають у твітах.
 *
 * Потрібно рівно для одного: скласти запит «job board Belgium hiring» під
 * країну, де в нас уже є люди й немає дошки. Тому список короткий і містить
 * англійську назву плюс місцеву там, де нею справді пишуть вакансії:
 * бельгійська дошка називає себе «vacatures», а не «job board».
 */
const COUNTRY_WORDS: Record<string, string[]> = {
  BE: ["Belgium", "vacatures Belgie", "emploi Belgique"],
  AT: ["Austria", "Stellenangebote Österreich"],
  CH: ["Switzerland", "Stellen Schweiz"],
  SE: ["Sweden", "jobb Sverige"], NO: ["Norway", "jobb Norge"],
  DK: ["Denmark", "job Danmark"], FI: ["Finland", "työpaikat"],
  EE: ["Estonia", "töö Eesti"], LV: ["Latvia", "darbs Latvija"],
  LT: ["Lithuania", "darbo skelbimai"],
  HU: ["Hungary", "allas Magyarorszag"], SK: ["Slovakia", "praca Slovensko"],
  SI: ["Slovenia"], HR: ["Croatia", "posao Hrvatska"], RS: ["Serbia", "poslovi Srbija"],
  BG: ["Bulgaria", "raboti Bulgaria"], GR: ["Greece"], TR: ["Turkey", "is ilanlari"],
  CY: ["Cyprus"], MT: ["Malta"], LU: ["Luxembourg"], IS: ["Iceland"],
  MD: ["Moldova"], GE: ["Georgia Tbilisi"], AM: ["Armenia"], AZ: ["Azerbaijan"],
  KZ: ["Kazakhstan"], IL: ["Israel", "drushim"], AE: ["UAE Dubai"],
  SA: ["Saudi Arabia"], QA: ["Qatar"], EG: ["Egypt"],
  ZA: ["South Africa"], NG: ["Nigeria"], KE: ["Kenya"], GH: ["Ghana"], MA: ["Morocco"],
  IN: ["India"], PK: ["Pakistan"], BD: ["Bangladesh"], SG: ["Singapore"],
  MY: ["Malaysia"], ID: ["Indonesia"], TH: ["Thailand"], VN: ["Vietnam"],
  PH: ["Philippines"], JP: ["Japan"], KR: ["South Korea"], CN: ["China"],
  HK: ["Hong Kong"], TW: ["Taiwan"], AU: ["Australia"], NZ: ["New Zealand"],
  CA: ["Canada"], US: ["United States"], MX: ["Mexico", "empleos Mexico"],
  BR: ["Brazil", "vagas Brasil"], AR: ["Argentina", "empleos Argentina"],
  CL: ["Chile"], CO: ["Colombia"], PE: ["Peru"], UY: ["Uruguay"], CR: ["Costa Rica"],
  UA: ["Ukraine"], PL: ["Poland", "praca IT"], DE: ["Germany"], FR: ["France"],
  GB: ["United Kingdom"], ES: ["Spain", "empleo Espana"], IT: ["Italy", "lavoro Italia"],
  PT: ["Portugal", "emprego Portugal"], NL: ["Netherlands", "vacatures"],
  CZ: ["Czechia", "prace IT"], RO: ["Romania"], IE: ["Ireland"],
};

/**
 * Запити під країну, де в нас є люди й немає дошки.
 *
 * Порожній масив, якщо країну не знаємо, — і це правильна відповідь:
 * вигаданий запит «job board XX» витратив би виклик і не дав нічого.
 */
export function queriesForCountry(code: string): string[] {
  const words = COUNTRY_WORDS[code.toUpperCase()];
  if (!words) return [];
  return words.map((w) => `job board ${w} hiring tech`);
}

/**
 * Домен верхнього рівня країни. Збігається з кодом ISO майже завжди —
 * винятків рівно два, і обидва трапляються в наших користувачів.
 */
const TLD_EXCEPTIONS: Record<string, string> = { GB: "uk", EL: "gr" };

export const tldOf = (code: string): string =>
  TLD_EXCEPTIONS[code.toUpperCase()] ?? code.toLowerCase();

/** Скільки разів повторювати запит, який віддав порожньо. Див. пастку 1. */
const RETRIES = 3;

async function search(token: string, payload: Record<string, unknown>,
                      o: FetchOptions): Promise<Tweet[]> {
  const body = JSON.stringify({ maxResults: 50, excludeRetweets: true, ...payload });
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    let rows: SearchResponse["data"] = [];
    try {
      const r = await fetchJson<SearchResponse>(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body,
      }, { ...o, retries: 0 });
      rows = r.data ?? [];
    } catch {
      rows = [];
    }
    if (rows.length) {
      return rows
        .filter((t): t is { id: string; text: string; userScreenName?: string } =>
          Boolean(t.id && t.text))
        .map((t) => ({ id: t.id, text: t.text, userScreenName: t.userScreenName ?? "" }));
    }
    // Порожньо — майже напевно ліміт частоти. Чекаємо довше з кожним разом.
    if (attempt < RETRIES - 1) await wait(4000 * (attempt + 2));
  }
  return [];
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Збирає твіти за всіма запитами.
 *
 * Послідовно й з паузою: паралельний обхід негайно впирається в ліміт
 * частоти, і тоді порожні відповіді приходять на кожен другий запит.
 */
export async function collectTweets(token: string, o: FetchOptions = {},
                                    pauseMs = 4000,
                                    extraQueries: string[] = []): Promise<Tweet[]> {
  const plan: Array<Record<string, unknown>> = [
    // Країни, яких нам бракує, — першими: якщо ліміт частоти зріже прогін
    // посередині, втратити краще загальний запит, а не цільовий.
    ...extraQueries.map((q) => ({ keywords: q, product: "Top" })),
    ...HASHTAGS.map((h) => ({ hashtag: h, product: "Latest" })),
    ...KEYWORD_QUERIES.map((q) => ({ keywords: q, product: "Top" })),
  ];

  const seen = new Set<string>();
  const out: Tweet[] = [];
  for (const payload of plan) {
    for (const t of await search(token, payload, o)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    await wait(pauseMs);
  }
  return out;
}

const TCO = /https:\/\/t\.co\/[A-Za-z0-9]+/g;

/** Куди веде скорочення, або порожньо. Див. пастку 2 щодо клієнта. */
export async function expandTco(short: string, o: FetchOptions = {}): Promise<string> {
  try {
    const res = await fetch(short, {
      redirect: "follow",
      // Навмисно НЕ браузерний рядок: браузерному t.co редіректу не дає.
      headers: { "User-Agent": "curl/8.7.1" },
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
    return res.url && res.url !== short ? res.url : "";
  } catch {
    return "";
  }
}

/** Усі скорочення з набору твітів, розгорнуті. Ключ — коротка адреса. */
export async function expandAll(tweets: Tweet[], o: FetchOptions = {}): Promise<Map<string, string>> {
  const links = [...new Set(tweets.flatMap((t) => t.text.match(TCO) ?? []))];
  const out = new Map<string, string>();
  await mapLimit(links, 12, async (u) => { out.set(u, await expandTco(u, o)); });
  return out;
}

/**
 * Соцмережі, хостинги й магазини. Трапляються в кожному другому твіті й
 * дошкою не бувають ніколи.
 */
const NOISE = new Set([
  "t.co", "x.com", "twitter.com", "youtube.com", "youtu.be", "instagram.com",
  "facebook.com", "tiktok.com", "reddit.com", "discord.gg", "discord.com",
  "t.me", "telegram.me", "bit.ly", "buff.ly", "lnkd.in", "medium.com",
  "substack.com", "notion.so", "notion.site", "google.com", "docs.google.com",
  "forms.gle", "github.com", "linktr.ee", "beacons.ai", "bio.link",
  "gumroad.com", "patreon.com", "wikipedia.org", "canva.com", "typeform.com",
  "airtable.com", "calendly.com", "openai.com", "chatgpt.com", "dev.to",
  "producthunt.com", "wa.me", "threads.net", "mailchi.mp", "beehiiv.com",
  // Не дошка, а сервіс розсилки оголошень: веде на чужі вакансії від імені
  // сотень різних роботодавців. Перший прогін дав його першим із 22 авторами.
  "careerarc.com", "app.careerarc.com", "loxo.co", "app.loxo.co",
]);

/**
 * Безкоштовні хостинги. Те, що лежить на них, — разова сторінка під один
 * твіт: «job-listings-and-alerts.web.app». Завтра її не буде, а джерело в
 * базі лишиться мертвим рядком назавжди.
 */
const THROWAWAY = [
  ".web.app", ".vercel.app", ".netlify.app", ".manus.space", ".replit.app",
  ".glitch.me", ".pages.dev", ".firebaseapp.com", ".herokuapp.com",
  ".onrender.com", ".streamlit.app", ".lovable.app", ".github.io",
  ".wixsite.com", ".weebly.com", ".blogspot.com",
];

/** Слова, за якими домен схожий на дошку. Не вирок — лише привід перевірити. */
const JOBBY = /job|hiring|hire|career|work|remote|talent|recruit|vacan|employ|intern|roles?\b/i;

export interface Candidate {
  host: string;
  authors: number;   // скільки РІЗНИХ авторів на нього послались
  tweets: number;
  example: string;
  /** Домен верхнього рівня країни, якої нам бракує: `be` для `jobat.be`. */
  wantedTld: string | null;
}

/**
 * Домен верхнього рівня країни, якщо він серед потрібних.
 *
 * `wanted` — це країни, де в нас уже є люди й немає дошки. Для них ccTLD сам
 * по собі є сигналом, і достатнім: бельгійська дошка може називатись
 * `stepstone.be` — жодного слова про роботу в назві немає, і за загальним
 * правилом ми б її викинули.
 */
function wantedTldOf(host: string, wanted: Set<string>): string | null {
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return wanted.has(tld) ? tld : null;
}

/**
 * Твіти → домени-кандидати, впорядковані за числом різних авторів.
 *
 * Рахуємо саме авторів, а не згадки: тридцять посилань від одного акаунта —
 * це його власна реклама, а не популярність дошки.
 */
export function rankHosts(tweets: Tweet[], expanded: Map<string, string>,
                          known: Set<string>, wanted: Set<string> = new Set()): Candidate[] {
  const authors = new Map<string, Set<string>>();
  const count = new Map<string, number>();
  const example = new Map<string, string>();

  for (const t of tweets) {
    const hosts = new Set<string>();
    for (const short of t.text.match(TCO) ?? []) {
      const final = expanded.get(short);
      if (!final) continue;
      let h: string;
      try { h = new URL(final).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
      hosts.add(h);
      if (!example.has(h)) example.set(h, final);
    }
    for (const h of hosts) {
      if (NOISE.has(h) || THROWAWAY.some((s) => h.endsWith(s))) continue;
      if (isKnown(h, known)) continue;
      // Слово про роботу в назві АБО домен потрібної країни. Друге саме по
      // собі достатнє: у назві бельгійської дошки може не бути ні «job», ні
      // «career», а потрібна вона нам більше за будь-яку глобальну.
      if (!JOBBY.test(h) && !wantedTldOf(h, wanted)) continue;
      (authors.get(h) ?? authors.set(h, new Set()).get(h)!).add(t.userScreenName);
      count.set(h, (count.get(h) ?? 0) + 1);
    }
  }

  return [...authors.entries()]
    .map(([host, set]) => ({
      host, authors: set.size, tweets: count.get(host) ?? 0,
      example: example.get(host) ?? `https://${host}`,
      wantedTld: wantedTldOf(host, wanted),
    }))
    // Країна, де в нас є люди й немає дошки, йде поперед усього іншого:
    // одна така дошка вартніша за десяту глобальну стрічку віддалених.
    .sort((a, b) => Number(Boolean(b.wantedTld)) - Number(Boolean(a.wantedTld))
                 || b.authors - a.authors || b.tweets - a.tweets);
}

/** Хост або будь-який його батьківський домен уже відомі. */
export function isKnown(host: string, known: Set<string>): boolean {
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (known.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
