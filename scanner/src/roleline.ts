/**
 * Кеш рядка про роль — того одного речення, яким картка починається.
 *
 * Рядок пише модель разом із «чому ти» (див. pitchWithClaude), і він
 * залежить лише від вакансії та мови, а не від людини. Тому він лягає в
 * спільну таблицю: наступна людина з тією ж мовою отримає ту саму вакансію
 * вже з готовим рядком, і відкладена добірка теж має де його взяти.
 *
 * Таблиця та сама, що була під переклад, — job_i18n. Колонка `summary`
 * тепер тримає саме цей рядок. Переклад витягу з оголошення був окремим
 * запитом до моделі й давав рівно те, що дає pitchWithClaude, тільки
 * дорожче: два запити замість одного, і мова картки залежала від того, чи
 * спрацював другий. Міграції немає навмисно — форма рядка не змінилась.
 */
import type { Locale } from "./digest-copy.js";

/** Кеш рядків. У проді — таблиця job_i18n, у тестах — Map. */
export interface RoleLineStore {
  get(ids: string[], locale: Locale): Promise<Map<string, string>>;
  put(rows: Array<{ id: string; locale: Locale; title: string; role: string }>): Promise<void>;
}

/** Мінімальний зріз D1Client, щоб модуль не тягнув увесь клієнт у тести. */
interface D1Like {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}

export const d1Store = (d1: D1Like): RoleLineStore => ({
  async get(ids, locale) {
    if (ids.length === 0) return new Map();
    const rows = await d1.query<{ job_id: string; summary: string | null }>(
      `SELECT job_id,summary FROM job_i18n WHERE locale=? AND summary IS NOT NULL
        AND job_id IN (${ids.map(() => "?").join(",")})`,
      [locale, ...ids]);
    return new Map(rows.filter((r) => r.summary).map((r) => [r.job_id, r.summary!]));
  },
  async put(rows) {
    if (rows.length === 0) return;
    await d1.batch(rows.map((r) => ({
      sql: "INSERT OR REPLACE INTO job_i18n (job_id,locale,title,summary,created_at) VALUES (?,?,?,?,datetime('now'))",
      params: [r.id, r.locale, r.title, r.role],
    })));
  },
});

/**
 * Рядки про роль із кешу. Збій кешу — порожня мапа: картка обійдеться без
 * рядка, але добірка піде.
 */
export async function cachedRoleLines(
  ids: string[], locale: Locale, store: RoleLineStore,
): Promise<Map<string, string>> {
  try { return await store.get(ids, locale); } catch { return new Map(); }
}

/** Покласти в кеш те, що написала модель. Мовчки: кеш не важливіший за доставку. */
export async function saveRoleLines(
  rows: Array<{ id: string; title: string; role: string | null }>, locale: Locale, store: RoleLineStore,
): Promise<void> {
  const fresh = rows
    .filter((r): r is { id: string; title: string; role: string } => Boolean(r.role))
    .map((r) => ({ id: r.id, locale, title: r.title, role: r.role }));
  if (fresh.length === 0) return;
  try { await store.put(fresh); } catch { /* кеш не важливіший за доставку */ }
}
