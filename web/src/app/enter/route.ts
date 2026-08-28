import { redirect } from "next/navigation";
import { one, run } from "@/lib/db";
import { createSession } from "@/lib/auth";

/**
 * Разовий вхід із бота: /site видає посилання, дійсне 15 хвилин.
 *
 * Це route handler, а не сторінка, і це принципово: Next не дозволяє
 * встановлювати куки під час рендеру серверного компонента — «HTTP does not
 * allow setting cookies after streaming starts». Раніше тут була сторінка,
 * тож вхід за посиланням падав із 500 щоразу. Знайшлось лише тоді, коли
 * посиланням скористались уперше.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) redirect("/login");

  // Куди вести після входу. Тільки власні шляхи й тільки зі списку:
  // «?to=» з довільним значенням був би відкритим перенаправленням.
  const ALLOWED = ["/dashboard", "/settings", "/admin"];
  const to = url.searchParams.get("to");
  const target = to && ALLOWED.includes(to) ? to : "/dashboard";

  const user = await one<{ id: string; connect_expires_at: string | null }>(
    "SELECT id,connect_expires_at FROM users WHERE connect_token=?", token);

  const fresh = user?.connect_expires_at && new Date(user.connect_expires_at).getTime() > Date.now();
  if (!user || !fresh) redirect("/login?error=badCredentials");

  await run(
    `UPDATE users SET connect_token=NULL, connect_expires_at=NULL,
                      last_interaction_at=datetime('now') WHERE id=?`, user.id);
  await createSession(user.id);
  redirect(target);
}
