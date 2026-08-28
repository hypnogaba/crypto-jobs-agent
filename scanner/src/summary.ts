/**
 * Опис вакансії з тексту оголошення. Без моделі.
 *
 * Ключове рішення: опис вакансії ОДНАКОВИЙ для всіх людей, на відміну від
 * «чому ти». Тому він рахується один раз на вакансію і лежить у спільному
 * кеші. Сирий текст оголошення нікуди не зберігається — лише витяг.
 *
 * Евристику перевірено на живих відповідях Ashby, Lever і Greenhouse:
 * 15 вакансій, 15 описів, 12 із них справді про роль.
 */

/** Заголовок, після якого починається розповідь про саму роль. */
const HEAD = /^(about (the )?(role|job|position|opportunity)|the (role|opportunity|job)|what you.{0,3}ll do|what you will do|your (role|impact|mission)|role overview|position summary|job description|overview|responsibilities)\s*:?\s*$/i;

/** Маркери того, що абзац про роботу, а не про фірму. */
const ROLE = /\b(you.{0,3}ll|you will|your role|in this role|we.{0,3}re looking for|we are looking for|we seek|responsible for|as an? [a-z ]{3,30}, you|this role|reporting to|day.to.day|responsibilities include|design, build)\b/i;

/** Маркери корпоративної реклами. */
const CORP = /\b(our mission|was founded|millions of users|billions of|our (story|values|culture)|trusted by|customers (around|across) the world|we.{0,3}re a (dynamic|fast|global|leading|team|remote)|we are a (dynamic|fast|global|leading|team|remote)|globally distributed|join us|our team is made up)\b/i;

/** Службові блоки: пільги, зарплата, юридичне. */
const DROP = /^(about (us|the company)|who we are|our (mission|story|values|culture)|why (join|work)|benefits|perks|compensation|salary|equal (employment )?opportunity|we are an equal|eeo|accommodation|how to apply|what we offer)/i;

const NAMED: Record<string, string> = {
  amp: "&", nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  mdash: "—", ndash: "–", hellip: "…",
};

function decode(t: string): string {
  return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const n = /^#x/i.test(e) ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * Сутності декодуються РАНІШЕ за зняття тегів.
 *
 * Greenhouse віддає екранований HTML (`&lt;p&gt;`). При зворотному порядку
 * теги перетворюються на видимий текст уже після того, як їх нікому знімати,
 * і в картку летить рядок «<p>We're a dynamic team…».
 */
function clean(raw: string): string {
  const t = decode(decode(raw));
  return t.replace(/<(li|\/p|\/div|br|\/h\d|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
}

const paras = (t: string): string[] =>
  clean(t).split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Обрізання по межі речення, зі словом як запасним варіантом. */
export function cut(p: string, limit = 240): string {
  if (p.length <= limit) return p;
  let out = "";
  for (const s of p.split(/(?<=[.!?])\s+/)) {
    if (out.length + s.length + 1 > limit) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || `${p.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

export function summarize(text: string | null | undefined, company = ""): string | null {
  if (!text) return null;
  const all = paras(text);

  // 1. Абзац одразу після заголовка про роль. Найнадійніший шлях: автор
  //    оголошення сам позначив, де закінчується реклама.
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.length < 60 && HEAD.test(all[i]!)) {
      const next = all.slice(i + 1).find((q) => q.length >= 60);
      if (next) return cut(next);
    }
  }

  // 2. Інакше — скоринг. Абзац, що відкривається назвою компанії з
  //    дієсловом-зв'язкою, майже завжди блурб: «Ramp is building…».
  const first = company.trim().split(/\s+/)[0] ?? "";
  const blurb = first
    ? new RegExp(`^${escapeRe(first)}\\b.{0,80}\\b(is|are|was|builds?|building|powers?|helps?|makes?)\\b`, "i")
    : null;

  let best: string | null = null;
  let bestScore = -99;
  const cands = all.filter((p) => p.length >= 60 && p.length <= 900).slice(0, 12);
  cands.forEach((p, i) => {
    let s = -i * 0.5;                       // раніші абзаци трохи вагоміші
    if (ROLE.test(p)) s += 4;
    if (CORP.test(p)) s -= 4;
    if (DROP.test(p)) s -= 5;
    if (blurb?.test(p)) s -= 6;
    if (s > bestScore) { best = p; bestScore = s; }
  });

  return best && bestScore > -3 ? cut(best) : null;
}
