import { INDUSTRIES, SPHERES, type IndustryId, type RemoteModeId, type SeniorityId, type SphereId } from "./vocab";
import { logUsage, readUsage } from "@/lib/usage";

/**
 * Розбирає вільний текст або резюме в ТІ САМІ чотири поля, що й форма.
 * Це не окрема гілка логіки — це інший спосіб заповнити ту саму анкету.
 *
 * Працює без жодного ключа. Якщо є ANTHROPIC_API_KEY — результат уточнюється
 * моделлю, але продукт функціональний і без неї.
 */

export interface ParsedProfile {
  spheres: SphereId[];
  industries: IndustryId[];
  seniority: SeniorityId | null;
  remoteMode: RemoteModeId;
  location: string | null;
  salaryMin: number | null;
  salaryCurrency: string | null;
}

const SPHERE_HINTS: Record<SphereId, RegExp> = {
  engineering:  /\b(engineer|developer|programmer|backend|frontend|full[- ]?stack|devops|sre|infrastructure|architect|інженер|розробник|программист|développeur)\b/i,
  "data-ai":    /\b(data|machine learning|ml|ai|analytics|scientist|дані|данные|аналітик|аналитик)\b/i,
  product:      /\b(product|продукт)\b/i,
  // Межа слова через \p{L}, а не \b: \b не бачить кирилиці, тож
  // /\bдизайн\b/ не збігся б ніколи. Стеми (графічн-) беруть будь-який хвіст.
  design:       /(?<!\p{L})(?:design(?:er)?|ux|ui|figma|дизайн\p{L}*|графічн\p{L}*|графическ\p{L}*)(?!\p{L})/iu,
  devrel:       /\b(devrel|developer relations|advocate|community|спільнот|сообщест)\b/i,
  partnerships: /\b(partnership|business development|\bbd\b|ecosystem|alliances|партнерств|партнёрств)\b/i,
  operations:   /\b(operations|program|project manager|chief of staff|операці|операци)\b/i,
  marketing:    /\b(marketing|growth|content|seo|brand|маркетинг)\b/i,
  sales:        /\b(sales|account executive|customer success|продаж)\b/i,
  security:     /\b(security|infosec|appsec|безпек|безопасн)\b/i,
  qa:           /\b(qa|quality assurance|test engineer|тестув|тестиров)\b/i,
};

const INDUSTRY_HINTS: Record<IndustryId, RegExp> = {
  web3:      /\b(web3|crypto|blockchain|defi|nft|solana|ethereum|dao|крипт)\b/i,
  ai:        /\b(ai|artificial intelligence|llm|deep tech|machine learning)\b/i,
  fintech:   /\b(fintech|payments|banking|trading|фінтех|финтех)\b/i,
  health:    /\b(health|medtech|biotech|pharma|clinical|здоров)\b/i,
  games:     /\b(game|gaming|gamedev|ігр|игр)\b/i,
  ecommerce: /\b(e-?commerce|retail|marketplace)\b/i,
  defence:   /\b(defen[cs]e|military|aerospace|оборон)\b/i,
  nonprofit: /\b(non-?profit|ngo|foundation|humanitarian|неприбутков|некоммерч)\b/i,
};

const SENIORITY_HINTS: Array<[SeniorityId, RegExp]> = [
  ["lead",   /\b(lead|head of|director|vp|chief|principal|staff|керівник|руководител)\b/i],
  ["senior", /\b(senior|sr\.?|досвідчен|опытн)\b/i],
  ["junior", /\b(junior|jr\.?|intern|graduate|entry|початк|начинающ)\b/i],
  ["middle", /\b(middle|mid[- ]level)\b/i],
];

const CURRENCIES: Array<[string, RegExp]> = [
  ["EUR", /(?:€|\beur\b|euro)/i],
  ["GBP", /(?:£|\bgbp\b)/i],
  ["USD", /(?:\$|\busd\b|dollar)/i],
];

function parseSalary(text: string): { min: number | null; currency: string | null } {
  // «від 90k», «90 000 EUR», «$120,000», «100к»
  const m = /(\d{2,3})\s*[k к]\b/i.exec(text) ?? /(\d{2,3})[\s,.](\d{3})\b/.exec(text);
  if (!m) return { min: null, currency: null };
  const value = m[2] ? Number.parseInt(`${m[1]}${m[2]}`, 10) : Number.parseInt(m[1]!, 10) * 1000;
  if (Number.isNaN(value) || value < 10_000 || value > 1_000_000) return { min: null, currency: null };
  const currency = CURRENCIES.find(([, rx]) => rx.test(text))?.[0] ?? null;
  return { min: value, currency };
}

const CITY = /\b(?:in|у|в|à|из|з)\s+([A-ZА-ЯІЇЄ][\p{L}-]{2,}(?:\s+[A-ZА-ЯІЇЄ][\p{L}-]{2,})?)/u;

/** Детермінований розбір. Працює завжди, безкоштовно, без мережі. */
export function parseLocally(text: string): ParsedProfile {
  const spheres = SPHERES.map((s) => s.id).filter((id) => SPHERE_HINTS[id].test(text));
  const industries = INDUSTRIES.map((i) => i.id).filter((id) => INDUSTRY_HINTS[id].test(text));
  const seniority = SENIORITY_HINTS.find(([, rx]) => rx.test(text))?.[0] ?? null;

  const wantsRemote = /\b(remote|віддален|удалён|удален|télétravail|anywhere)\b/i.test(text);
  const willRelocate = /\b(relocat|переїзд|переезд|déménag)\b/i.test(text);
  const cityMatch = CITY.exec(text);
  const location = cityMatch?.[1]?.trim() ?? null;

  const remoteMode: RemoteModeId = willRelocate ? "relocate" : location && !wantsRemote ? "remote_or_city" : "remote_only";
  const { min, currency } = parseSalary(text);

  return {
    spheres: spheres.length ? spheres : [],
    industries,
    seniority,
    remoteMode,
    location,
    salaryMin: min,
    salaryCurrency: currency,
  };
}

const SYSTEM = `Ти розбираєш опис пошуку роботи або резюме у структуру.
Відповідай ЛИШЕ валідним JSON без пояснень, за схемою:
{"spheres":[],"industries":[],"seniority":null,"remoteMode":"remote_only","location":null,"salaryMin":null,"salaryCurrency":null}
spheres — з набору: ${SPHERES.map((s) => s.id).join(", ")}
industries — з набору: ${INDUSTRIES.map((i) => i.id).join(", ")}
seniority — junior | middle | senior | lead | null
remoteMode — remote_only | remote_or_city | relocate`;

const MODEL = "claude-opus-5";

/** Уточнення моделлю. Якщо ключа немає або виклик впав — лишається локальний розбір. */
export async function parseProfile(text: string, apiKey?: string | null): Promise<ParsedProfile> {
  const local = parseLocally(text);
  if (!apiKey) return local;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: text.slice(0, 12_000) }],
      }),
    });
    if (!res.ok) {
      await logUsage({ operation: "parse_profile", model: MODEL, inputTokens: 0, outputTokens: 0, ok: false });
      return local;
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const { input, output } = readUsage(data);
    await logUsage({ operation: "parse_profile", model: MODEL, inputTokens: input, outputTokens: output, ok: true });
    const raw = data.content?.find((b) => b.type === "text")?.text ?? "";
    const json = /\{[\s\S]*\}/.exec(raw)?.[0];
    if (!json) return local;
    const parsed = JSON.parse(json) as Partial<ParsedProfile>;

    const allowedSpheres = new Set(SPHERES.map((s) => s.id));
    const allowedIndustries = new Set(INDUSTRIES.map((i) => i.id));
    return {
      spheres: (parsed.spheres ?? []).filter((s): s is SphereId => allowedSpheres.has(s as SphereId)),
      industries: (parsed.industries ?? []).filter((i): i is IndustryId => allowedIndustries.has(i as IndustryId)),
      seniority: parsed.seniority ?? local.seniority,
      remoteMode: parsed.remoteMode ?? local.remoteMode,
      location: parsed.location ?? local.location,
      salaryMin: parsed.salaryMin ?? local.salaryMin,
      salaryCurrency: parsed.salaryCurrency ?? local.salaryCurrency,
    };
  } catch {
    return local;   // модель — покращення, а не залежність
  }
}
