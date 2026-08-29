/**
 * Адреса вакансії, на яку можна відправити людину.
 *
 * Джерело адрес — сторонні стрічки й API. Редирект на них — публічний,
 * тому приймаємо лише https на звичайний хост: без javascript:, data:,
 * без userinfo («https://nextrole.info@evil.com») і без локальних імен.
 */
export function safeJobUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return null;
  if (raw.length > 2048) return null;
  return u.toString();
}
