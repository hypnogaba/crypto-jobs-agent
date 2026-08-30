import type { RawJob } from "./types.js";

/**
 * Теги — основа маршрутизації за нішами. Вакансія отримує їх із назви посади
 * і з джерела, а профіль людини вирішує, які брати до уваги. Тому один скан
 * обслуговує і web3-профіль, і фінтех-профіль.
 */

const SPHERE_RULES: Array<[string, RegExp]> = [
  ["engineering",  /\b(engineers?|developers?|programmers?|swe|backend|frontend|full[- ]?stack|mobile|ios|android|platform|infrastructure|devops|sre|architects?)\b/i],
  ["data-ai",      /\b(data scientists?|data engineers?|machine learning|ml engineers?|ai engineers?|analytics engineers?|research scientists?|mlops|nlp)\b/i],
  // Дизайн — окрема сфера: «product» лишається як був, але дизайнер тепер
  // отримує і власний тег, під який людина може підписатися.
  ["design",       /\b(designers?|ux|ui|product design|graphic|figma|brand design|motion)\b/i],
  ["product",      /\b(product managers?|product owners?|product leads?|product design|ux|ui designers?|designers?)\b/i],
  ["devrel",       /\b(developers? relations|devrel|developers? advocates?|community managers?|community leads?|evangelists?)\b/i],
  ["partnerships", /\b(partnerships?|business development|bd managers?|alliances|ecosystems?)\b/i],
  ["operations",   /\b(operations|program managers?|project managers?|chief of staff|people ops|hr managers?|recruiters?)\b/i],
  ["marketing",    /\b(marketing|growth|content|brand|seo|demand generation|communications)\b/i],
  ["sales",        /\b(sales|account executives?|account managers?|customer success|solutions engineers?)\b/i],
  ["security",     /\b(security|appsec|infosec|penetration|compliance|grc)\b/i],
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

const SENIORITY_RULES: Array<[string, RegExp]> = [
  // «vp » з пробілом усередині групи, обрамленої \b...\b, не працює: пробіл
  // не є символом слова, тож межа після нього не збігається ніде, крім
  // «vp  x». Через це «VP, Growth Marketing» лишався БЕЗ тегу рівня — і
  // потрапляв до junior-а без жодного штрафу. Таких свіжих рядків 55.
  // Тепер це \bvp\b, який ловить і «VP,», і «VP:», і «VP» в кінці назви.
  ["lead",   /\b(head of|director|[sve]?vp|vice president|chief|principal|staff|lead)\b/i],
  ["senior", /\b(senior|sr\.?|expert)\b/i],
  ["junior", /\b(junior|jr\.?|intern|graduate|entry[- ]level|working student|trainee)\b/i],
];

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
  for (const [tag, rx] of SENIORITY_RULES) { if (rx.test(title)) { tags.add(tag); break; } }
  for (const [prefix, extra] of SOURCE_TAGS) {
    if (job.source.startsWith(prefix)) extra.forEach((t) => tags.add(t));
  }
  if (job.remote) tags.add("remote");
  if (tags.size === 0) tags.add("other");
  return [...tags];
}
