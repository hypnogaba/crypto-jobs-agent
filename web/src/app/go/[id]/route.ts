/**
 * Перехід на вакансію з добірки в Telegram.
 *
 * Без входу на сайт — навмисно. Той, хто зареєструвався в боті, сесії на
 * сайті не має й ніколи не матиме, а посилання в добірці мусить відкриватись
 * одним дотиком. Замість сесії — сам id рядка sent: це випадковий uuid,
 * відомий лише тому, кому ця добірка надійшла. Підібрати його неможливо, а
 * єдине, що він дає, — відмітку «подався» на власному ж рядку й перехід на
 * публічну сторінку роботодавця.
 *
 * Адресу беремо З БАЗИ за id, ніколи з параметра запиту — інакше це був би
 * відкритий редирект. Невідомий id тихо веде на головну.
 */
import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { safeJobUrl } from "../../../lib/safe-url";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const base = new URL(req.url).origin;

  const row = await one<{ user_id: string; url: string }>(
    "SELECT s.user_id, j.url FROM sent s JOIN jobs_cache j ON j.id=s.job_id WHERE s.id=?", id);
  if (!row) return NextResponse.redirect(`${base}/`, 302);

  await run("UPDATE sent SET applied_at=COALESCE(applied_at, datetime('now')) WHERE id=?", id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", row.user_id);

  // Адреса з бази, але база наповнюється чужими стрічками. Не-https туди
  // не пускаємо: інакше отруєна стрічка робила б із нас редирект куди завгодно.
  const target = safeJobUrl(row.url);
  if (!target) return NextResponse.redirect(`${base}/`, 302);
  return NextResponse.redirect(target, 302);
}
