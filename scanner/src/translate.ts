/**
 * Переклад картки вакансії мовою людини. Працює лише з ANTHROPIC_API_KEY.
 *
 * Без ключа модуль повертає порожню мапу, і добірка виглядає точно так, як
 * досі: назва й опис мовою оригіналу. З ключем — один запит на добірку
 * (усі ≤5 вакансій одним JSON), результат лягає в job_i18n, тож наступна
 * людина з тією ж мовою отримує переклад без запиту.
 *
 * Будь-який збій — мережа, не-JSON, пропущений елемент — означає оригінал
 * для цієї вакансії. Переклад ніколи не має права зірвати доставку.
 */
import type { Locale } from "./digest-copy.js";
import { languageName } from "./digest-copy.js";
import type { UsageReport } from "./match.js";

export const TRANSLATE_MODEL = "claude-haiku-4-5-20251001";

export interface TranslatableJob { id: string; title: string; summary: string | null }
export interface Translation { title: string; summary: string | null }

/** Кеш перекладів. У проді — таблиця job_i18n, у тестах — Map. */
export interface I18nStore {
  get(ids: string[], locale: Locale): Promise<Map<string, Translation>>;
  put(rows: Array<{ id: string; locale: Locale } & Translation>): Promise<void>;
}

/** Мінімальний зріз D1Client, щоб модуль не тягнув увесь клієнт у тести. */
interface D1Like {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}

export const d1Store = (d1: D1Like): I18nStore => ({
  async get(ids, locale) {
    if (ids.length === 0) return new Map();
    const rows = await d1.query<{ job_id: string; title: string; summary: string | null }>(
      `SELECT job_id,title,summary FROM job_i18n WHERE locale=? AND job_id IN (${ids.map(() => "?").join(",")})`,
      [locale, ...ids]);
    return new Map(rows.map((r) => [r.job_id, { title: r.title, summary: r.summary }]));
  },
  async put(rows) {
    if (rows.length === 0) return;
    await d1.batch(rows.map((r) => ({
      sql: "INSERT OR REPLACE INTO job_i18n (job_id,locale,title,summary,created_at) VALUES (?,?,?,?,datetime('now'))",
      params: [r.id, r.locale, r.title, r.summary],
    })));
  },
});

export const translateSystem = (locale: Locale): string =>
  `You translate job-ad snippets into ${languageName(locale)} for a job digest.
Rules: keep company names, product names, tool and technology names, programming
languages, frameworks, job-title abbreviations (CTO, SRE, QA, DevRel) untranslated.
Keep each text about the same length; do not add or drop information; no comments.
Answer ONLY with JSON: {"items":[{"id":"...","title":"...","summary":"..."}]}
— one item per input id, same ids. If summary is null, return null.`;

export interface TranslateOptions {
  fetchImpl?: typeof fetch;
  onUsage?: (u: UsageReport) => Promise<void> | void;
  model?: string;
}

/**
 * Переклади для вакансій: з кешу, а чого бракує — одним запитом до моделі.
 *
 * Повертає лише те, що вдалося перекласти. Викликач підставляє за id і для
 * решти лишає оригінал.
 */
export async function translateJobs(
  jobs: TranslatableJob[], locale: Locale, apiKey: string | null, store: I18nStore,
  opts: TranslateOptions = {},
): Promise<Map<string, Translation>> {
  if (locale === "en" || !apiKey || jobs.length === 0) return new Map();
  const model = opts.model ?? TRANSLATE_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;

  let cached: Map<string, Translation>;
  try { cached = await store.get(jobs.map((j) => j.id), locale); }
  catch { cached = new Map(); }

  // Кеш без опису (переклали, коли summary ще не було) — не кеш, а
  // напівпереклад: опис з'явився пізніше, тож перекладаємо заново.
  const todo = jobs.filter((j) => {
    const c = cached.get(j.id);
    return !c || (Boolean(j.summary) && !c.summary);
  });
  if (todo.length === 0) return cached;

  const out = new Map(cached);
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model, max_tokens: 2048, system: translateSystem(locale),
        messages: [{ role: "user", content:
          `TARGET LANGUAGE: ${languageName(locale)}\n\n` +
          JSON.stringify({ items: todo.map((j) => ({ id: j.id, title: j.title, summary: j.summary })) }) }],
      }),
    });
    if (!res.ok) {
      await opts.onUsage?.({ model, inputTokens: 0, outputTokens: 0, ok: false });
      return out;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    await opts.onUsage?.({
      model, ok: true,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });
    const raw = data.content?.find((b) => b.type === "text")?.text ?? "";
    const json = /\{[\s\S]*\}/.exec(raw)?.[0];
    if (!json) return out;
    const parsed = JSON.parse(json) as { items?: Array<{ id?: unknown; title?: unknown; summary?: unknown }> };
    const fresh: Array<{ id: string; locale: Locale } & Translation> = [];
    for (const j of todo) {
      const it = parsed.items?.find((x) => x.id === j.id);
      // Порожня назва або назва не рядком — оригінал. Опис: рядок або null;
      // якщо оригінал мав опис, а переклад його загубив — теж оригінал.
      if (!it || typeof it.title !== "string" || !it.title.trim()) continue;
      const summary = typeof it.summary === "string" && it.summary.trim() ? it.summary.trim() : null;
      if (j.summary && summary === null) continue;
      const tr: Translation = { title: it.title.trim(), summary };
      out.set(j.id, tr);
      fresh.push({ id: j.id, locale, ...tr });
    }
    try { await store.put(fresh); } catch { /* кеш не важливіший за доставку */ }
  } catch {
    // Мережа чи JSON — оригінал. Причину не логуємо: ключ у проді
    // з'явиться пізніше, і шум у журналі зараз нікому не потрібен.
  }
  return out;
}

/** Підставити переклад у картки: компанія й решта полів — як були. */
export function applyTranslations<T extends { id: string; title: string; summary?: string | null }>(
  jobs: T[], tr: Map<string, Translation>,
): T[] {
  return jobs.map((j) => {
    const t = tr.get(j.id);
    return t ? { ...j, title: t.title, summary: t.summary ?? j.summary } : j;
  });
}
