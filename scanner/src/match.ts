/**
 * Підбір вакансій під профіль.
 *
 * Ключове рішення: скоринг ДЕТЕРМІНОВАНИЙ і працює без жодного ключа.
 * Модель лише переписує рядок «чому підходить» людською мовою. Тому продукт
 * функціональний з першого дня, а Anthropic — покращення, не залежність.
 */

export interface Profile {
  userId: string;
  spheres: string[];
  industries: string[];
  /** Своя назва ролі, якщо жодна сфера зі словника не підійшла. */
  customRole?: string | null;
  seniority: string | null;
  remoteMode: string;
  location: string | null;
  salaryMin: number | null;
  /** Країна людини, виведена з локації або часового поясу. Може бути порожня. */
  country?: string | null;
  /**
   * Ваги правил, вивчені з відповідей людини. Одиниця — як у всіх.
   * Кожна скарга на цей вимір робить невідповідність дорожчою саме для неї.
   */
  tuning?: { seniority: number; location: number; salary: number };
}

export interface CandidateJob {
  id: string;
  company: string;
  companyKey: string;
  title: string;
  location: string | null;
  remote: boolean;
  url: string;
  tags: string[];
  postedAt: string | null;
  salaryMin: number | null;
  salaryCurrency: string | null;
  /** Готовий витяг опису зі спільного кешу. Однаковий для всіх людей. */
  summary?: string | null;
  /** Джерело рядка: greenhouse:acme, aggregator:wwr, board:dou-design. */
  source?: string | null;
  /** Кому показувати. Порожнє — всім; заповнене ставлять національні дошки. */
  country?: string | null;
}

/**
 * Причина збігу як дані, а не як речення.
 *
 * Сканер — окремий пакет і навмисно не бачить web/src/lib/vocab.ts, тому
 * контракт між ними — саме цей JSON. Сканер пише ідентифікатори, сайт
 * розкриває їх у назви за локаллю. Побічний виграш: у добірці більше не
 * стоїть сире «operations» замість «Операції та проєкти».
 */
export type MatchFact =
  | { k: "sphere"; v: string }
  | { k: "role"; v: string }
  | { k: "industry"; v: string }
  | { k: "place"; v: string }
  | { k: "level" }
  | { k: "remote" }
  | { k: "salary" }
  | { k: "fresh" };

export interface ScoredJob extends CandidateJob {
  score: number;
  facts: MatchFact[];
}

const SENIORITY_ORDER = ["junior", "middle", "senior", "lead"];

/**
 * Збіг своєї ролі з назвою вакансії.
 *
 * Слова довші за два символи, усі мають бути в назві. Так «технічний рекрутер»
 * не збігається з «Recruiter» випадково, а «solidity audit» знаходить
 * «Solidity Auditor». Коротких слів не беремо — «ai» ловило б усе підряд.
 */
export function matchesCustomRole(title: string, role: string | null | undefined): boolean {
  if (!role) return false;
  const words = role.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const t = title.toLowerCase();
  return words.every((w) => t.includes(w));
}

export function scoreJob(job: CandidateJob, p: Profile, now = new Date()): ScoredJob {
  let score = 0;
  const facts: MatchFact[] = [];
  const tags = new Set(job.tags);

  // Сфера — головне. Індустрія лише підсилює збіг, але не замінює його:
  // маркетолог у потрібній індустрії це не те, що просила людина зі сфери
  // «партнерства». Тому робота без жодного збігу за сферою сильно штрафується
  // і спливає тільки тоді, коли нічого кращого немає.
  const sphereHits = p.spheres.filter((s) => tags.has(s));
  score += sphereHits.length * 6;
  for (const s of sphereHits) facts.push({ k: "sphere", v: s });

  // Своя назва ролі шукається в НАЗВІ вакансії, бо тегів під неї не існує.
  // Це і є те, що робить кнопку «мій варіант» справжньою, а не декоративною.
  const roleHit = matchesCustomRole(job.title, p.customRole);
  if (roleHit) { score += 6; facts.push({ k: "role", v: p.customRole! }); }

  // Штраф лише тоді, коли людина щось назвала й нічого не збіглося.
  if (!sphereHits.length && !roleHit && (p.spheres.length > 0 || p.customRole)) score -= 8;

  const industryHits = p.industries.filter((i) => tags.has(i));
  score += industryHits.length * 2;
  for (const i of industryHits) facts.push({ k: "industry", v: i });

  // Рівень: збіг тягне вгору, розрив у два щаблі — сильно вниз
  const w = p.tuning ?? { seniority: 1, location: 1, salary: 1 };

  if (p.seniority) {
    const jobLevel = SENIORITY_ORDER.find((l) => tags.has(l));
    if (jobLevel === p.seniority) { score += 3; facts.push({ k: "level" }); }
    else if (jobLevel) {
      const gap = Math.abs(SENIORITY_ORDER.indexOf(jobLevel) - SENIORITY_ORDER.indexOf(p.seniority));
      score -= gap * 2 * w.seniority;
    }
  }

  if (p.remoteMode === "remote_only") {
    if (job.remote) { score += 3; facts.push({ k: "remote" }); }
    else score -= 6;                       // майже завжди відсікає onsite
  } else if (job.remote) {
    score += 1;
  }

  if (p.location) {
    const hit = job.location?.toLowerCase().includes(p.location.toLowerCase()) ?? false;
    if (hit) { score += 3; facts.push({ k: "place", v: p.location }); }
    // Скарга на локацію робить невідповідність дорогою. Без скарг вага 1,
    // і поведінка така сама, як була: просто немає бонусу.
    else if (w.location > 1) score -= 3 * (w.location - 1);
  }

  // Зарплата — м'який пріоритет: вакансія без вилки НЕ карається
  if (p.salaryMin && job.salaryMin) {
    if (job.salaryMin >= p.salaryMin) { score += 2; facts.push({ k: "salary" }); }
    else score -= 2 * w.salary;
  }

  if (job.postedAt) {
    const days = (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000;
    if (days <= 3) { score += 2; facts.push({ k: "fresh" }); }
    else if (days <= 7) score += 1;
  }

  // Дошка програє прямому посиланню на роботодавця — але лише в нічию.
  // Одиниця на шкалі, де сфера коштує шість: сильний збіг на DOU не має
  // поступатися посередньому на Greenhouse тільки через домен.
  if (job.source?.startsWith("board:")) score -= 1;

  return { ...job, score, facts };
}

/**
 * Хости агрегаторів. Вакансія з таким посиланням у добірку не йде: продукт
 * обіцяє живе посилання на самого роботодавця, а не на чужий каталог. У кеші
 * вона лишається — з неї й далі збираються назви компаній для R4.
 */
const AGGREGATOR_HOSTS = [
  "jobicy.com", "workingnomads.com", "himalayas.app", "remoteok.com", "remoteok.io",
  "remotive.com", "remotive.io", "weworkremotely.com", "arbeitnow.com", "arbeitnow.co.uk",
  "nodesk.co", "jobspresso.co", "landingjobs.co", "themuse.com", "cryptocurrencyjobs.co",
  "web3.career", "cryptojobslist.com", "builtin.com", "otta.com", "welcometothejungle.com",
  "wellfound.com", "angel.co", "jobgether.com", "news.ycombinator.com",
];

/** Чи веде посилання на агрегатор, а не на сайт роботодавця. */
export function linksToAggregator(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return false; }          // не розібрали — не наша справа судити
  return AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Чи адресована вакансія цій людині за країною.
 *
 * Більшість кешу країни не має — це глобальні вакансії, і їх бачать усі.
 * Заповнену країну ставлять національні дошки, і тоді вона означає «лише
 * своїм»: київська вакансія в офісі нікому за межами України не потрібна, а
 * людині без визначеної країни ми не маємо права її нав'язувати.
 */
export function fitsCountry(job: CandidateJob, p: Profile): boolean {
  return !job.country || job.country === p.country;
}

/**
 * Топ-5 із трьома правилами проти одноманітності.
 *
 * 1. Одна роль на компанію. П'ять позицій в одній фірмі — це одна можливість.
 * 2. Спершу по одній вакансії з кожної сфери, яку людина обрала. Без цього
 *    добірка сповзає в найсильнішу сферу: перша справжня доставка дала п'ять
 *    вакансій із двох сфер і однієї індустрії, хоча профіль ширший.
 * 3. Решту місць добираємо за балом, як раніше.
 *
 * Сортування за балом лишається всередині кожного кола, тож різноманітність
 * не купується ціною доречності: з кожної сфери береться її найкраще.
 */
export function pickTop(jobs: CandidateJob[], p: Profile, limit = 5, now = new Date()): ScoredJob[] {
  const scored = jobs
    .filter((j) => !linksToAggregator(j.url))
    .filter((j) => fitsCountry(j, p))
    .map((j) => scoreJob(j, p, now))
    .filter((j) => j.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: ScoredJob[] = [];
  const seenCompanies = new Set<string>();
  const take = (job: ScoredJob): boolean => {
    if (seenCompanies.has(job.companyKey)) return false;
    seenCompanies.add(job.companyKey);
    picked.push(job);
    return true;
  };

  // Коло перше: найкраще з кожної обраної сфери.
  for (const sphere of p.spheres) {
    if (picked.length >= limit) break;
    const best = scored.find((j) => !picked.includes(j) && j.tags.includes(sphere));
    if (best) take(best);
  }

  // Коло друге: добираємо за балом.
  for (const job of scored) {
    if (picked.length >= limit) break;
    if (picked.includes(job)) continue;
    take(job);
  }

  // Порядок у повідомленні — за силою збігу, а не за тим, як добирали.
  return picked.sort((a, b) => b.score - a.score);
}

/** Пояснення без моделі — шаблон із реальних причин, а не переказ вакансії. */
export function explainLocally(job: ScoredJob, p: Profile): string {
  const bits: string[] = [];
  const sphere = p.spheres.find((s) => job.tags.includes(s));
  if (sphere) bits.push(`це ${sphere}, одна з твоїх сфер`);
  else if (matchesCustomRole(job.title, p.customRole)) bits.push(`це ${p.customRole}, як ти й просив`);
  const industry = p.industries.find((i) => job.tags.includes(i));
  if (industry) bits.push(`індустрія ${industry}`);
  if (job.remote && p.remoteMode === "remote_only") bits.push("повністю віддалено");
  if (p.salaryMin && job.salaryMin && job.salaryMin >= p.salaryMin) bits.push("вилка вища за твій поріг");
  if (bits.length === 0) bits.push("збігається з профілем за назвою ролі");
  return `${bits.join(", ")}.`;
}

const EXPLAIN_SYSTEM =
  `Ти пишеш один рядок про те, чому вакансія підходить конкретній людині.
Пиши ПРО ЛЮДИНУ, не переказуй вакансію. Одне-два речення, без вступів,
тією ж мовою, що й профіль. Відповідай ЛИШЕ JSON: {"why":["...","..."]} —
по одному рядку на вакансію, у тому ж порядку.`;

/** Скільки токенів коштував виклик. Гроші не рахуємо тут: ставка за токен
 *  живе поза кодом і змінюється, а вигадане число на панелі власника
 *  виглядало б як факт. */
export interface UsageReport {
  model: string; inputTokens: number; outputTokens: number; ok: boolean;
}

/**
 * Уточнення пояснень моделлю. Впало — лишаються локальні.
 *
 * Облік іде зворотним викликом, а не записом у базу: цей файл лишається
 * чистим і тестується без D1, а хто його кличе — той і знає, куди писати.
 */
export async function explainWithClaude(
  jobs: ScoredJob[], p: Profile, apiKey: string | null, model = "claude-haiku-4-5",
  onUsage?: (u: UsageReport) => Promise<void> | void,
): Promise<string[]> {
  const local = jobs.map((j) => explainLocally(j, p));
  if (!apiKey || jobs.length === 0) return local;

  const profileText =
    `Сфери: ${p.spheres.join(", ") || "—"}. Індустрії: ${p.industries.join(", ") || "—"}. ` +
    `Рівень: ${p.seniority ?? "—"}. Робота: ${p.remoteMode}. ` +
    `Зарплата від: ${p.salaryMin ?? "—"}.`;
  const jobsText = jobs.map((j, i) =>
    `${i + 1}. ${j.company} — ${j.title} — ${j.location ?? "локація не вказана"} — теги: ${j.tags.join(",")}`
  ).join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 1024, system: EXPLAIN_SYSTEM,
        messages: [{ role: "user", content: `ПРОФІЛЬ:\n${profileText}\n\nВАКАНСІЇ:\n${jobsText}` }],
      }),
    });
    if (!res.ok) {
      await onUsage?.({ model, inputTokens: 0, outputTokens: 0, ok: false });
      return local;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    await onUsage?.({
      model, ok: true,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });
    const raw = data.content?.find((b) => b.type === "text")?.text ?? "";
    const json = /\{[\s\S]*\}/.exec(raw)?.[0];
    if (!json) return local;
    const parsed = JSON.parse(json) as { why?: string[] };
    const why = parsed.why ?? [];
    return jobs.map((j, i) => why[i]?.trim() || local[i]!);
  } catch {
    return local;
  }
}
