/**
 * Подача на вакансію.
 *
 * Одне натискання робить дві речі: веде людину на сторінку роботодавця і
 * лишає слід у кабінеті. Тому це маршрут, а не форма — так кнопка може
 * бути звичайним посиланням у нову вкладку й працює без JavaScript.
 *
 * Адресу беремо З БАЗИ за id рядка, ніколи з параметра запиту. Інакше це
 * був би відкритий редирект: будь-хто міг би підсунути свою адресу.
 */
import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const base = new URL(req.url).origin;

  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${base}/login`, 302);

  // Умова user_id — це і є перевірка власності. Чужий id просто не знайдеться.
  const row = await one<{ url: string }>(
    `SELECT j.url FROM sent s JOIN jobs_cache j ON j.id = s.job_id
      WHERE s.id=? AND s.user_id=?`, id, user.id);
  if (!row) return NextResponse.redirect(`${base}/dashboard`, 302);

  await run(
    "UPDATE sent SET applied_at=COALESCE(applied_at, datetime('now')) WHERE id=? AND user_id=?",
    id, user.id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);

  return NextResponse.redirect(row.url, 302);
}
