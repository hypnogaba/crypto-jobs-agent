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
}

export interface ScoredJob extends CandidateJob {
  score: number;
  reasons: string[];
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
  const reasons: string[] = [];
  const tags = new Set(job.tags);

  // Сфера — головне. Індустрія лише підсилює збіг, але не замінює його:
  // маркетолог у потрібній індустрії це не те, що просила людина зі сфери
  // «партнерства». Тому робота без жодного збігу за сферою сильно штрафується
  // і спливає тільки тоді, коли нічого кращого немає.
  const sphereHits = p.spheres.filter((s) => tags.has(s));
  score += sphereHits.length * 6;
  if (sphereHits.length) reasons.push(`сфера: ${sphereHits.join(", ")}`);

  // Своя назва ролі шукається в НАЗВІ вакансії, бо тегів під неї не існує.
  // Це і є те, що робить кнопку «мій варіант» справжньою, а не декоративною.
  const roleHit = matchesCustomRole(job.title, p.customRole);
  if (roleHit) { score += 6; reasons.push(`роль: ${p.customRole}`); }

  // Штраф лише тоді, коли людина щось назвала й нічого не збіглося.
  if (!sphereHits.length && !roleHit && (p.spheres.length > 0 || p.customRole)) score -= 8;

  const industryHits = p.industries.filter((i) => tags.has(i));
  score += industryHits.length * 2;
  if (industryHits.length) reasons.push(`індустрія: ${industryHits.join(", ")}`);

  // Рівень: збіг тягне вгору, розрив у два щаблі — сильно вниз
  if (p.seniority) {
    const jobLevel = SENIORITY_ORDER.find((l) => tags.has(l));
    if (jobLevel === p.seniority) { score += 3; reasons.push("рівень збігається"); }
    else if (jobLevel) {
      const gap = Math.abs(SENIORITY_ORDER.indexOf(jobLevel) - SENIORITY_ORDER.indexOf(p.seniority));
      score -= gap * 2;
    }
  }

  if (p.remoteMode === "remote_only") {
    if (job.remote) { score += 3; reasons.push("віддалено"); }
    else score -= 6;                       // майже завжди відсікає onsite
  } else if (job.remote) {
    score += 1;
  }

  if (p.location && job.location?.toLowerCase().includes(p.location.toLowerCase())) {
    score += 3; reasons.push(`локація: ${p.location}`);
  }

  // Зарплата — м'який пріоритет: вакансія без вилки НЕ карається
  if (p.salaryMin && job.salaryMin) {
    if (job.salaryMin >= p.salaryMin) { score += 2; reasons.push("зарплата підходить"); }
    else score -= 2;
  }

  if (job.postedAt) {
    const days = (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000;
    if (days <= 3) { score += 2; reasons.push("свіжа"); }
    else if (days <= 7) score += 1;
  }

  return { ...job, score, reasons };
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
 * Топ-5 із двома правилами анти-концентрації: одна роль на компанію
 * і схлопування однакових ролей. П'ять позицій в одній фірмі — це одна
 * можливість, а не п'ять.
 */
export function pickTop(jobs: CandidateJob[], p: Profile, limit = 5, now = new Date()): ScoredJob[] {
  const scored = jobs
    .filter((j) => !linksToAggregator(j.url))
    .map((j) => scoreJob(j, p, now))
    .filter((j) => j.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: ScoredJob[] = [];
  const seenCompanies = new Set<string>();
  for (const job of scored) {
    if (seenCompanies.has(job.companyKey)) continue;
    seenCompanies.add(job.companyKey);
    picked.push(job);
    if (picked.length >= limit) break;
  }
  return picked;
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

/** Уточнення пояснень моделлю. Впало — лишаються локальні. */
export async function explainWithClaude(
  jobs: ScoredJob[], p: Profile, apiKey: string | null, model = "claude-haiku-4-5"
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
    if (!res.ok) return local;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
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
