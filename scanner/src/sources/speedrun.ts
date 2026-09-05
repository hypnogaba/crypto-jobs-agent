/**
 * Мережа талантів a16z speedrun — `speedrun-talent-network.com`.
 *
 * Це перше джерело, яке САМЕ пропонує себе машині: у нього є сторінка
 * `/developers`, версійований REST `/api/v1`, повна специфікація OpenAPI 3.1
 * за адресою `/api/v1/openapi.json` і власний MCP-сервер. Без ключа, без
 * реєстрації, з відкритим CORS. Ми не обходимо захист і не розбираємо
 * верстку — ми читаємо задокументований інтерфейс.
 *
 * Що там лежить (виміряно живими запитами 05.09.2026):
 *
 *   48 159 відкритих ролей у `scope=everywhere`, з них 18 502 у портфелі a16z
 *   15 070 ролей із НАЗВАНОЮ вилкою — у нашому кеші вилку має заледве кожна сьома
 *      800 компаній, і за кожним «Apply» стоїть справжній ATS роботодавця
 *       52 курованих колекції: галузі, міста, інвестори, сигнали
 *
 * Головна цінність не в обсязі. Вакансії звідси — передрук: оригінал лежить
 * на Greenhouse чи Ashby самої компанії, тож за нашим власним правилом це
 * агрегатор, а не дошка. Але агрегатор із зарплатою, функцією й рівнем у
 * готових полях, і — головне — зі списком восьмисот роботодавців, кожного з
 * яких можна забрати собі назавжди (`discover-speedrun.ts`).
 */
import { fetchJson, type FetchOptions } from "../http.js";
import type { RawJob } from "../types.js";

const BASE = "https://speedrun-talent-network.com/api/v1";

/** Ім'я джерела. Префікс `aggregator:` вирішує, як воно рахується в панелі. */
export const SPEEDRUN_SOURCE = "aggregator:speedrun";

/**
 * `?source=` — вони просять його передавати, і ми передаємо.
 *
 * Це не косметика: параметр ставить `utm_source=nextrole&utm_medium=agent` на
 * кожне посилання вакансії, тобто наші переходи стають для них видимими. Саме
 * так виглядає атрибуція, якої вимагають RemoteOK і Remotive, — правило 5
 * каталогу джерел. Тому utm ми НЕ зрізаємо: посилання лишається таким, яким
 * його віддав власник даних.
 */
const AGENT = "nextrole";

/** Скільки віддає одна сторінка. Не наш вибір: параметра розміру немає взагалі. */
const PER_PAGE = 50;

/**
 * Стеля сторінок на прогін.
 *
 * Сам API дозволяє `page` до 200, тобто 10 000 ролей за запит. Нам стільки не
 * треба: при `sort=new` свіжі чотирнадцять днів займали 1 702 ролі — 35
 * сторінок (виміряно 05.09). Шістдесят сторінок це подвійний запас на день,
 * коли ринок прокинеться, і водночас тверда межа, якщо їхнє сортування колись
 * зламається.
 */
const MAX_PAGES = 60;

/** Скільки днів вважаються свіжими. Та сама стеля, що й у `loadConfig`. */
const FRESH_DAYS = 14;

/**
 * Ширина вибірки.
 *
 * `everywhere` — найширше з трьох: портфель a16z плюс ширший ринок. Виміряно,
 * що в межах свіжого вікна воно віддає РІВНО ті самі рядки, що й `portfolio`
 * (сторінки 0, 20 і 34 збіглися id-в-id): усі 29 657 ролей «поза портфелем»
 * опубліковані давніше за наші чотирнадцять днів. Тобто зараз ширина нічого
 * не додає й нічого не коштує — але додасть того дня, коли вони почнуть
 * оновлювати й цей шар.
 */
const SCOPE = "everywhere";

interface ApiJob {
  id?: string;
  title?: string;
  company?: string;
  company_slug?: string;
  url?: string;
  location?: string | null;
  workplace_type?: string | null;
  employment_type?: string | null;
  remote?: boolean;
  stealth?: boolean;
  comp_min?: number | null;
  comp_max?: number | null;
  comp_currency?: string | null;
  comp_period?: string | null;
  published_at?: string | null;
}

interface JobsPage {
  jobs?: ApiJob[];
  total?: number;
  total_pages?: number;
}

/**
 * Дата приходить у двох виглядах одночасно: `2026-09-05T01:31:54-04:00` і
 * `2026-08-21T22:49:34.298Z`. Обидва законні, обидва трапляються в одній
 * відповіді — тому розбираємо конструктором, а не власним взірцем.
 */
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Найменша й найбільша річна сума, які взагалі бувають. Як у `boards.ts`. */
const MIN_YEARLY = 1_000;
const MAX_YEARLY = 5_000_000;

/** Годин на рік у повній зайнятості. Стандартні 40 × 52. */
const HOURS_PER_YEAR = 2080;

/**
 * Сума в річну — за періодом, який назвало саме джерело.
 *
 * Період буває чотирьох видів, і всі чотири трапляються насправді (600
 * виміряних ролей): `null` у 561, `hour` у 21, `year` у 16, `month` у 2.
 *
 * Порожній період означає «на рік», і це не здогад за величиною: серед 156
 * порожніх найменша сума була 71 000, найбільша 400 000, і жодної нижче
 * дванадцяти тисяч. Усі малі числа — 24, 26, 45 — приходять із чесно
 * названим `hour`. Тому вгадувати нічого не доводиться, і саме тому ми
 * НЕ вгадуємо: «Data Verification Operator, 24 USD/hour» без множника став
 * би вакансією на 24 долари на рік і зник би з будь-якого фільтра.
 */
export function yearlyComp(
  value: number | null | undefined, period: string | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  const p = (period ?? "").toLowerCase();
  const factor = p === "hour" ? HOURS_PER_YEAR : p === "month" ? 12 : p === "week" ? 52 : 1;
  // Незнайомий період — не привід множити навмання: беремо як річну й
  // лишаємо межам вирішувати, чи це взагалі схоже на зарплату.
  const n = Math.round(value * factor);
  return n >= MIN_YEARLY && n <= MAX_YEARLY ? n : null;
}

/**
 * Чи справді роль віддалена.
 *
 * Поле `remote` і поле `workplace_type` іноді сперечаються: на 600 виміряних
 * ролях один рядок мав `remote: true` при `workplace_type: "OnSite"`. Коли
 * джерело саме собі суперечить, перемагає конкретніше — тип робочого місця.
 * І пишуть його двома способами, `OnSite` та `Onsite`, тож порівнюємо
 * приведеним до нижнього регістру, а не рядком.
 */
export function isRemoteRole(j: ApiJob): boolean {
  const w = (j.workplace_type ?? "").toLowerCase();
  if (w === "onsite" || w === "hybrid") return false;
  if (w === "remote") return true;
  return j.remote === true;
}

/**
 * Одна роль API → наш запис. `null` означає «цей рядок брати не можна».
 *
 * Приховані компанії (`stealth`) відкидаємо свідомо: назва в них замаскована
 * самим бортом, компанія називається «Stealth», і показати таке людині —
 * значить показати рядок, за яким нікуди піти. Параметра, що знімає маску,
 * у API немає й не передбачено.
 */
export function toRawJob(j: ApiJob): RawJob | null {
  if (!j.url || !j.title || !j.company) return null;
  if (j.stealth) return null;
  return {
    url: j.url,
    company: j.company,
    title: j.title,
    location: j.location ?? null,
    remote: isRemoteRole(j),
    postedAt: iso(j.published_at),
    salaryMin: yearlyComp(j.comp_min, j.comp_period),
    salaryMax: yearlyComp(j.comp_max, j.comp_period),
    salaryCurrency: j.comp_currency ?? null,
    commitment: j.employment_type ?? null,
    source: SPEEDRUN_SOURCE,
  };
}

const q = (params: Record<string, string | number>): string =>
  new URLSearchParams({ ...params, source: AGENT } as Record<string, string>).toString();

/**
 * Свіжі ролі, від найновішої.
 *
 * Гортаємо, доки остання роль на сторінці ще свіжа. Це працює саме тому, що
 * `sort=new` дає строгий порядок за датою: щойно хвіст сторінки старший за
 * межу, далі буде тільки старіше. Без цієї зупинки ми читали б 964 сторінки
 * заради тих самих 35.
 */
export async function fetchSpeedrun(
  o: FetchOptions = {}, freshDays = FRESH_DAYS, pages = MAX_PAGES,
): Promise<RawJob[]> {
  const cutoff = Date.now() - freshDays * 86_400_000;
  const out: RawJob[] = [];
  let limit = pages;

  for (let page = 0; page < limit; page++) {
    const p = await fetchJson<JobsPage>(
      `${BASE}/jobs?${q({ scope: SCOPE, sort: "new", page })}`, {}, o);
    const batch = p.jobs ?? [];
    if (batch.length === 0) break;

    // Скільки сторінок узагалі існує, каже сама відповідь — не стукаємо
    // навмання в порожнечу після останньої.
    if (page === 0 && typeof p.total_pages === "number" && p.total_pages > 0) {
      limit = Math.min(pages, p.total_pages);
    }

    for (const j of batch) {
      const raw = toRawJob(j);
      if (raw) out.push(raw);
    }

    // Хвіст сторінки старший за межу свіжості — далі буде тільки старіше.
    const last = iso(batch[batch.length - 1]?.published_at);
    if (last && new Date(last).getTime() < cutoff) break;
    // Дати немає взагалі — порядок перевірити нічим, зупиняємось на стелі.
    if (batch.length < PER_PAGE) break;
  }
  return out;
}

// ── компанії, колекції, ATS ──────────────────────────────────

/**
 * Галузі тут свої, не Getro-ві, тому й перелік свій.
 *
 * Спокуса перевикористати `mapIndustries` з `getro.ts` була, і вона б мовчки
 * збрехала: у Getro галузь називається «Blockchain and Cryptocurrency», а тут
 * «Crypto/Web3»; там «Health Care», тут «Bio Health»; там «Gaming», тут ще й
 * «Games». Правило, написане під чужий словник, дає не помилку, а тишу.
 *
 * Перелік звірено з ПОВНИМ словником усіх 800 компаній (38 різних міток,
 * виміряно 05.09) — і кожна мітка, яка НЕ дає тегу, теж перевірена тестом.
 *
 * Свідомо не мапиться «American Dynamism» (126 компаній). Це власна рубрика
 * a16z, і оборона в ній лише частина: туди ж потрапляють виробництво, енергія,
 * освіта й житло. Тег `defence` усім ста двадцяти шести був би тим самим
 * «правдоподібним правилом», яке ми вже двічі викидали. Справжню оборону дає
 * колекція `defense` — там її десять, і вони названі поіменно.
 */
const INDUSTRY_MAP: Array<[string, RegExp]> = [
  ["ai",        /\bai\b|artificial intelligence|machine learning/i],
  ["web3",      /crypto|web3|blockchain|\bnft\b|\bdefi\b/i],
  ["fintech",   /fintech|financial|payments|banking|insurance/i],
  ["health",    /health|medical|biotech|pharma|life scien/i],
  ["games",     /\bgames?\b|gaming/i],
  ["defence",   /defen[cs]e|military|aerospace/i],
  ["ecommerce", /e-?commerce|\bcommerce\b|retail|marketplace/i],
];

export function mapSpeedrunIndustries(labels: readonly string[] | undefined): string[] {
  const text = (labels ?? []).join(" ");
  if (!text.trim()) return [];
  return INDUSTRY_MAP.filter(([, rx]) => rx.test(text)).map(([id]) => id);
}

/**
 * Колекція → ніша. Те, чого не дають мітки галузей.
 *
 * Мітки галузей не знають слова «оборона» ніде, крім однієї компанії, а
 * колекція `defense` знає десять і `aero-space` ще чотири. Так само з AI:
 * «Frontier AI Labs» це 36 компаній, з яких мітку «AI» має не кожна.
 *
 * Решта сорока колекцій — міста, інвестори й сигнали. Ніші вони не задають:
 * «backed-by-sequoia» каже про гроші, а не про галузь.
 */
const COLLECTION_TAGS: Record<string, string> = {
  "crypto-web3": "web3",
  "frontier-ai-labs": "ai",
  "ai-infra": "ai",
  fintech: "fintech",
  "health-bio": "health",
  defense: "defence",
  "aero-space": "defence",
  "games-entertainment": "games",
};

export const SPEEDRUN_TAG_COLLECTIONS = Object.keys(COLLECTION_TAGS);

export const collectionTag = (slug: string): string | null => COLLECTION_TAGS[slug] ?? null;

export interface SpeedrunCompany {
  slug: string;
  name: string;
  /** `speedrun` | `a16z` | `market` — наскільки близько до портфеля. */
  tier: string | null;
  openRoles: number;
  location: string | null;
  tags: string[];
}

interface ApiCompany {
  slug?: string; name?: string; tier?: string | null;
  open_roles?: number; location?: string | null; industries?: string[];
}

/**
 * Увесь список роботодавців: 800 компаній по сто на сторінку, тобто вісім
 * запитів. Це найдешевший спосіб дізнатись і назву, і галузь, і скільки в
 * компанії відкритих ролей.
 */
export async function fetchSpeedrunCompanies(
  o: FetchOptions = {}, maxPages = 20,
): Promise<SpeedrunCompany[]> {
  const out: SpeedrunCompany[] = [];
  let limit = maxPages;
  for (let page = 0; page < limit; page++) {
    const p = await fetchJson<{ companies?: ApiCompany[]; total_pages?: number }>(
      `${BASE}/companies?${q({ page })}`, {}, o);
    const batch = p.companies ?? [];
    if (batch.length === 0) break;
    if (page === 0 && typeof p.total_pages === "number" && p.total_pages > 0) {
      limit = Math.min(maxPages, p.total_pages);
    }
    for (const c of batch) {
      if (!c.slug || !c.name) continue;
      out.push({
        slug: c.slug, name: c.name, tier: c.tier ?? null,
        openRoles: c.open_roles ?? 0, location: c.location ?? null,
        tags: mapSpeedrunIndustries(c.industries),
      });
    }
  }
  return out;
}

/** Слаги компаній однієї колекції — щоб дати їм нішу колекції. */
export async function fetchSpeedrunCollectionMembers(
  slug: string, o: FetchOptions = {},
): Promise<string[]> {
  const p = await fetchJson<{ collection?: { members?: Array<{ slug?: string }> } }>(
    `${BASE}/collections/${encodeURIComponent(slug)}?${q({})}`, {}, o);
  return (p.collection?.members ?? []).map((m) => m.slug).filter((s): s is string => !!s);
}

/**
 * Справжній ATS роботодавця за однією його роллю.
 *
 * У списку ролей посилання ведуть на сам борд, а не до компанії. Але деталь
 * ролі віддає `apply.url` — і це вже `job-boards.greenhouse.io/planetscale/…`
 * чи `jobs.ashbyhq.com/sprig/…`, тобто рівно те, з чого `extractAts` робить
 * постійне джерело.
 *
 * Це точне знання, а не вгадування слага за назвою: R4 влучає в 45 випадках
 * зі ста, тут промахів немає взагалі — адреса написана роботодавцем.
 */
export async function fetchApplyUrl(jobId: string, o: FetchOptions = {}): Promise<string | null> {
  const p = await fetchJson<{ job?: { apply?: { url?: string } }; apply?: { url?: string } }>(
    `${BASE}/jobs/${encodeURIComponent(jobId)}?${q({})}`, {}, o);
  // Деталь ролі загорнута в `job`, а список ролей — ні. Перша версія читала
  // тільки верхній рівень, і на двадцяти живих компаніях поспіль повертала
  // «немає ATS» при тому, що адреса Greenhouse була в кожній відповіді.
  const u = p.job?.apply?.url ?? p.apply?.url;
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;
}

/** Ідентифікатор першої-ліпшої відкритої ролі компанії — вхід до її ATS. */
export async function firstJobId(companySlug: string, o: FetchOptions = {}): Promise<string | null> {
  const p = await fetchJson<{ company?: { jobs?: Array<{ id?: string }> } }>(
    `${BASE}/companies/${encodeURIComponent(companySlug)}?${q({})}`, {}, o);
  return p.company?.jobs?.find((j) => j.id)?.id ?? null;
}
