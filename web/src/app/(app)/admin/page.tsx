import { redirect } from "next/navigation";
import Link from "next/link";
import Nav from "@/app/nav";
import { detectLocale } from "@/app/actions";
import { replyToFeedback, dismissFeedback, purgeNeverWorked, recheckSome, applyProposal, dismissProposal, applyAllProposals, addBoard, addSources, forgetIntake, retryIntake, recountCountries, refreshTelegramNames } from "./actions";
import { currentUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { RELEASES } from "@/lib/releases";
import { INTAKE_LIMIT } from "@/lib/source-link";
import { SubmitButton } from "./submit";
import { BUCKETS, DEFAULT_DAYS, FAMILIES, KEY_CHANGES, RANGES, VERDICT,
         day, num, usd, type Bucket } from "./vocab";
import { Block, Funnel, Person, Spark, Tile } from "./parts";
import { BoardTable, FeedTable, SourceTable, sphereCount } from "./tables";
import { DAY_NAME, nextRun } from "./schedule";

/**
 * Панель власника.
 *
 * Правило сторінки: усе живе в блоках, і кожен блок відповідає на одне
 * питання. Довгі списки згорнуті — вони довідник, а не панель. Те, що горить,
 * піднімається смугою вгору, бо власник відкриває цю сторінку, щоб дізнатись
 * «чи все добре», а не щоб гортати таблиці.
 */

// Блок «Ключі доступу» прибрано 2026-08-29: п'ять полів зберігали токени до
// джерел, під які в сканері немає жодного розбирача (getSourceKey нікого не
// викликає). Панель показувала важіль, що нічого не вмикає. Повернемо разом
// із першим розбирачем — таблиця source_keys лишається на місці.


/**
 * Щаблі лійки як фільтр списку людей.
 *
 * Умова кожного рядка — та сама, за якою лійка вище рахує свій відсоток.
 * Дві різні умови для одного слова вже дали суперечність на екрані («12 ·
 * 100%» поряд із трьома «немає»), і повторювати її окремо для фільтра
 * означало б завести її вдруге.
 */
const PEOPLE_FILTERS = [
  { id: "all", label: "усі", where: "" },
  { id: "noprofile", label: "без анкети",
    where: `(p.user_id IS NULL
             OR ((p.spheres IS NULL OR p.spheres IN ('', '[]'))
                 AND (p.custom_role IS NULL OR trim(p.custom_role) = '')))` },
  { id: "notg", label: "без Telegram", where: "u.telegram_chat_id IS NULL" },
  { id: "nodigest", label: "без добірки",
    where: "NOT EXISTS (SELECT 1 FROM sent WHERE user_id=u.id AND status='sent')" },
  { id: "silent", label: "без реакції",
    where: `EXISTS (SELECT 1 FROM sent WHERE user_id=u.id AND status='sent')
            AND NOT EXISTS (SELECT 1 FROM feedback WHERE user_id=u.id)` },
] as const;

/** Скільки людей на сторінці. Десять — щоб блок не з'їдав екран. */
const PEOPLE_PAGE = 10;

/** Адреса списку людей. Порожні значення не пишемо — «/admin#people» чистіше. */
const peopleHref = (who: string, page: number): string => {
  const q = new URLSearchParams();
  if (who !== "all") q.set("who", who);
  if (page > 1) q.set("page", String(page));
  return `/admin${q.toString() ? `?${q}` : ""}#people`;
};

export default async function Admin({ searchParams }: {
  searchParams: Promise<{ range?: string; bucket?: string; who?: string; page?: string;
                          note?: string }>;
}) {
  const { range, bucket, who, page, note } = await searchParams;
  const filter = PEOPLE_FILTERS.find((f) => f.id === who) ?? PEOPLE_FILTERS[0];
  const pageNo = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const DAYS = RANGES.find((r) => r.id === range)?.days ?? DEFAULT_DAYS;
  const step: Bucket = BUCKETS.find((b) => b.id === bucket) ?? BUCKETS[0];
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const s = await one<{ jobs: number; companies: number; sources: number;
    users: number; paused: number; broken: number; sent: number;
    allUsers: number; connected: number; newToday: number; newWeek: number;
    sentToday: number; openFeedback: number; thumbsDown: number; wantedMore: number;
    liveJobs: number; liveSources: number }>(`
    -- Числа беруться з source_stats, а не з jobs_cache: рахунок наживо коштував
    -- 26 тисяч прочитаних рядків на кожне з цих полів, а панель відкривають
    -- десятки разів на день. Застарівають вони рівно на один прогін.
    SELECT (SELECT COALESCE(SUM(jobs),0) FROM source_stats) jobs,
           (SELECT COALESCE(SUM(companies),0) FROM source_stats) companies,
           (SELECT COUNT(*) FROM companies) sources,
           (SELECT COUNT(*) FROM users WHERE status='active') users,
           (SELECT COUNT(*) FROM users WHERE status='paused') paused,
           -- Зламане — це те, що КОЛИСЬ працювало. Дошки, яких ніколи не
           -- існувало (їх зібрали з посилань у чужих даних), система прибирає
           -- сама; у лічильнику вони давали 153 замість десяти й лякали щодня.
           (SELECT COUNT(*) FROM sources_state WHERE status!='ok' AND last_ok_at IS NOT NULL) broken,
           (SELECT COUNT(*) FROM sources_state WHERE status='ok') liveSources,
           (SELECT COUNT(*) FROM sent WHERE status='sent') sent,
           (SELECT COUNT(*) FROM users) allUsers,
           (SELECT COUNT(*) FROM users WHERE telegram_chat_id IS NOT NULL) connected,
           (SELECT COUNT(*) FROM users WHERE date(created_at) = date('now')) newToday,
           (SELECT COUNT(*) FROM users WHERE date(created_at) >= date('now','-7 day')) newWeek,
           (SELECT COUNT(*) FROM sent WHERE date(created_at) = date('now')) sentToday,
           (SELECT COUNT(*) FROM site_feedback WHERE handled_at IS NULL) openFeedback,
           (SELECT COUNT(*) FROM feedback WHERE reaction='not_relevant') thumbsDown,
           (SELECT COUNT(*) FROM feedback WHERE reaction='more') wantedMore,
           (SELECT COALESCE(SUM(fresh),0) FROM source_stats) liveJobs`);

  const lastRun = await one<{ started_at: string; status: string; jobs_found: number;
    ladder_reached: string | null; notes: string | null }>(
    "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1");

  /**
   * Що система міняє в собі сама — і коли наступного разу.
   *
   * Розклад живе в systemd на VPS, а не в базі, тож повторюємо його тут
   * СПИСКОМ, а не вигадуємо: кожен рядок дослівно відповідає файлу в
   * scanner/deploy. Наступний час рахується з того самого правила, тому
   * панель не може розійтися з сервером мовчки — розійдеться видимо, і це
   * помітно з «як пройшло» поруч.
   */
  const learning = [
    { name: "Скан джерел", days: [1, 2, 3, 4, 5], hour: 5,
      what: "обходить драбину джерел і наповнює кеш вакансій",
      unit: "nextrole-scan.timer" },
    { name: "Сторож", days: [1, 2, 3, 4, 5], hour: 8,
      what: "судить учорашній скан і, якщо той вийшов коротким, запускає ще раз",
      unit: "nextrole-watchdog.timer" },
    { name: "Самоперегляд", days: [0], hour: 6,
      what: "сім правил над власними даними: що поховати, що воскресити, які компанії давно порожні — і кладе це в «Що пропоную змінити»",
      unit: "nextrole-review.timer" },
    { name: "Розвідка Getro", days: [0], hour: 4,
      what: "шукає нові колекції фондів і записує їх вимкненими",
      unit: "nextrole-discover.timer" },
    { name: "Розвідка дошок", days: [0], hour: 7,
      what: "шукає дошки під країни, де вже є люди, а джерел немає",
      unit: "nextrole-twitter.timer" },
  ];

  /** Історія прогонів, а не лише останній: «як пройшов» видно тільки поруч. */
  const runs = await all<{ started_at: string; finished_at: string | null; status: string;
    jobs_found: number; distinct_companies: number; ladder_reached: string | null; notes: string | null }>(
    "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 7");

  /** Що самоперегляд і розвідка вже принесли — і скільки з того ми прийняли. */
  const learned = await one<{ open: number; applied: number; dismissed: number; last_at: string | null }>(
    `SELECT SUM(status='open') open, SUM(status='applied') applied,
            SUM(status='dismissed') dismissed, MAX(created_at) last_at
       FROM proposals`);

  /** Ваги, вивчені зі скарг людей. Порожньо — скарг ще не було. */
  const tuned = await one<{ people: number; loc: number | null; sal: number | null }>(
    `SELECT COUNT(*) people, MAX(location_weight) loc, MAX(salary_weight) sal
       FROM user_tuning WHERE location_weight > 1 OR salary_weight > 1`);

  const proposals = await all<{ id: string; kind: string; target: string | null; title: string;
    detail: string; evidence: string | null; severity: string; created_at: string }>(
    `SELECT * FROM proposals WHERE status='open'
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at`);
  const bySeverity = (sev: string) => proposals.filter((x) => x.severity === sev);

  // Нік автора приєднуємо тут-таки: відгук «від 06df703e» не давав ні
  // впізнати людину, ні згадати, про що з нею вже говорили.
  const feedback = await all<{ id: string; user_id: string | null; contact: string | null;
    locale: string; page: string | null; message: string; created_at: string;
    nick: string | null; person: string | null }>(
    `SELECT f.*, u.telegram_username nick, u.telegram_name person
       FROM site_feedback f LEFT JOIN users u ON u.id = f.user_id
      WHERE f.handled_at IS NULL ORDER BY f.created_at DESC LIMIT 30`);

  // Витрати в доларах: cost_usd пишеться при кожному виклику за таблицею pricing.ts.
  const spend = await one<{ calls: number; callsWeek: number; usdToday: number; usdWeek: number;
    usdMonth: number; failed: number; boards: number; countries: number; boardJobs: number; localJobs: number }>(`
    SELECT (SELECT COUNT(*) FROM api_usage WHERE date(at)=date('now')) calls,
           (SELECT COUNT(*) FROM api_usage WHERE at >= datetime('now','-7 day')) callsWeek,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE date(at)=date('now')) usdToday,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE at >= datetime('now','-7 day')) usdWeek,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE at >= datetime('now','-30 day')) usdMonth,
           (SELECT COUNT(*) FROM api_usage WHERE ok=0 AND at >= datetime('now','-7 day')) failed,
           (SELECT COUNT(*) FROM country_boards WHERE enabled=1) boards,
           (SELECT COUNT(DISTINCT country) FROM country_boards WHERE enabled=1) countries,
           (SELECT COALESCE(SUM(jobs),0) FROM source_stats WHERE family='board') boardJobs,
           (SELECT COUNT(*) FROM jobs_cache WHERE country IS NOT NULL) localJobs`);

  const boards = await all<{ id: string; country: string; name: string; label: string;
    feed_url: string; kind: string; enabled: number; jobs_last_run: number | null; status: string | null }>(
    `SELECT b.*, s.jobs_last_run, s.status
       FROM country_boards b LEFT JOIN sources_state s ON s.source_name = b.name
      ORDER BY b.country, b.label`);

  /**
   * Країни, де вже є люди, але дошок немає.
   *
   * Дошки ніхто не знаходить сам: discover шукає компанії на ATS, а не
   * національні дошки. Тому єдиний спосіб дізнатися, для якої країни варто
   * пошукати фіди, — побачити, звідки прийшли люди.
   */
  const gaps = await all<{ country: string; people: number }>(
    `SELECT p.country, COUNT(*) people
       FROM profiles p
      WHERE p.country IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM country_boards b
                         WHERE b.country = p.country AND b.enabled = 1)
      GROUP BY p.country ORDER BY people DESC`);

  // Рубрики однієї дошки — це не окремі дошки. «DOU · Python» належить
  // до «DOU», тому в таблиці показуємо дошку, а рубрики ховаємо всередину.
  const boardGroups = [...boards.reduce((acc, b) => {
    const name = b.label.split(" · ")[0]!;
    const key = `${b.country}|${name}`;
    const g = acc.get(key) ?? { country: b.country, name, rows: [] as typeof boards };
    g.rows.push(b);
    acc.set(key, g);
    return acc;
  }, new Map<string, { country: string; name: string; rows: typeof boards }>()).values()];

  /**
   * Звідки насправді приїхали вакансії.
   *
   * Досі «джерела» в панелі означали три різні речі в трьох різних місцях:
   * компанії — в одному блоці, національні дошки — в іншому, а агрегатори й
   * колекції Getro не показувались ніде, бо живуть у коді сканера. На питання
   * «звідки ми беремо інфу» відповіді не було взагалі.
   *
   * Рахуємо за `jobs_cache.source` — за тим, що справді доїхало, а не за тим,
   * що налаштоване. Джерело, налаштоване й мовчазне, тут не з'явиться, і це
   * правильна відповідь: воно нічого нам не дає.
   */
  const families = await all<{ family: string; feeds: number; jobs: number;
    companies: number; fresh: number }>(
    `SELECT family, COUNT(*) feeds, SUM(jobs) jobs,
            SUM(companies) companies, SUM(fresh) fresh
       FROM source_stats GROUP BY family ORDER BY jobs DESC`);

  /**
   * Повний перелік того, звідки ми тягнемо дані, — одним списком.
   *
   * Попередній варіант рахував лише за `jobs_cache`, тобто показував тільки
   * джерела, які щось привезли. Дошка, налаштована й мовчазна, не з'являлась
   * ніде — а саме вона й потребує втручання: `board:global-web3career` стояв
   * увімкненим зі стрічкою, що ніколи не віддавала жодного рядка, і побачити
   * це в панелі було неможливо.
   *
   * Тому дошки беруться з `country_boards` (усі, і мовчазні теж), а решта —
   * з кеша. ATS-компаній понад дві тисячі: поіменно вони тут не поміщаються
   * і не потрібні, тож згортаються в один рядок на провайдера.
   */
  const feeds = await all<{ source: string; label: string; family: string;
    country: string | null; jobs: number; fresh: number; status: string | null }>(`
    -- Усе з source_stats: раніше цей запит читав jobs_cache тричі й коштував
    -- 36 тисяч рядків. Тепер джерел у підсумках менше двох тисяч, і читаються
    -- вони по індексу родини.
    SELECT b.name source, b.label, 'board' family, b.country,
           COALESCE(t.jobs, 0) jobs, COALESCE(t.fresh, 0) fresh,
           CASE WHEN b.enabled = 0 THEN 'off' ELSE s.status END status
      FROM country_boards b
      LEFT JOIN sources_state s ON s.source_name = b.name
      LEFT JOIN source_stats  t ON t.source = b.name

     UNION ALL
    SELECT t.source, REPLACE(t.source, 'aggregator:', ''), 'aggregator', NULL,
           t.jobs, t.fresh, s.status
      FROM source_stats t LEFT JOIN sources_state s ON s.source_name = t.source
     WHERE t.family = 'aggregator'

     UNION ALL
    SELECT t.source, 'колекція ' || REPLACE(t.source, 'getro:', ''), 'getro', NULL,
           t.jobs, t.fresh, s.status
      FROM source_stats t LEFT JOIN sources_state s ON s.source_name = t.source
     WHERE t.family = 'getro'

     UNION ALL
    -- ATS згорнуто по провайдеру: тисяча вісімсот компаній окремими рядками —
    -- це довідник, а не панель.
    SELECT 'ats:' || SUBSTR(source, 1, INSTR(source, ':') - 1),
           SUBSTR(source, 1, INSTR(source, ':') - 1) || ' · ' || COUNT(*) || ' компаній',
           'ats', NULL, SUM(jobs), SUM(fresh), NULL
      FROM source_stats WHERE family = 'ats' AND INSTR(source, ':') > 0
     GROUP BY SUBSTR(source, 1, INSTR(source, ':') - 1)`);

  /**
   * Рубрики однієї дошки — це одна дошка.
   *
   * DOU займав двадцять чотири рядки з двадцяти дев'яти: «DOU · Java»,
   * «DOU · DevOps», «DOU · HR». За фактом це одне джерело з рубриками, і в
   * такому вигляді таблиця відповідала на питання «скільки в нас стрічок»,
   * а не «звідки ми беремо дані». Групуємо за тим самим правилом, що й блок
   * «Національні дошки» нижче: усе до « · » — назва дошки.
   */
  const grouped = [...feeds.reduce((acc, f) => {
    const brand = f.family === "board" ? f.label.split(" · ")[0]! : f.label;
    const key = `${f.family}|${f.country ?? ""}|${brand}`;
    const g = acc.get(key);
    if (g) {
      g.jobs += f.jobs;
      g.fresh += f.fresh;
      g.parts += 1;
      // Дошка жива, якщо жива хоч одна рубрика: «вимкнено» на одній із
      // двадцяти чотирьох не робить мовчазним усе джерело.
      if (f.status === "ok") g.status = "ok";
      else g.status ??= f.status;
    } else {
      acc.set(key, { ...f, label: brand, parts: 1 });
    }
    return acc;
  }, new Map<string, typeof feeds[number] & { parts: number }>()).values()]
    .sort((a, b) => b.jobs - a.jobs);

  /**
   * Регіональне окремо від загального.
   *
   * Це не косметика: від країни залежить, кому вакансія взагалі покажеться
   * (digest.ts: `country IS NULL OR country = ?`). Одним списком німецька
   * дошка стоїть поряд із глобальним агрегатором, хоча її 582 вакансії
   * бачить лише людина з Німеччини, а не всі.
   */
  const regional = grouped.filter((f) => f.country && f.country !== "*");
  const general = grouped.filter((f) => !f.country || f.country === "*");

  const intake = await all<{ id: string; url: string; at: string; verdict: string;
    kind: string | null; target: string | null; note: string | null; found: number;
    fix: string | null; attempts: number }>(
    // Лише невдалі, і кожна адреса ОДИН раз.
    //
    // Досі рядки йшли як є, і блок був журналом спроб, а не списком роботи:
    // один прогін розвідки 30.08 записав кожну адресу по п'ять разів за
    // двадцять секунд, тож дванадцять рядків описували три посилання.
    // Тепер адреса згортається в один рядок, а скільки разів ми стукали —
    // це окреме число поруч, і воно корисніше за п'ять однакових рядків.
    `SELECT url, MAX(id) id, MAX(at) at, COUNT(*) attempts,
            MAX(verdict) verdict, MAX(kind) kind, MAX(target) target,
            MAX(note) note, MAX(found) found, MAX(fix) fix
       FROM source_intake
      WHERE verdict <> 'added' AND verdict <> 'duplicate'
      GROUP BY url
      ORDER BY at DESC LIMIT 12`);

  /**
   * Рядки, з якими людині нема що робити, знімаються самі.
   *
   * Блок питав власника про те, що вже зроблено або вже вирішено:
   * `jobstash.xyz`, `web3.career`, `crypto-careers.com` і `cryptocurrencyjobs.co`
   * стояли з вердиктом «не розпізнано», хоч усі чотири підключені й дають
   * 1638, 438, 20 і 85 вакансій — просто під іншою адресою стрічки, тож
   * звірка за повним рядком їх не бачила. Порівнюємо ВУЗОЛ, а не адресу.
   *
   * Друга половина — ті, що не запрацюють ніколи: домен за інтерактивним
   * викликом Cloudflare або сторінка, порожня без JavaScript. Це вже
   * виміряно й записано в docs/BACKLOG.md; тримати їх у списку роботи
   * означає щотижня пропонувати спробу, яка не може вдатися.
   */
  const HOPELESS: Record<string, string> = {
    "cryptojobslist.com": "домен за викликом Cloudflare, усі шляхи RSS дають 403",
    "beincrypto.com": "домен за викликом Cloudflare, усі шляхи RSS дають 403",
    "kyzzen.io": "дошка порожня без JavaScript, а вакансій там дев'ять",
    "ethereumjobboard.com": "дошка порожня без JavaScript, а вакансій там дев'ять",
  };
  const host = (u: string): string => {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
  };
  const knownHosts = new Set(boards.map((b) => host(b.feed_url)).filter(Boolean));
  const intakeLive = intake.filter((x) => !knownHosts.has(host(x.url)) && !HOPELESS[host(x.url)]);
  const intakeHidden = intake.length - intakeLive.length;

  // Скільки прийнялось — числом, бо сам список не потрібен.
  const intakeOk = (await one<{ n: number }>(
    `SELECT COUNT(*) n FROM source_intake
      WHERE verdict = 'added' AND at >= datetime('now','-7 day')`))?.n ?? 0;

  // Колекції Getro — борди екосистем фондів. Головний постачальник компаній,
  // яких ми ще не знаємо, і досі його не було видно в панелі взагалі.
  const getro = await all<{ collection_id: number; label: string; url: string | null;
    enabled: number; jobs: number }>(
    // Лише ті, що читаються. Вимкнених буде кілька сотень: розвідка щонеділі
    // знаходить живі колекції по всьому діапазону й записує їх зупиненими, бо
    // читати всі щодня коштувало б півтори години замість п'яти хвилин. Їхнє
    // місце — число, а не стіна рядків.
    //
    // Число вакансій береться з `source_stats`, а не рахується наживо.
    // Тут стояв корельований підзапит `j.source = 'getro:' || g.collection_id`:
    // склейка рядків не лягає на жоден індекс, тож кожна колекція означала
    // повний прохід `jobs_cache`. Виміряно 03.09: **899 323 прочитані рядки
    // на ОДНЕ відкриття панелі** при ефективності запиту 0,00003. Шість
    // відкриттів за день дали 5,4 млн читань і були найбільшим споживачем
    // читань на всьому акаунті, більшим за саму розсилку.
    //
    // Це рівно та сама вада, заради якої з'явилась `source_stats` (див.
    // 0027_source_stats.sql), просто блок Getro додали пізніше й повз неї.
    // Числа застарівають на один прогін скану, і для питання «чи жива
    // колекція» цього досить.
    `SELECT g.collection_id, g.label, g.url, g.enabled,
            COALESCE(st.jobs, 0) jobs
       FROM getro_collections g
       LEFT JOIN source_stats st ON st.source = 'getro:' || g.collection_id
      WHERE g.enabled = 1
      ORDER BY jobs DESC, g.collection_id`);

  const getroOff = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM getro_collections WHERE enabled = 0"))?.n ?? 0;

  // Кнопку «підтягнути ніки» показуємо лише тоді, коли є кого підтягувати.
  const nameless = (await one<{ n: number }>(
    `SELECT COUNT(*) n FROM users
      WHERE telegram_chat_id IS NOT NULL AND telegram_username IS NULL AND telegram_name IS NULL`))?.n ?? 0;

  // ── Зростання ───────────────────────────────────────────────────────────
  const scanDays = await all<{ d: string; jobs: number; companies: number }>(
    `SELECT date(started_at) d, MAX(jobs_found) jobs, MAX(distinct_companies) companies
       FROM scan_runs WHERE status='ok' AND started_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now',?)
      GROUP BY d ORDER BY d`, `-${DAYS} day`);
  // Дотики в боті: єдина наша власна міра того, чи людина взагалі користується
  // продуктом. Відвідування САЙТУ сюди не входять — вони живуть у Cloudflare
  // Web Analytics, і дістати їх можна лише через їхній GraphQL із окремим
  // токеном. Це інша задача, і робити вигляд, що графік їх показує, не можна.
  const taps = await all<{ d: string; n: number }>(
    `SELECT date(at) d, COUNT(*) n FROM bot_activity
      WHERE at >= datetime('now', ?) GROUP BY d ORDER BY d`, `-${DAYS} day`);

  // Приріст людей кроком, який обрали. Накопичення рахуємо в JS, бо віконні
  // функції D1 підтримує, але читати їх тут нікому не легше.
  const byStep = await all<{ d: string; n: number }>(
    `SELECT ${step.sql} d, COUNT(*) n FROM users
      WHERE created_at >= datetime('now', ?) GROUP BY d ORDER BY d`, `-${DAYS} day`);
  const beforeStep = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM users WHERE created_at < datetime('now', ?)", `-${DAYS} day`))?.n ?? 0;
  const peopleSteps = byStep.reduce<Array<{ d: string; nowTotal: number; added: number }>>(
    (acc, x) => {
      const prev = acc.at(-1)?.nowTotal ?? beforeStep;
      acc.push({ d: x.d, nowTotal: prev + x.n, added: x.n });
      return acc;
    }, []);

  const signups = await all<{ d: string; n: number }>(
    "SELECT date(created_at) d, COUNT(*) n FROM users GROUP BY d ORDER BY d");
  // Скільки людей було до початку вікна — щоб лінія росла з реального рівня,
  // а не з нуля.
  const before = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM users WHERE date(created_at) < date('now', ?)",
    `-${DAYS - 1} day`))?.n ?? 0;

  // ── Люди ────────────────────────────────────────────────────────────────
  // Панель знала про людей два числа: скільки всього й скільки за тиждень.
  // На шести користувачах питання не «скільки», а «де вони застрягли»:
  // зареєструвався — заповнив анкету — прив'язав Telegram — отримав добірку —
  // відповів на неї. Кожен щабель, який не пройшли, це наша недоробка.
  const funnel = await one<{ registered: number; profiled: number; connected: number;
    delivered: number; reacted: number; applied: number }>(`
    SELECT (SELECT COUNT(*) FROM users) registered,
           (SELECT COUNT(*) FROM profiles
             WHERE (spheres IS NOT NULL AND spheres NOT IN ('', '[]'))
                OR (custom_role IS NOT NULL AND trim(custom_role) <> '')) profiled,
           (SELECT COUNT(*) FROM users WHERE telegram_chat_id IS NOT NULL) connected,
           (SELECT COUNT(DISTINCT user_id) FROM sent WHERE status='sent') delivered,
           (SELECT COUNT(DISTINCT user_id) FROM feedback) reacted,
           -- Останній щабель лійки й єдиний, який означає результат для
           -- ЛЮДИНИ, а не для нас. Усе вище показує, що система спрацювала;
           -- цей рядок показує, що вона була потрібна.
           (SELECT COUNT(DISTINCT user_id) FROM sent WHERE applied_at IS NOT NULL) applied`);

  /**
   * Чи повертаються люди.
   *
   * Головне число продукту, і досі його не було видно ніде: стовпець
   * `sent.applied_at` заповнювався з першого дня, а панель його не читала.
   *
   * Тут дві різні мірки, і плутати їх дорого. «Подач» рахується за днем
   * САМОЇ подачі (`applied_at`), а не за днем, коли картку надіслали: за
   * днем надсилання виходить, скільки з тієї добірки колись знадобилось, і
   * це відповідь на інше питання. Перший же перегляд цих чисел показав
   * різницю: за днем надсилання виглядало, ніби подаються всі, а за днем
   * подачі видно, що 30 подач зробили дев'ять людей.
   *
   * «Активні» — це будь-який слід за день: подача, реакція під добіркою або
   * запит «ще п'ять». Просто отримати повідомлення не рахується: доставку
   * робимо ми, а не людина.
   */
  const byDay = await all<{ d: string; cards: number; reached: number; active: number; applies: number }>(`
    -- Групування, а не підзапит на кожен день. Перша версія питала sent
    -- окремо для кожної дати й коштувала 6040 прочитаних рядків; ця дає ті
    -- самі числа за 1609. Панель відкривають десятки разів на день, і саме
    -- через такий рахунок наживо тут уже одного разу з'явилось source_stats.
    WITH act AS (
      SELECT user_id, date(applied_at) d FROM sent WHERE applied_at IS NOT NULL
      UNION SELECT user_id, date(created_at) FROM feedback
      UNION SELECT user_id, date(requested_at) FROM delivery_requests
    ),
    snt AS (
      SELECT date(sent_at) d, COUNT(*) cards, COUNT(DISTINCT user_id) reached
        FROM sent WHERE status='sent' AND sent_at IS NOT NULL GROUP BY 1
    ),
    app AS (
      SELECT date(applied_at) d, COUNT(*) applies FROM sent WHERE applied_at IS NOT NULL GROUP BY 1
    ),
    a AS (SELECT d, COUNT(DISTINCT user_id) active FROM act GROUP BY 1)
    SELECT snt.d, snt.cards, snt.reached,
           COALESCE(a.active,0) active, COALESCE(app.applies,0) applies
      FROM snt LEFT JOIN a ON a.d=snt.d LEFT JOIN app ON app.d=snt.d
     ORDER BY snt.d DESC LIMIT 14`);

  /**
   * Когорти за днем ПЕРШОЇ добірки.
   *
   * День 1 це сам день першої добірки, тож день 7 стоїть на `+6`. Порожня
   * клітинка означає «той день ще не настав», а не нуль: когорта, якій два
   * дні, не може мати сьомого дня, і показувати там нуль було б брехнею.
   */
  const cohorts = await all<{ d0: string; n: number; d2: number; d3: number; d7: number }>(`
    WITH act AS (
      SELECT user_id, date(applied_at) d FROM sent WHERE applied_at IS NOT NULL
      UNION SELECT user_id, date(created_at) FROM feedback
      UNION SELECT user_id, date(requested_at) FROM delivery_requests
    ),
    f AS (
      SELECT user_id, MIN(date(sent_at)) d0 FROM sent
       WHERE status='sent' AND sent_at IS NOT NULL GROUP BY user_id
    )
    SELECT f.d0, COUNT(DISTINCT f.user_id) n,
           COUNT(DISTINCT CASE WHEN a.d=date(f.d0,'+1 day') THEN f.user_id END) d2,
           COUNT(DISTINCT CASE WHEN a.d=date(f.d0,'+2 day') THEN f.user_id END) d3,
           COUNT(DISTINCT CASE WHEN a.d=date(f.d0,'+6 day') THEN f.user_id END) d7
      FROM f LEFT JOIN act a ON a.user_id=f.user_id
     GROUP BY f.d0 ORDER BY f.d0 DESC LIMIT 14`);

  // Пошти тут навмисно немає: панель відкривають на людях і показують з
  // екрана. А от нік є: за «06df703e» неможливо ні впізнати людину, ні
  // написати їй, і саме це власник хоче зробити, дивлячись на цей список.
  const people = await all<{ id: string; created_at: string | null; locale: string; status: string;
    tg: number; paused: string | null;
    country: string | null; spheres: string | null; custom_role: string | null; sent: number;
    more: number; nope: number; applied: number; last_seen: string | null;
    nick: string | null; person: string | null }>(`
    SELECT u.id, u.created_at, u.locale, u.status,
           u.telegram_username nick, u.telegram_name person,
           CASE WHEN u.telegram_chat_id IS NULL THEN 0 ELSE 1 END tg,
           u.paused_reason paused,
           u.last_interaction_at last_seen,
           p.country, p.spheres, p.custom_role,
           (SELECT COUNT(*) FROM sent WHERE user_id=u.id AND status='sent') sent,
           (SELECT COUNT(*) FROM feedback WHERE user_id=u.id AND reaction='more') more,
           (SELECT COUNT(*) FROM feedback WHERE user_id=u.id AND reaction='not_relevant') nope,
           (SELECT COUNT(*) FROM sent WHERE user_id=u.id AND applied_at IS NOT NULL) applied
      FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     ${filter.where ? `WHERE ${filter.where}` : ""}
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    PEOPLE_PAGE, (pageNo - 1) * PEOPLE_PAGE);

  // Скільки їх усього за цим фільтром — саме звідси беруться номери сторінок.
  const peopleTotal = (await one<{ n: number }>(
    `SELECT COUNT(*) n FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     ${filter.where ? `WHERE ${filter.where}` : ""}`))?.n ?? 0;
  const pages = Math.max(1, Math.ceil(peopleTotal / PEOPLE_PAGE));

  /**
   * Розмір кожної групи — числом на самій кнопці.
   *
   * Фільтр без числа доводиться перебирати: тиснеш «без Telegram», щоб
   * дізнатись, чи там узагалі хтось є. Одним запитом на всі п'ять, бо п'ять
   * окремих коштували б п'ять читань D1 на кожне відкриття панелі.
   */
  const counts = await one<Record<string, number>>(
    `SELECT ${PEOPLE_FILTERS.map((f) =>
      `SUM(CASE WHEN ${f.where || "1=1"} THEN 1 ELSE 0 END) "${f.id}"`).join(", ")}
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id`);

  // Останній вимір ДО вікна. Без нього кожен день до першого скану у вікні
  // малювався нулем: «вакансій у кеші» показувало одинадцять порожніх
  // стовпчиків і стрибок наприкінці, хоч кеш весь час був повний. Нуль там
  // означав не «нічого не було», а «ми того дня не міряли».
  const beforeScan = await one<{ jobs: number; companies: number }>(
    `SELECT jobs_found jobs, distinct_companies companies FROM scan_runs
      WHERE status='ok' AND date(started_at) < date('now', ?)
      ORDER BY started_at DESC LIMIT 1`, `-${DAYS - 1} day`);

  // Вісь днів рахує база, а не JS: під час рендера викликати Date.now() не
  // можна — React вимагає, щоб рендер був чистим, і лінтер це ловить.
  //
  // Вісь не починається раніше, ніж з'явились перші дані. Продукт молодший
  // за два тижні, і решта вікна була б не «нулем», а порожнечею до запуску.
  const axis = (await all<{ d: string }>(
    `WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT d FROM (SELECT date('now', '-' || n || ' day') d FROM seq)
      WHERE d >= COALESCE((SELECT MIN(day) FROM (
              SELECT MIN(date(created_at)) day FROM users
              UNION ALL SELECT MIN(date(started_at)) FROM scan_runs WHERE status='ok')), d)
      ORDER BY d`, DAYS - 1)).map((x) => x.d);
  // Порожній день тягне значення попереднього: скан, що не записав рядок, не
  // означає, що кеш спорожнів. Малювати там нуль було б неправдою.
  const carry = (get: (d: string) => number | undefined, start = 0) => {
    let prev = start;
    return axis.map((d) => ({ d, v: (prev = get(d) ?? prev) }));
  };
  const growth = {
    jobs: carry((d) => scanDays.find((x) => x.d === d)?.jobs, beforeScan?.jobs ?? 0),
    companies: carry((d) => scanDays.find((x) => x.d === d)?.companies, beforeScan?.companies ?? 0),
    // Накопичення рахується від рівня на початок вікна: людей не меншає.
    people: axis.map((d) => ({
      d,
      v: before + signups.filter((x) => x.d >= axis[0]! && x.d <= d).reduce((a, x) => a + x.n, 0),
    })),
    // Дотики — за день, а не накопиченням: питання тут «чи користуються нами
    // сьогодні», і зростаюча крива на нього відповідала б «так» навіть у
    // місяць повної тиші. День без жодного дотику має бути видно нулем.
    taps: axis.map((d) => ({ d, v: taps.find((x) => x.d === d)?.n ?? 0 })),
  };

  // ── Історія зводок ──────────────────────────────────────────────────────
  const digests = await all<{ d: string; jobs: number; people: number; digests: number }>(
    `SELECT date(created_at) d, COUNT(*) jobs, COUNT(DISTINCT user_id) people,
            COUNT(DISTINCT digest_id) digests
       FROM sent WHERE status='sent'
         AND date(created_at) >= date('now', '-' || ((strftime('%w','now') + 6) % 7) || ' day')
       GROUP BY d ORDER BY d DESC LIMIT 5`);
  const reactions = await all<{ d: string; more: number; nope: number }>(
    `SELECT date(created_at) d,
            SUM(CASE WHEN reaction='more' THEN 1 ELSE 0 END) more,
            SUM(CASE WHEN reaction='not_relevant' THEN 1 ELSE 0 END) nope
       FROM feedback GROUP BY d`);

  // Три групи за тим, що з цим МОЖНА зробити, а не за кодом помилки.
  // Окремий запит без ліміту: список джерел обрізаний до 120, і рахувати
  // групи з нього означало б показувати неправдиві числа.
  const broken = await all<{ source_name: string; status: string; last_ok_at: string | null;
    consecutive_fail_days: number; last_error: string | null; jobs_last_run: number }>(
    // Без `deprecated` — і це не косметика, а причина, чому кнопка «Прибрати
    // зараз» виглядала мертвою. Вона ставила саме `deprecated`, а список брав
    // усе, що не `ok`, тобто ті самі рядки лишались на екрані незмінними.
    // Прибране — це вже вирішене, і в блоці «проблеми» йому не місце.
    `SELECT * FROM sources_state
      WHERE status<>'ok' AND status<>'deprecated' ORDER BY consecutive_fail_days DESC`);
  const isBlocked = (x: { last_error: string | null }) => /40[13]|429/.test(x.last_error ?? "");
  const blocked = broken.filter(isBlocked);
  const lost = broken.filter((x) => !isBlocked(x) && x.last_ok_at !== null);
  const neverWorked = broken.filter((x) => !isBlocked(x) && x.last_ok_at === null);

  // ── Що горить ───────────────────────────────────────────────────────────
  // Одна смуга вгорі замість того, щоб власник шукав погане по всій сторінці.
  const high = bySeverity("high").length;
  const alerts: Array<{ text: string; href: string }> = [];
  if (lastRun && lastRun.status === "failed")
    alerts.push({ text: `Останній скан упав о ${lastRun.started_at.slice(11, 16)}`, href: "#growth" });
  if ((s?.connected ?? 0) > 0 && (s?.sentToday ?? 0) === 0)
    alerts.push({ text: "Сьогодні добірка ще нікому не пішла", href: "#digests" });
  if (high > 0)
    alerts.push({ text: `${high} пропозиц${high === 1 ? "ія" : "ії"} високої ваги`, href: "#proposals" });
  if ((s?.openFeedback ?? 0) > 0)
    alerts.push({ text: `${s?.openFeedback} відгук${(s?.openFeedback ?? 0) === 1 ? "" : "ів"} без відповіді`, href: "#feedback" });
  if (blocked.length > 0)
    alerts.push({ text: `${blocked.length} джерел заблоковано`, href: "#problems" });

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <p className="eyebrow">Панель власника</p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="display mt-2 text-3xl">Стан системи</h1>
          <p className="mono text-xs" style={{ color: "var(--muted)" }}>
            останній скан {lastRun ? `${lastRun.started_at.slice(5, 16).replace("T", " ")} · ${lastRun.status}` : "—"}
          </p>
        </div>

        {alerts.length > 0 ? (
          <div className="alert mt-6">
            <p className="font-medium">Потребує рішення · {alerts.length}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {alerts.map((a) => (
                <li key={a.href + a.text} className="text-sm">
                  <a href={a.href} className="link">{a.text}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
            Нічого не горить: скан пройшов, добірка пішла, пропозицій високої ваги немає.
          </p>
        )}

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile n={s?.allUsers ?? 0} label="людей" href="#people" to="до списку людей" />
          <Tile n={s?.newWeek ?? 0} label="нових за тиждень" href="#growth" to="до графіків зростання" />
          <Tile n={s?.sentToday ?? 0} label="надіслано сьогодні" href="#digests" to="до історії зводок" />
          <Tile n={s?.liveJobs ?? 0} label="вакансій до добірки" href="#sources" to="до джерел" />
          <Tile n={s?.liveSources ?? 0} label="джерел живих" href="#sources" to="до джерел" />
          <Tile n={s?.broken ?? 0} label="зламано" accent={(s?.broken ?? 0) > 0}
                href="#problems" to="до проблем джерел" />
        </div>

        <div className="mt-12 flex flex-col gap-12">
          <Block id="people" title={`Люди · ${funnel?.registered ?? 0}`}
                 lede="Де вони застрягли. Кожен щабель, який людина не пройшла, — це наша недоробка, а не її неуважність."
                 right={
                   <div className="flex flex-wrap items-center gap-4">
                     {/* Фільтр — це ті самі щаблі лійки зліва. Дивитись на
                         «хто застряг без Telegram» очима по всьому списку
                         було неможливо вже на дванадцятьох. */}
                     <div className="flex flex-wrap gap-3">
                       {PEOPLE_FILTERS.map((f) => (
                         <Link key={f.id} href={peopleHref(f.id, 1)} className="mono text-xs"
                               style={{ color: f.id === filter.id ? "var(--ember)" : "var(--muted)",
                                        textDecoration: f.id === filter.id ? "underline" : "none" }}>
                           {f.label} · {counts?.[f.id] ?? 0}
                         </Link>
                       ))}
                     </div>
                     {nameless > 0 && (
                       <form action={refreshTelegramNames}>
                         <SubmitButton busy="Питаю Telegram…" className="btn btn-quiet px-3 py-2 text-xs">
                           Підтягнути ніки · {nameless}
                         </SubmitButton>
                       </form>
                     )}
                   </div>
                 }>
            {/* Наслідок дотику — тут, а не лише в лозі.
                Рятівне посилання йде в Telegram, і саме Telegram може його не
                взяти (чат не знайдено, 429, мережа). Раніше цей збій нікуди не
                потрапляв: `sendText` не кидає винятків, а порожній catch навколо
                неї не ловив нічого. Власник бачив «зроблено» й не дізнавався, що
                людині нема чого пересилати. */}
            {note === "linkSent" || note === "linkFailed" ? (
              <p className="mono text-xs" style={{ marginBottom: "1rem",
                   color: note === "linkSent" ? "var(--ok)" : "var(--bad)" }}>
                {note === "linkSent"
                  ? "Посилання прив'язки надіслано тобі в Telegram — перешли його людині."
                  : "Telegram не взяв посилання: людині передати нічого. Натисни «посилання ще раз»."}
              </p>
            ) : null}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <Funnel steps={[
                { label: "Зареєструвались", n: funnel?.registered ?? 0, note: "почали з сайту або з бота" },
                { label: "Заповнили анкету", n: funnel?.profiled ?? 0, note: "є рядок у profiles" },
                { label: "Прив'язали Telegram", n: funnel?.connected ?? 0, note: "без цього добірку нікуди слати" },
                { label: "Отримали добірку", n: funnel?.delivered ?? 0, note: "хоч одна доставлена" },
                { label: "Відповіли на неї", n: funnel?.reacted ?? 0, note: "«ще п'ять» або «не те»" },
                { label: "Подались", n: funnel?.applied ?? 0, note: "натиснули «Податися» хоч раз" },
              ]} />
              <div className="card overflow-x-auto">
                <table className="board">
                  <thead>
                    <tr><th>людина</th><th>прийшла</th><th>анкета</th><th>TG</th>
                        <th className="num">добірок</th><th className="num">подач</th>
                        <th>реакції</th><th>остання дія</th></tr>
                  </thead>
                  <tbody>
                    {people.map((x) => (
                      <tr key={x.id} className="stripe"
                          style={{ "--c": x.sent > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                        <td><Person nick={x.nick} name={x.person} id={x.id} /></td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.created_at?.slice(0, 10) ?? "—"}
                        </td>
                        <td className="text-xs">
                          {/* «Немає анкети» має означати те саме, що й у підборі:
                              нема З ЧОГО шукати. Написана роль — така сама вісь,
                              як обрана (hasSearchSignal у scanner/src/match.ts бере
                              будь-яку з двох), тож людина, яка написала «Junior
                              regulatory affairs» і не тиснула жодної кнопки,
                              стояла тут із поміткою «немає» — і виглядала
                              загубленою, хоча добірку отримує справно. */}
                          {sphereCount(x.spheres) > 0
                            ? `${sphereCount(x.spheres)} ${sphereCount(x.spheres) < 5 ? "ролі" : "ролей"} · ${x.country ?? x.locale}`
                            : x.custom_role?.trim()
                              ? `своя роль · ${x.country ?? x.locale}`
                              : <span className="tag tag-warn">немає</span>}
                        </td>
                        {/* Крапка, а не плашка: «ні» жовтим кольором стояло в
                            половині рядків і читалось як попередження в
                            кожному з них. Стан бінарний — його досить
                            показати кольором, а слово лишити для читалок. */}
                        <td className="text-xs">
                          <span aria-hidden="true"
                                style={{ display: "inline-block", width: "6px", height: "6px",
                                         borderRadius: "50%",
                                         background: x.tg ? "var(--ok)" : "var(--rule-2)" }} />
                          <span className="sr-only">{x.tg ? "прив'язано" : "немає"}</span>
                        </td>
                        <td className="num text-xs">{x.sent}</td>
                        {/* Подачі окремим стовпцем, а не серед реакцій: реакція
                            каже, що людина нас почула, а подача — що ми були
                            їй потрібні. Це різні речі, і зливати їх в одну
                            колонку означало б втратити другу. */}
                        <td className="num text-xs"
                            style={{ color: x.applied > 0 ? "var(--ok)" : "var(--faint)" }}>
                          {x.applied > 0 ? x.applied : "—"}
                        </td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.more + x.nope === 0 ? "—" : (
                            <>
                              {x.more > 0 && <span style={{ color: "var(--ok)" }}>+{x.more}</span>}
                              {x.more > 0 && x.nope > 0 && " / "}
                              {x.nope > 0 && <span style={{ color: "var(--bad)" }}>−{x.nope}</span>}
                            </>
                          )}
                        </td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.last_seen?.slice(0, 16).replace("T", " ") ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Сторінки числами, а не «далі».
                  Власник шукає конкретну людину, а не гортає підряд: із «далі»
                  до п'ятої сторінки треба чотири переходи, з номером — один.
                  Показуємо всі номери, поки їх мало, і вікно навколо поточної,
                  коли стане багато. */}
              {pages > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                    {(pageNo - 1) * PEOPLE_PAGE + 1}–{Math.min(pageNo * PEOPLE_PAGE, peopleTotal)} з {peopleTotal}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: pages }, (_, i) => i + 1)
                      .filter((n) => pages <= 9 || n === 1 || n === pages || Math.abs(n - pageNo) <= 2)
                      .map((n, i, kept) => (
                        <span key={n} className="flex items-center gap-2">
                          {i > 0 && kept[i - 1] !== n - 1 && (
                            <span className="mono text-xs" style={{ color: "var(--muted)" }}>…</span>
                          )}
                          <Link href={peopleHref(filter.id, n)}
                                className="mono text-xs"
                                style={{ color: n === pageNo ? "var(--ember)" : "var(--muted)",
                                         textDecoration: n === pageNo ? "underline" : "none" }}>
                            {n}
                          </Link>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </Block>

          {/* Чи повертаються люди.
              Стоїть одразу під лійкою навмисно: лійка каже, скільки дійшло
              до першої добірки, а це — чи прийшов хтось на другу. Без
              другого числа перше нічого не означає. */}
          <Block id="retention" title="Чи повертаються"
                 lede="Подача рахується за днем, коли людина її зробила, а не за днем, коли ми надіслали картку. Активний день — це подача, реакція під добіркою або запит «ще п'ять»: отримати повідомлення це наша дія, а не її.">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card overflow-x-auto">
                <table className="board">
                  <thead>
                    <tr><th>день</th><th className="num">карток</th><th className="num">кому</th>
                        <th className="num">активні</th><th className="num">подач</th></tr>
                  </thead>
                  <tbody>
                    {byDay.length === 0 ? (
                      <tr><td colSpan={5} style={{ color: "var(--muted)" }}>ще жодної доставки</td></tr>
                    ) : byDay.map((r, i) => (
                      <tr key={r.d} className="stripe"
                          style={{ "--c": r.active > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                        <td className="mono text-xs">
                          {r.d}
                          {/* Сьогоднішній рядок ще не повний: доставка йде за
                              місцевою годиною кожного, тож частина дня попереду. */}
                          {i === 0 && <span className="ml-2" style={{ color: "var(--faint)" }}>день триває</span>}
                        </td>
                        <td className="num text-xs">{r.cards}</td>
                        <td className="num text-xs">{r.reached}</td>
                        <td className="num text-xs" style={{ color: "var(--ink)" }}>{r.active}</td>
                        <td className="num text-xs" style={{ color: r.applies > 0 ? "var(--ok)" : "var(--faint)" }}>
                          {r.applies > 0 ? r.applies : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card overflow-x-auto">
                <table className="board">
                  <thead>
                    <tr><th>перша добірка</th><th className="num">людей</th>
                        <th className="num">день 2</th><th className="num">день 3</th><th className="num">день 7</th></tr>
                  </thead>
                  <tbody>
                    {cohorts.length === 0 ? (
                      <tr><td colSpan={5} style={{ color: "var(--muted)" }}>ще жодної когорти</td></tr>
                    ) : cohorts.map((c) => (
                      <tr key={c.d0} className="stripe"
                          style={{ "--c": "var(--rule-2)" } as React.CSSProperties}>
                        <td className="mono text-xs">{c.d0}</td>
                        <td className="num text-xs">{c.n}</td>
                        {([["+1 day", c.d2], ["+2 day", c.d3], ["+6 day", c.d7]] as const).map(([off, v]) => {
                          // Той день ще не настав — клітинка порожня, а не нуль.
                          const due = new Date(`${c.d0}T00:00:00Z`);
                          due.setUTCDate(due.getUTCDate() + Number(off.split(" ")[0]));
                          const arrived = due <= new Date();
                          return (
                            <td key={off} className="num text-xs"
                                style={{ color: !arrived ? "var(--faint)" : v > 0 ? "var(--ok)" : "var(--bad)" }}>
                              {!arrived ? "·" : `${v} · ${Math.round((v / Math.max(1, c.n)) * 100)}%`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Block>

          <Block id="users" title={`Користувачі · ${funnel?.registered ?? 0}`}
                 lede="Скільки нас усього і скільки прибуло за крок. На перших десятках людей стовпчики нічого не кажуть, тому поруч стоять числа."
                 right={
                   <div className="flex flex-wrap items-center gap-3">
                     {BUCKETS.map((b) => (
                       <Link key={b.id}
                             href={`/admin?${new URLSearchParams({
                               ...(range ? { range } : {}), ...(b.id === "day" ? {} : { bucket: b.id }),
                             })}#users`}
                             className="mono text-xs"
                             style={{ color: b.id === step.id ? "var(--ember)" : "var(--muted)",
                                      textDecoration: b.id === step.id ? "underline" : "none" }}>
                         {b.label}
                       </Link>
                     ))}
                   </div>
                 }>
            {peopleSteps.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                За обраний період не зареєструвався ніхто.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_1fr]">
                <Spark points={peopleSteps.map((x) => ({ d: x.d, v: x.nowTotal }))}
                       label="людей усього" />
                <div className="card overflow-x-auto">
                  <table className="board">
                    <thead>
                      <tr><th>{step.label.replace("по ", "")}</th>
                          <th className="num">прибуло</th><th className="num">усього</th></tr>
                    </thead>
                    <tbody>
                      {/* Найновіше згори: питання «скільки нас зараз» частіше за
                          «скільки було на початку». */}
                      {[...peopleSteps].reverse().map((x) => (
                        <tr key={x.d} className="stripe"
                            style={{ "--c": x.added > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                          <td className="mono text-xs">{x.d}</td>
                          <td className="num text-xs"
                              style={{ color: x.added > 0 ? "var(--ok)" : "var(--muted)" }}>
                            {x.added > 0 ? `+${x.added}` : "—"}
                          </td>
                          <td className="num text-xs">{num(x.nowTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Block>

          <Block id="growth" title="Як ми ростемо"
                 /* Підпис називає те, що Є, а не те, що просили.
                    Вісь обрізається найранішим рядком у базі, тож на молодому
                    продукті «останні 14 днів» обіцяли два тижні й малювали
                    п'ять точок — і графік виглядав зламаним, хоч ламався
                    саме підпис. */
                 lede={axis.length < DAYS
                   ? `Даних за ${axis.length} дн. — стільки, скільки ми ведемо облік.`
                   : `Останні ${DAYS} днів.`}
                 right={
                   <div className="flex flex-wrap items-center gap-3">
                     {RANGES.map((r) => (
                       <Link key={r.id}
                             href={r.days === DEFAULT_DAYS ? "/admin#growth" : `/admin?range=${r.id}#growth`}
                             className="mono text-xs"
                             style={{ color: r.days === DAYS ? "var(--ember)" : "var(--muted)",
                                      textDecoration: r.days === DAYS ? "underline" : "none" }}>
                         {r.label}
                       </Link>
                     ))}
                   </div>
                 }>
            <div className="grid gap-3 sm:grid-cols-3">
              <Spark points={growth.jobs} label="вакансій у кеші" />
              <Spark points={growth.companies} label="компаній у скані" />
              <Spark points={growth.people} label="людей усього" />
              {/* Єдина картка зі стовпчиками, і це навмисно: рахунок за добу,
                  де день без дотиків має читатись нулем. Решта — накопичення. */}
              <Spark points={growth.taps} label="дотиків у боті за день" kind="daily" />
            </div>
          </Block>

          <Block id="learning" title="Самонавчання"
                 lede="Що система міняє в собі без мене: коли наступний прогін, і як пройшов останній.">
            <div className="card overflow-x-auto px-6 py-5">
              <table className="board">
                <thead>
                  <tr><th>що</th><th>розклад</th><th>наступний</th><th>робить</th></tr>
                </thead>
                <tbody>
                  {learning.map((x) => {
                    const nxt = nextRun(x.days, x.hour, new Date());
                    return (
                      <tr key={x.unit}>
                        <td className="text-xs">{x.name}</td>
                        <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.days.length > 1 ? "Пн–Пт" : DAY_NAME[x.days[0]!]} {String(x.hour).padStart(2, "0")}:00
                        </td>
                        <td className="mono text-xs"
                            style={{ color: nxt.inDays === 0 ? "var(--ember)" : undefined }}>
                          {nxt.label}
                          <span style={{ color: "var(--muted)" }}>
                            {nxt.inDays === 0 ? " · сьогодні" : ` · через ${nxt.inDays} дн.`}
                          </span>
                        </td>
                        <td className="text-xs" style={{ color: "var(--ink-2)" }}>{x.what}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 max-w-prose text-xs" style={{ color: "var(--muted)" }}>
                Розклад живе в systemd на сервері (<span className="mono">scanner/deploy</span>),
                а не в базі — тут він повторений списком. Жодна з цих речей не міняє
                нічого сама: самоперегляд і розвідка лише кладуть пропозицію в блок
                нижче, а вмикає її людина.
              </p>
            </div>

            {/* Як пройшло. Досі панель показувала ОДИН останній рядок, і
                питання «а раніше бувало інакше?» не мало відповіді взагалі. */}
            <div className="card mt-3 overflow-x-auto px-6 py-5">
              <h4 className="eyebrow">Останні прогони скану</h4>
              <table className="board mt-3">
                <thead>
                  <tr><th>початок</th><th>стан</th><th className="num">вакансій</th>
                      <th className="num">компаній</th><th>щабель</th></tr>
                </thead>
                <tbody>
                  {runs.length === 0 && (
                    <tr><td colSpan={5} className="text-sm" style={{ color: "var(--muted)" }}>
                      Жодного прогону ще не було.
                    </td></tr>
                  )}
                  {runs.map((r) => (
                    <tr key={r.started_at}>
                      <td className="mono text-xs">{r.started_at.slice(0, 16).replace("T", " ")}</td>
                      <td>
                        <span className={`tag ${r.status === "ok" ? "tag-ok"
                          : r.status === "failed" ? "tag-bad" : "tag-warn"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="num text-xs">{num(r.jobs_found ?? 0)}</td>
                      <td className="num text-xs">{num(r.distinct_companies ?? 0)}</td>
                      <td className="mono text-xs" style={{ color: "var(--muted)" }}>
                        {r.ladder_reached ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Tile n={learned?.applied ?? 0} label="пропозицій прийнято" />
              <Tile n={learned?.open ?? 0} label="чекають на рішення" />
              <Tile n={tuned?.people ?? 0} label="людей із власними вагами" />
            </div>
            <p className="mt-2 max-w-prose text-xs" style={{ color: "var(--muted)" }}>
              Власні ваги — це вивчене зі скарг «не те»: людина називає причину,
              і саме її вага росте для НЕЇ, а не для всіх. Стеля 3.0.
              {(learned?.dismissed ?? 0) > 0 && ` Відхилено пропозицій: ${learned!.dismissed}.`}
            </p>
          </Block>

          {proposals.length > 0 && (
            <Block id="proposals" title="Що пропоную змінити"
                   lede="Раз на тиждень система дивиться на власні дані. Кожна пропозиція, крім позначених «до відома», виконується одним дотиком.">
              <div className="flex flex-col gap-4">
                {(["high", "medium", "low"] as const).map((sev) => {
                  const rows = bySeverity(sev);
                  if (rows.length === 0) return null;
                  const doable = rows.filter((r) => r.kind !== "notice").length;
                  const head = sev === "high" ? "Варте уваги зараз"
                    : sev === "medium" ? "Не терміново" : "Прибирання";
                  return (
                    <div key={sev}>
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h3 className="font-medium">{head} · {rows.length}</h3>
                        {doable > 1 && (
                          <form action={applyAllProposals}>
                            <input type="hidden" name="severity" value={sev} />
                            <button className="btn px-3 py-2 text-xs">Застосувати все ({doable})</button>
                          </form>
                        )}
                      </div>
                      <div className="ruled card mt-3">
                        {rows.map((r) => (
                          <article key={r.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 px-6 py-5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <h4 className="font-medium">{r.title}</h4>
                                {r.kind === "notice" && <span className="tag tag-flat">до відома</span>}
                                {r.kind === "add_source" && <span className="tag tag-ok">нове джерело</span>}
                              </div>
                              <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{r.detail}</p>
                              {r.evidence && (
                                <p className="mono mt-2 text-xs" style={{ color: "var(--muted)" }}>{r.evidence}</p>
                              )}
                              {/* Рішення «брати чи ні» приймається очима, а не
                                  за числом. Без посилання власник мусив би
                                  копіювати адресу з тексту в браузер. */}
                              {r.kind === "add_source" && r.target && (
                                <a href={r.target} target="_blank" rel="noopener noreferrer"
                                   className="mono mt-2 inline-block text-xs hover:underline"
                                   style={{ color: "var(--ember)" }}>
                                  подивитись стрічку ↗
                                </a>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {r.kind !== "notice" && (
                                <form action={applyProposal}>
                                  <input type="hidden" name="id" value={r.id} />
                                  <button className="btn px-3 py-2 text-xs">
                                    {r.kind === "add_source" ? "Додати" : "Застосувати"}
                                  </button>
                                </form>
                              )}
                              <form action={dismissProposal}>
                                <input type="hidden" name="id" value={r.id} />
                                <button className="btn btn-quiet px-3 py-2 text-xs">
                                  {r.kind === "notice" ? "Прочитав" : "Не треба"}
                                </button>
                              </form>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Block>
          )}

          {broken.length > 0 && (
            <Block id="problems" title={`Проблеми джерел · ${broken.length}`}
                   lede="Згруповано за тим, що з цим можна зробити. Найбільша група не потребує нічого.">
              <div className="flex flex-col gap-3">
                {blocked.length > 0 && (
                  <details className="card px-6 py-5">
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                      <span className="font-medium">Нас заблокували або обмежили · {blocked.length}</span>
                      <span className="mono text-xs" style={{ color: "var(--ember)" }}>показати</span>
                    </summary>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
                      403 і 429 часто минають самі: інший заголовок, менша частота. Варте одного дотику.
                    </p>
                    <form action={recheckSome} className="mt-3">
                      <input type="hidden" name="kind" value="blocked" />
                      <button className="btn btn-quiet px-3 py-2 text-xs">Перевірити всі</button>
                    </form>
                    <div className="mt-3"><SourceTable rows={blocked.slice(0, 25)} total={blocked.length} /></div>
                  </details>
                )}

                {lost.length > 0 && (
                  <details className="card px-6 py-5">
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                      <span className="font-medium">Колись працювали, тепер ні · {lost.length}</span>
                      <span className="mono text-xs" style={{ color: "var(--ember)" }}>показати</span>
                    </summary>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
                      Це справжня втрата: компанія давала вакансії й перестала. Можливо, переїхала на іншу дошку.
                    </p>
                    <form action={recheckSome} className="mt-3">
                      <input type="hidden" name="kind" value="lost" />
                      <button className="btn btn-quiet px-3 py-2 text-xs">Перевірити всі</button>
                    </form>
                    <div className="mt-3"><SourceTable rows={lost.slice(0, 25)} total={lost.length} /></div>
                  </details>
                )}

                {neverWorked.length > 0 && (
                  <div className="card flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                    <div>
                      <h3 className="font-medium">Дошки, яких не існує · {neverWorked.length}</h3>
                      <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                        Жодна не дала жодної вакансії за весь час: їх зібрали з посилань у чужих
                        даних, не перевіривши. Система прибере їх сама після наступного прогону.
                      </p>
                    </div>
                    <form action={purgeNeverWorked}>
                      <button className="btn px-4 py-2 text-sm whitespace-nowrap">Прибрати зараз</button>
                    </form>
                  </div>
                )}
              </div>
            </Block>
          )}

          {/* Тиждень, а не весь час: список ріс без кінця й ставав журналом
              замість панелі. Понеділок цього тижня рахуємо явно через `%w`:
              `datetime('now','weekday 1','-7 day')` виглядає коротше, але в
              САМ понеділок дає попередній тиждень, і таблиця тихо показувала б
              на сім днів більше. */}
          <Block id="digests" title="Історія зводок"
                 lede="Що пішло людям щоранку й що вони на це відповіли.">
            <div className="card overflow-x-auto">
              <table className="board">
                <thead>
                  <tr><th>день</th><th className="num">людей</th><th className="num">вакансій</th>
                      <th className="num">просили ще</th><th className="num">«не те»</th></tr>
                </thead>
                <tbody>
                  {digests.length === 0 && (
                    <tr><td colSpan={5} className="text-sm" style={{ color: "var(--muted)" }}>
                      Жодної зводки ще не надіслано.
                    </td></tr>
                  )}
                  {digests.map((x) => {
                    const r = reactions.find((y) => y.d === x.d);
                    return (
                      <tr key={x.d}>
                        <td className="mono text-xs">{day(x.d)}</td>
                        <td className="num text-xs">{x.people}</td>
                        <td className="num text-xs">{x.jobs}</td>
                        <td className="num text-xs" style={{ color: (r?.more ?? 0) > 0 ? "var(--ok)" : undefined }}>
                          {r?.more ?? 0}
                        </td>
                        <td className="num text-xs" style={{ color: (r?.nope ?? 0) > 0 ? "var(--bad)" : undefined }}>
                          {r?.nope ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Block>

          {feedback.length > 0 && (
            <Block id="feedback" title={`Відгуки людей · ${feedback.length}`}
                   lede="Написане своїми словами. Кожен уже прилетів у Telegram — тут він лежить, щоб не загубитись.">
              <div className="ruled card">
                {feedback.map((f) => (
                  <article key={f.id} className="px-6 py-5">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="mono text-xs" style={{ color: "var(--ember)" }}>
                        {f.created_at.slice(0, 16).replace("T", " ")}
                      </span>
                      <span className="eyebrow">{f.locale}</span>
                      <Person nick={f.nick} name={f.person} id={f.user_id} />
                      {f.contact && <span className="mono text-xs">{f.contact}</span>}
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm" style={{ color: "var(--ink)" }}>
                      {f.message}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={replyToFeedback} className="flex flex-1 items-center gap-2">
                        <input type="hidden" name="id" value={f.id} />
                        <input name="reply" className="field flex-1 text-sm"
                               placeholder={f.contact?.startsWith("tg:")
                                 ? "Відповісти в Telegram…"
                                 : "Контакту немає — можна лише позначити розібраним"}
                               disabled={!f.contact?.startsWith("tg:")} />
                        <button type="submit" className="btn px-3 py-2 text-xs"
                                disabled={!f.contact?.startsWith("tg:")}>Надіслати</button>
                      </form>
                      <form action={dismissFeedback}>
                        <input type="hidden" name="id" value={f.id} />
                        <button type="submit" className="btn btn-quiet px-3 py-2 text-xs">Розібрано</button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            </Block>
          )}

          <Block id="sources" title="Джерела"
                 lede="Звідки взялись вакансії, що лежать у кеші. Рахується за тим, що справді доїхало, а не за тим, що налаштоване: джерело, яке мовчить, тут не з'явиться — і це про нього чесна відповідь.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FAMILIES.map((f) => {
                const row = families.find((x) => x.family === f.key);
                return (
                  <div key={f.key} className="card px-5 py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="mono text-2xl leading-none" style={{ color: "var(--ember)" }}>
                        {num(row?.jobs ?? 0)}
                      </div>
                      <div className="mono text-xs" style={{ color: "var(--muted)" }}>
                        {num(row?.feeds ?? 0)} шт.
                      </div>
                    </div>
                    <div className="eyebrow mt-2">{f.label}</div>
                    <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>{f.note}</p>
                    <p className="mono mt-2 text-xs"
                       style={{ color: (row?.fresh ?? 0) > 0 ? "var(--ok)" : "var(--muted)" }}>
                      {num(row?.fresh ?? 0)} за 3 дні
                    </p>
                  </div>
                );
              })}
            </div>

            {grouped.length > 0 && (
              /* Згорнуто за умовчанням.
                 Дві таблиці на 44 рядки займали більшу частину екрана щодня, а
                 розгортають їх лише коли щось зламалось — і саме «щось
                 зламалось» видно з лічильника мовчазних поруч, не розгортаючи.  */
              <details className="card mt-3 px-6 py-5">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-medium">Поіменно · {grouped.length}</h3>
                  <span className="mono text-xs"
                        style={{ color: grouped.some((f) => f.jobs === 0) ? "var(--bad)" : "var(--muted)" }}>
                    мовчазних: {grouped.filter((f) => f.jobs === 0).length}
                  </span>
                </summary>
                <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                  Усе, звідки ми тягнемо дані. Рубрики однієї дошки згорнуті в неї саму —
                  «DOU · Java» і «DOU · HR» це один DOU. Компанії на ATS згорнуті по
                  провайдеру. Джерело, що не дало жодного рядка, лишається у списку: мовчазну
                  дошку не видно більше ніде.
                </p>

                <FeedTable rows={general} title="Загальні — бачать усі" />
                <FeedTable rows={regional} title="Регіональні — бачить лише своя країна" />
              </details>
            )}

            <form action={addSources} className="card mt-3 flex flex-col gap-3 px-5 py-5">
              <div>
                <h3 className="font-medium">Додати джерело посиланням</h3>
                <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                  Вставляй те, що бачив у браузері: сторінку вакансій компанії, стрічку дошки,
                  просто «Careers». Рід джерела, назву й країну визначаємо самі. Можна кілька
                  посилань — по одному на рядок.
                </p>
              </div>
              <textarea name="links" rows={3} required
                        className="field mono w-full text-xs"
                        placeholder={"https://boards.greenhouse.io/deepl\nhttps://dou.ua/vacancies/feeds/?category=Python"} />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton busy="Перевіряю…">Додати</SubmitButton>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Не більше {INTAKE_LIMIT} за раз. Кожне перевіряємо до запису: адреса, що не
                  віддає жодної вакансії, у базу не потрапляє — але внизу буде видно чому.
                </p>
              </div>
            </form>

            {getro.length > 0 && (
              <details className="card mt-3 px-6 py-5">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">
                    Колекції Getro · {getro.length}
                    {getroOff > 0 && (
                      <span className="ml-2 font-normal" style={{ color: "var(--muted)" }}>
                        і ще {getroOff} знайдених, але зупинених
                      </span>
                    )}
                  </span>
                  <span className="mono text-xs" style={{ color: "var(--ember)" }}>показати</span>
                </summary>
                <p className="mt-2 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                  Борди екосистем фондів: jobs.solana.com, jobs.avax.network і подібні. Це
                  головне джерело компаній, яких ми ще не знаємо — 80% посилань там ведуть
                  просто в ATS роботодавця. Новий борд додається сюди звичайним посиланням.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="board">
                    <thead>
                      <tr><th>колекція</th><th>№</th><th className="num">вакансій у кеші</th></tr>
                    </thead>
                    <tbody>
                      {getro.map((x) => (
                        <tr key={x.collection_id} className="stripe"
                            style={{ "--c": x.jobs > 0 ? "var(--ok)" : "var(--warn)" } as React.CSSProperties}>
                          <td className="text-xs">
                            {x.url
                              ? <a href={x.url} target="_blank" rel="noreferrer"
                                   className="hover:underline" style={{ color: "var(--ember)" }}>{x.label}</a>
                              : x.label}
                          </td>
                          <td className="mono text-xs" style={{ color: "var(--muted)" }}>{x.collection_id}</td>
                          <td className="num text-xs">{x.jobs || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {intakeOk > 0 && intakeLive.length === 0 && (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                За тиждень прийнято джерел: {intakeOk}. Нерозібраних немає.
              </p>
            )}

            {intakeLive.length > 0 && (
              <div className="ruled card mt-3">
                <div className="px-6 pb-1 pt-5">
                  <h3 className="font-medium">
                    Посилання, які не прийнялись · {intakeLive.length}
                    {intakeOk > 0 && (
                      <span className="ml-2 font-normal" style={{ color: "var(--muted)" }}>
                        і ще {intakeOk} прийнятих за тиждень
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 max-w-prose text-sm" style={{ color: "var(--ink-2)" }}>
                    Тільки те, з чим треба щось зробити: вдалі рядки нічого не пояснюють, бо
                    з ними вже все гаразд, — а займали більшу частину блоку. Тут видно, ЧОМУ
                    посилання не прийнялось, і що з цим робити. Половина відмов тимчасова
                    (дошка віддала 403 під навантаженням, стрічка була порожня між
                    публікаціями), тож рядок можна перевірити ще раз. Розібрався — прибери.
                  </p>
                  {intakeHidden > 0 && (
                    <p className="mono mt-2 text-xs" style={{ color: "var(--muted)" }}>
                      знято автоматично: {intakeHidden} — джерело вже підключене
                      під іншою адресою стрічки, або домен виміряно й визнано
                      недоступним
                    </p>
                  )}
                </div>
                {intakeLive.map((x) => {
                  const v = VERDICT[x.verdict] ?? { tag: "tag-flat", text: x.verdict };
                  return (
                    <div key={x.url} className="px-6 py-4">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                          {x.at.slice(5, 16).replace("T", " ")}
                        </span>
                        <span className={`tag ${v.tag}`}>{v.text}</span>
                        <span className="mono min-w-0 flex-1 truncate text-xs" title={x.url}>{x.url}</span>
                        {/* Повторювати вдалу спробу нема сенсу: джерело вже
                            в базі, і друга спроба дасть лише «вже було». */}
                        {x.verdict !== "added" && (
                          <form action={retryIntake}>
                            <button className="mono text-xs hover:underline" style={{ color: "var(--ember)" }}>
                              спробувати ще
                            </button>
                            <input type="hidden" name="id" value={x.id} />
                          </form>
                        )}
                        <form action={forgetIntake}>
                          <button className="mono text-xs hover:underline" style={{ color: "var(--muted)" }}>
                            прибрати
                          </button>
                          <input type="hidden" name="id" value={x.id} />
                        </form>
                      </div>
                      {x.note && (
                        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{x.note}</p>
                      )}
                      {/* Причина без наступного кроку — це та сама відмова,
                          лише довшими словами. */}
                      {x.fix && (
                        <p className="mt-1 text-sm" style={{ color: "var(--ink)" }}>
                          <span className="eyebrow mr-2">що робити</span>{x.fix}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Block>

          {/* Заголовок каже «країни», а сім дошок мають країну «*» — вони
              глобальні, тобто рівно навпаки: їх бачать усі. Через це Remote3,
              Remotech і Remote Backend Jobs читались як національні. Назва
              блоку тепер описує обидва види, а країна кожної дошки стоїть у
              таблиці окремою колонкою. */}
          <Block id="boards" title="Дошки"
                 lede="Дошка — не агрегатор: вакансія з неї ніде більше не існує. Національну бачать лише люди з тієї ж країни, глобальну — усі.">
            <div className="grid gap-3 sm:grid-cols-4">
              <Tile n={spend?.boards ?? 0} label="дошок увімкнено" />
              <Tile n={spend?.countries ?? 0} label="країн" />
              <Tile n={spend?.boardJobs ?? 0} label="вакансій із дошок" />
              <Tile n={spend?.localJobs ?? 0} label="з країною в кеші" />
            </div>

            <div className="card mt-3 px-5 py-4">
              <p className="eyebrow">країни, де є люди, а дошок немає</p>
              {gaps.length > 0 ? (
                <>
                  <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
                    {gaps.map((g) => `${g.country} · ${g.people}`).join("   ")}
                  </p>
                  <p className="mt-2 max-w-prose text-xs" style={{ color: "var(--muted)" }}>
                    Три перші з цього списку стають запитами до твіттера щонеділі: розвідка
                    шукає дошку саме для них і приносить її сюди пропозицією з високою вагою.
                    Чекати не обов’язково — стрічку можна додати посиланням будь-коли.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  Порожньо. Кожна країна, з якої в нас є людина, має свою дошку.
                </p>
              )}
              {/* Країна виводиться з написаного міста один раз, при збереженні
                  профілю. Словник місць росте — і кожен, хто написав місто
                  раніше, лишається без країни, поки його не перерахують. */}
              <form action={recountCountries} className="mt-3">
                <button className="btn btn-quiet px-3 py-2 text-xs">
                  Перерахувати країни з написаних міст
                </button>
              </form>
            </div>

            <BoardTable groups={boardGroups.filter((g) => g.country === "*")}
                        title="Весь світ — бачать усі" />
            <BoardTable groups={boardGroups.filter((g) => g.country !== "*")}
                        title="Країни — бачить лише своя" />
            <form action={addBoard} className="card mt-3 flex flex-wrap items-end gap-3 px-5 py-4">
              <label className="flex flex-col gap-1">
                <span className="eyebrow">країна</span>
                <input name="country" placeholder="PL" maxLength={2} required
                       className="field mono w-20 uppercase" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">назва</span>
                <input name="label" placeholder="JustJoin.IT" required className="field w-44" />
              </label>
              <label className="flex min-w-60 flex-1 flex-col gap-1">
                <span className="eyebrow">адреса RSS</span>
                <input name="url" type="url" placeholder="https://…/feed" required className="field mono w-full text-xs" />
              </label>
              <button className="btn px-4 py-2 text-sm">Додати</button>
              <p className="w-full text-xs" style={{ color: "var(--muted)" }}>
                Стрічку перевіряємо до запису: адреса, що не віддає жодної вакансії, у базу не потрапляє.
              </p>
            </form>
          </Block>

          <Block id="spend" title="Витрати"
                 lede="Долари за таблицею цін Anthropic; прогноз — середнє за тиждень × 30.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Tile n={usd(spend?.usdToday ?? 0)} label="сьогодні" />
              <Tile n={usd(spend?.usdWeek ?? 0)} label="за 7 днів" />
              <Tile n={usd(spend?.usdMonth ?? 0)} label="за 30 днів" />
              <Tile n={usd(((spend?.usdWeek ?? 0) / 7) * 30)} label="прогноз на місяць" />
              <Tile n={spend?.failed ?? 0} label="невдалих звернень" accent={(spend?.failed ?? 0) > 0} />
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              {(spend?.callsWeek ?? 0) === 0
                ? "За тиждень модель не викликалась."
                : `${num(spend?.calls ?? 0)} звернень сьогодні, ${num(spend?.callsWeek ?? 0)} за тиждень.`}
            </p>
          </Block>

          
          <Block id="releases" title="Історія версій"
                 lede="Що змінилося для людей. Збирається з комітів, службові — мерджі, документація, перегенерації — відсіяні.">
            <div className="ruled card">
              {RELEASES.slice(0, 7).map((r, i) => (
                <details key={r.date} className="px-6 py-4" open={i === 0}>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4">
                    <span className="mono text-sm" style={{ color: "var(--ember)" }}>{r.date}</span>
                    <span className="text-sm">{r.changes.length} змін</span>
                    <span className="text-sm" style={{ color: "var(--muted)" }}>{r.changes[0].subject}</span>
                  </summary>
                  {/* Довгий день згортаємо до шести рядків: історія версій —
                      це «що змінилось для людей», а не журнал роботи. Решта
                      лишається на відстані одного кліку. */}
                  <ul className="mt-3 flex flex-col gap-1">
                    {r.changes.slice(0, KEY_CHANGES).map((c) => (
                      <li key={c.hash} className="flex gap-3 text-sm">
                        <span className="mono text-xs" style={{ color: "var(--muted)" }}>{c.hash}</span>
                        <span style={{ color: "var(--ink-2)" }}>{c.subject}</span>
                      </li>
                    ))}
                  </ul>
                  {r.changes.length > KEY_CHANGES && (
                    <details className="mt-3">
                      <summary className="mono cursor-pointer text-xs" style={{ color: "var(--ember)" }}>
                        ще {r.changes.length - KEY_CHANGES}
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {r.changes.slice(KEY_CHANGES).map((c) => (
                          <li key={c.hash} className="flex gap-3 text-sm">
                            <span className="mono text-xs" style={{ color: "var(--muted)" }}>{c.hash}</span>
                            <span style={{ color: "var(--ink-2)" }}>{c.subject}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {r.chores > 0 && (
                    <p className="mono mt-3 text-xs" style={{ color: "var(--faint)" }}>
                      і ще {r.chores} службових: мерджі, документація, перегенерація цього списку
                    </p>
                  )}
                </details>
              ))}
            </div>
          </Block>

        </div>
      </main>
    </>
  );
}
