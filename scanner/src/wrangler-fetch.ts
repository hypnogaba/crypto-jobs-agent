/**
 * Транспорт D1 через `wrangler d1 execute --remote`, а не через REST.
 *
 * Потрібен там, де є OAuth-логін wrangler, але немає CF_API_TOKEN, тобто на
 * машині розробника. У продакшн не йде: вмикається лише змінною VIA_WRANGLER.
 *
 * ЧИТАЄ, АЛЕ НЕ ПИШЕ. `d1.batch()` шле тіло `{batch:[…]}`, а тут розібрано
 * лише `{sql, params}` — пакетний запис через CLI довелося б розкладати на
 * окремі виклики, по одному процесу `npx` на інструкцію. Тому `retag --dry`
 * тут працює, а `retag` без `--dry` падає на записі, і це правильне місце
 * для падіння: справжнє перетегування йде на сервері з токеном.
 */
import { execFileSync } from "node:child_process";

/** Підстановка параметрів у текст запиту: біндингу в CLI немає. */
function inline(sql: string, params: unknown[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

export const wranglerFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String((init as RequestInit).body)) as { sql: string; params?: unknown[] };
  const raw = execFileSync("npx", [
    "wrangler", "d1", "execute", "crypto-jobs-agent", "--remote", "--json",
    "--command", inline(body.sql, body.params ?? []),
  ], { cwd: process.env.WEB_DIR ?? ".", encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const start = raw.indexOf("[");
  const parsed = JSON.parse(raw.slice(start)) as Array<{ results?: unknown[]; success?: boolean }>;
  return new Response(JSON.stringify({
    success: true,
    result: parsed.map((r) => ({ success: true, results: r.results ?? [] })),
    errors: [],
  }), { status: 200, headers: { "content-type": "application/json" } });
};
