/**
 * Щотижнева розвідка джерел по твіттеру.
 *
 * Нічого не додає сама. Знаходить кандидатів, перевіряє їх до кінця — аж до
 * того, що стрічка справді розбирається на вакансії з назвою компанії, — і
 * кладе в `proposals` коротке резюме. Власник читає в адмінці й тисне
 * «Додати» або «Не треба».
 *
 * Чому не додавати самому. З 505 доменів першого прогону вижило шість, і
 * половина відсіву — це не «зламано», а рішення смаку: `remoteornothing`
 * бездоганно розбирається й повен сантехніків. Такі рішення приймає людина.
 *
 * Правило пропозицій (міграція 0008) виконано: `add_source` знає рівно одну
 * дію — прогнати адресу через те саме приймання, що й вставлене руками
 * посилання. Кнопка не декоративна.
 *
 *   node dist/discover-twitter.js [--dry] [--limit N]
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { mapLimit } from "./http.js";
import { fetchBoard, type Board } from "./sources/boards.js";
import { collectTweets, expandAll, rankHosts, type Candidate } from "./sources/twitter.js";

/** Скільки кандидатів перевіряємо стрічкою за прогін. Кожен — до 20 запитів. */
const PROBE_LIMIT = 25;

/** Скільки пропозицій показуємо за раз. Тридцять кнопок — це не вибір, а робота. */
const PROPOSE_LIMIT = 5;

/** Скільки вакансій має дати стрічка, щоб її взагалі пропонувати. */
const MIN_JOBS = 5;

/** Шляхи, за якими дошки насправді тримають стрічку. Порядок = ймовірність. */
const PATHS = [
  "/feed", "/rss", "/index.xml", "/feed.xml", "/rss.xml", "/atom.xml",
  "/jobs.rss", "/jobs/feed", "/jobs/rss", "/remote-jobs.rss", "/feed/",
  "/?feed=job_feed", "/jobs/rss.xml", "/careers/feed",
];

interface Found {
  candidate: Candidate;
  feedUrl: string;
  jobs: number;
  items: number;
  samples: string[];
}

/**
 * Домен → стрічка, яка справді дає вакансії.
 *
 * Перевіряємо не «чи відкривається», а «чи стають рядки вакансіями», і саме
 * справжнім `fetchBoard`. Перевірка на кількість `<item>` назвала б здоровою
 * стрічку блогу: `dynamitejobs.com` віддає 138 елементів, і всі вони — статті
 * на кшталт «AI in Hiring: The Good, The Bad».
 */
async function probeHost(c: Candidate): Promise<Found | null> {
  for (const path of PATHS) {
    const feedUrl = `https://${c.host}${path}`;
    const board: Board = {
      name: "probe", label: c.host, country: "*", feedUrl, kind: "rss",
    };
    try {
      const jobs = await fetchBoard(board, { retries: 0, timeoutMs: 15_000 });
      if (jobs.length >= MIN_JOBS) {
        return {
          candidate: c, feedUrl, jobs: jobs.length, items: jobs.length,
          samples: jobs.slice(0, 3).map((j) => `${j.company} — ${j.title}`),
        };
      }
    } catch {
      // 403, таймаут, не XML — просто не цей шлях.
    }
  }
  return null;
}

/** Усе, що ми вже читаємо або вже відхилили. Двічі не пропонуємо. */
async function knownHosts(d1: D1Client): Promise<Set<string>> {
  const hostOf = (u: string): string => {
    try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
  };
  const known = new Set<string>();

  for (const r of await d1.query<{ feed_url: string }>("SELECT feed_url FROM country_boards")) {
    const h = hostOf(r.feed_url);
    if (h) known.add(h);
  }
  // Журнал приймання: і додане, і відхилене. Адреса, яка вже віддала 403,
  // не мусить приходити щотижня знову.
  for (const r of await d1.query<{ url: string }>("SELECT url FROM source_intake")) {
    const h = hostOf(r.url);
    if (h) known.add(h);
  }
  // Закриті пропозиції теж: «не треба» сказано один раз і назавжди.
  for (const r of await d1.query<{ target: string }>(
    "SELECT target FROM proposals WHERE kind='add_source' AND target IS NOT NULL")) {
    const h = hostOf(r.target);
    if (h) known.add(h);
  }
  return known;
}

/**
 * Агрегатори, вбудовані в код сканера, і провайдери ATS. У базі їх немає,
 * тож без цього списку вони приходили б у пропозиції щотижня.
 */
const IN_CODE = [
  "arbeitnow.com", "remotive.com", "remoteok.com", "jobicy.com", "himalayas.app",
  "workingnomads.com", "landing.jobs", "themuse.com", "weworkremotely.com",
  "jobspresso.co", "nodesk.co", "cryptocurrencyjobs.co", "news.ycombinator.com",
  "hn.algolia.com", "getro.com", "api.getro.com", "welcometothejungle.com",
  "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
  "breezy.hr", "personio.de", "rippling.com", "bamboohr.com", "recruitee.com",
  "teamtailor.com", "comeet.co", "pinpointhq.com", "myworkdayjobs.com",
  // Закриті назавжди, із заміною в §6 каталогу.
  "linkedin.com", "indeed.com", "glassdoor.com", "dice.com", "wellfound.com",
  "angel.co", "otta.com", "startup.jobs", "workatastartup.com", "ycombinator.com",
  "monster.com", "ziprecruiter.com", "simplyhired.com", "naukri.com",
];

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const limitAt = process.argv.indexOf("--limit");
  const limit = limitAt > -1 ? Number(process.argv[limitAt + 1]) || PROBE_LIMIT : PROBE_LIMIT;

  const cfg = loadConfig();
  const token = process.env.TWITTER_TOKEN;
  if (!token) {
    console.log("Немає TWITTER_TOKEN — розвідку пропущено.");
    return;
  }

  const d1 = new D1Client({
    accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken,
  });

  const known = await knownHosts(d1);
  for (const h of IN_CODE) known.add(h);
  console.log(`Уже відомо ${known.size} доменів.`);

  const tweets = await collectTweets(token);
  console.log(`Зібрано ${tweets.length} твітів.`);
  if (tweets.length === 0) {
    console.log("Порожньо — схоже на вичерпаний ліміт або мертвий токен. Нічого не роблю.");
    return;
  }

  const expanded = await expandAll(tweets);
  const ok = [...expanded.values()].filter(Boolean).length;
  console.log(`Розгорнуто ${ok} із ${expanded.size} скорочень.`);

  const candidates = rankHosts(tweets, expanded, known);
  console.log(`Нових кандидатів: ${candidates.length}. Перевіряю перші ${limit}.`);

  const probed = await mapLimit(candidates.slice(0, limit), 4, probeHost);
  const found = probed.filter((x): x is Found => x !== null)
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, PROPOSE_LIMIT);

  if (found.length === 0) {
    console.log("Нічого, що дало б вакансії. Пропозицій не буде.");
    return;
  }

  for (const f of found) {
    console.log(`  ${f.candidate.host}: ${f.jobs} вакансій · ${f.feedUrl}`);
    for (const s of f.samples) console.log(`      ${s}`);
  }
  if (dry) { console.log("Пробний прогін, нічого не записано."); return; }

  const runId = crypto.randomUUID();
  for (const f of found) {
    const { host, authors, tweets: mentions } = f.candidate;
    await d1.execute(
      `INSERT INTO proposals (id,kind,target,title,detail,evidence,severity,run_id)
       VALUES (?,'add_source',?,?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), f.feedUrl,
       `Нова дошка: ${host}`,
       `Стрічка віддала ${f.jobs} вакансій, і всі розібрались на компанію й посаду. ` +
       `Наприклад: ${f.samples.join(" · ")}. ` +
       `Знайдено в твіттері: ${authors} різних авторів послались на цей домен ` +
       `у ${mentions} твітах про наймання.`,
       `${f.feedUrl} · ${f.jobs} вакансій при перевірці · ${authors} авторів`,
       // Дошка з сотнею вакансій важливіша за дошку з десятком, але жодна
       // з них не «висока вага»: це пропозиція, а не поломка.
       f.jobs >= 50 ? "medium" : "low", runId]);
  }

  const open = (await d1.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM proposals WHERE status='open' AND kind='add_source'"))[0]?.n ?? 0;
  console.log(`Запропоновано ${found.length}. Відкритих пропозицій про джерела: ${open}.`);
}

if (process.argv[1]?.endsWith("discover-twitter.js")) await main();
