import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Прямий доступ до D1 через прив'язку Worker'а. Ніякого ORM: схема наша,
 * запитів небагато, а один шар менше — це один шар менше поламаного.
 */
export async function db(): Promise<D1Database> {
  const { env } = getCloudflareContext();
  return env.DB;
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const d = await db();
  const r = await d.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}

export async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  const rows = await all<T>(sql, ...params);
  return rows[0] ?? null;
}

export async function run(sql: string, ...params: unknown[]): Promise<void> {
  const d = await db();
  await d.prepare(sql).bind(...params).run();
}

export const nowIso = (): string => new Date().toISOString();
export const uuid = (): string => crypto.randomUUID();
