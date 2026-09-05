import { redirect } from "next/navigation";
import { run } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { verifyConnectToken } from "@/lib/connect-token";

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
  // Обрізане посилання (месенджер зламав рядок, скопіювали не все) для людини
  // це та сама мертва адреса, що й погашений токен, тож і причину віддаємо ту
  // саму. Голий /login без причини лишається для тих, хто прийшов із шапки.
  if (!token) redirect("/login?error=badCredentials");

  // Куди вести після входу. Тільки власні шляхи й тільки зі списку:
  // «?to=» з довільним значенням був би відкритим перенаправленням.
  const ALLOWED = ["/dashboard", "/settings", "/admin"];
  const to = url.searchParams.get("to");
  const target = to && ALLOWED.includes(to) ? to : "/dashboard";

  // Лише токен, виданий САМЕ для входу. Досі сюди годився й токен прив'язки
  // зі сторінки 03/03 — тобто хто побачив t.me-посилання (скриншот, переслане
  // повідомлення, історія браузера), той відмикав кабінет на 30 днів.
  // Призначення сидить у самому дайджесті, тож чужий токен не знаходить рядка,
  // а не «знаходить і не проходить перевірку».
  const user = await verifyConnectToken("enter", token);
  if (!user) redirect("/login?error=badCredentials");

  // Гасимо ДО createSession: одноразовість — єдине, що обмежує токен, який уже
  // осів у логах Cloudflare і в історії браузера як частина адреси.
  await run(
    `UPDATE users SET connect_token_hash=NULL, connect_expires_at=NULL,
                      last_interaction_at=datetime('now') WHERE id=?`, user.id);
  await createSession(user.id);
  redirect(target);
}
