import { all } from "@/lib/db";
import { siteStats } from "@/lib/site-stats";
import { INDUSTRIES, SPHERES } from "@/lib/vocab";

/**
 * Публічні сторінки-добірки: єдиний бік продукту, який може знайти пошук.
 *
 * Стан на 02.09: у карті сайту двадцять адрес — п'ять сторінок на чотири
 * мови. За входом при цьому лежить сімнадцять тисяч живих вакансій і 2 621
 * компанія, і жодна з них не породжує сторінки, яку можна знайти в Google.
 * Для продукту про роботу це найбільший безкоштовний канал, і він стояв
 * незайманим.
 *
 * Чому добірки, а не сторінка на кожну вакансію. Розмітка JobPosting вимагає
 * опису на самій сторінці, а опис є в 19% рядків кеша: сімнадцять тисяч
 * сторінок, з яких чотири п'ятих порожні, тягнули б униз ті, що в нас
 * справді є. Тут навпаки: вміст сторінки — сам перелік, він живий і
 * оновлюється щодня.
 *
 * Англійською й без перекладів. Назви вакансій ми не перекладаємо ніде (це
 * рішення з ROADMAP), тож чотири мовні версії того самого переліку були б
 * чотирма копіями англійського тексту з різними шапками — саме те, що пошук
 * називає дублем.
 */

export interface JobsPage {
  /** Відрізок адреси: /jobs/<slug>. */
  slug: string;
  /** Тег у кеші, за яким збираємо перелік. */
  tag: string;
  /** Заголовок сторінки й <title>. */
  title: string;
  /** Одне речення під заголовком: що саме тут і для кого. */
  lede: string;
}

const label = (id: string): string =>
  [...INDUSTRIES, ...SPHERES].find((v) => v.id === id)?.en ?? id;

/**
 * Перелік сторінок. Ті самі теги, за якими працює підбір, — інакше сторінка
 * обіцяла б добірку, якої система зібрати не вміє.
 */
export const JOBS_PAGES: JobsPage[] = [
  { slug: "web3", tag: "web3", title: "Web3 and crypto jobs",
    lede: "Open roles at crypto companies: protocols, wallets, exchanges and the funds behind them." },
  { slug: "ai", tag: "ai", title: "AI jobs",
    lede: "Open roles at companies building with machine learning, from research labs to applied teams." },
  { slug: "fintech", tag: "fintech", title: "Fintech jobs",
    lede: "Open roles in payments, banking, lending, trading and insurance." },
  { slug: "health", tag: "health", title: "Health and bio jobs",
    lede: "Open roles in healthcare, medical devices, biotech and pharma." },
  { slug: "defence", tag: "defence", title: "Defence tech jobs",
    lede: "Open roles in defence, aerospace and dual-use technology." },
  { slug: "ecommerce", tag: "ecommerce", title: "E-commerce jobs",
    lede: "Open roles at retail, marketplace and direct-to-consumer companies." },
  { slug: "games", tag: "games", title: "Games jobs",
    lede: "Open roles in game studios and the tools around them." },
  { slug: "nonprofit", tag: "nonprofit", title: "Non-profit jobs",
    lede: "Open roles at foundations, NGOs and humanitarian organisations." },
  { slug: "remote", tag: "remote", title: "Remote jobs",
    lede: "Roles the employer itself marks as remote. No guessing from the city field." },
  { slug: "engineering", tag: "engineering", title: "Engineering jobs",
    lede: "Backend, frontend, mobile, platform, infrastructure and SRE roles." },
  { slug: "data-ai", tag: "data-ai", title: "Data and machine learning jobs",
    lede: "Data engineering, analytics, research and MLOps roles." },
  { slug: "design", tag: "design", title: "Design jobs",
    lede: "Product, UX, brand and motion design roles." },
  { slug: "product", tag: "product", title: "Product jobs",
    lede: "Product management and product ownership roles." },
  { slug: "marketing", tag: "marketing", title: "Marketing and growth jobs",
    lede: "Growth, content, brand, SEO and communications roles." },
  { slug: "sales", tag: "sales", title: "Sales jobs",
    lede: "Account executive, account management, customer success and solutions roles." },
  { slug: "devrel", tag: "devrel", title: "Developer relations and community jobs",
    lede: "Developer advocacy, community management and evangelism roles." },
  { slug: "security", tag: "security", title: "Security jobs",
    lede: "Application security, infrastructure security, penetration testing and GRC roles." },
  { slug: "operations", tag: "operations", title: "Operations jobs",
    lede: "Programme, project and people operations roles." },
  { slug: "partnerships", tag: "partnerships", title: "Partnerships and BD jobs",
    lede: "Business development, alliances and ecosystem roles." },
  { slug: "qa", tag: "qa", title: "QA and testing jobs",
    lede: "Quality assurance, test engineering and SDET roles." },
  { slug: "support", tag: "support", title: "Support jobs",
    lede: "Technical support, helpdesk and customer service roles." },
  { slug: "finance-legal", tag: "finance-legal", title: "Finance and legal jobs",
    lede: "Accounting, controlling, tax, counsel and compliance roles." },
];

export const pageBySlug = (slug: string): JobsPage | undefined =>
  JOBS_PAGES.find((p) => p.slug === slug);

/** Людська назва тега — для перехресних посилань між сторінками. */
export const tagLabel = (tag: string): string => label(tag);

export interface ListedJob {
  id: string; title: string; company: string; location: string | null;
  remote: number; url: string; posted_at: string | null;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null;
  source: string;
}

/**
 * Скільки показуємо. Шістдесят — це сторінка, яку людина ще гортає, і один
 * запит до D1 з відомою стелею. Читання — наше вузьке місце, тож числа тут
 * не «скільки влізе», а «скільки має сенс».
 */
export const PAGE_SIZE = 60;

/**
 * Вікно свіжості те саме, що й у доставці: три доби. Кеш нічого не видаляє
 * одразу, тож без цієї умови сторінка показувала б вакансії, яких на дошці
 * вже немає, а обіцянка «тільки живі посилання» стоїть на головній.
 *
 * Тег шукається через LIKE з лапками, а не через `json_each`, і це не
 * стилістика. Поміряно на живій базі 02.09: той самий перелік коштує 91 125
 * прочитаних рядків через `json_each` і 33 341 через LIKE. Лапки обов'язкові
 * (`%"qa"%`), інакше «qa» знайдеться всередині «security». Той самий прийом
 * з тієї ж причини стоїть в `onTopicSql` у сканері.
 */
const like = (tag: string): string => `%"${tag}"%`;

export async function jobsFor(tag: string, limit = PAGE_SIZE): Promise<ListedJob[]> {
  return all<ListedJob>(
    `SELECT id,title,company,location,remote,url,posted_at,
            salary_min,salary_max,salary_currency,source
       FROM jobs_cache
      WHERE fetched_at >= datetime('now','-3 day')
        AND tags LIKE ?
      ORDER BY posted_at DESC, fetched_at DESC
      LIMIT ?`, like(tag), limit);
}

/** Скільки таких вакансій усього. Те саме джерело, що й на сторінці-вузлі. */
export const countFor = async (tag: string): Promise<number> =>
  (await countsByTag()).get(tag) ?? 0;

/**
 * Числа для ВСІХ добірок. Рахує їх сканер, ми лише читаємо.
 *
 * Перший варіант цієї сторінки питав двадцять два числа двадцятьма двома
 * запитами по 83 408 прочитаних рядків кожен, тобто одне відкриття коштувало
 * 1.8 мільйона. Другий рахував їх одним запитом за 147 842. Третій, оцей,
 * не рахує нічого: числа лежать у `site_stats`, куди їх кладе скан.
 */
export const countsByTag = async (): Promise<Map<string, number>> =>
  (await siteStats()).tagCounts;
