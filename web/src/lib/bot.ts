import { one, run, uuid } from "./db";

/** Команди бота. Кабінет у чаті — мінімальний, повний лишається на сайті. */

type Env = Record<string, string | undefined>;

async function send(env: Env, chatId: number, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

export async function startBotOnboarding(env: Env, chatId: number): Promise<void> {
  const existing = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (existing) {
    await send(env, chatId, "Ти вже підключений. /profile — подивитись профіль, /pause — призупинити.");
    return;
  }
  await send(env, chatId,
    "Привіт. Я щоранку надсилаю п'ять вакансій, підібраних під тебе.\n\n" +
    "Напиши одним реченням, яку роботу шукаєш — наприклад «партнерства у web3, віддалено, від €80k». " +
    "Або надішли своє резюме текстом.");
}

export async function continueBotOnboarding(env: Env, chatId: number, data: string): Promise<void> {
  const user = await one<{ id: string }>("SELECT id FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!user) return;

  if (data.startsWith("fb:")) {
    const [, digestId, reaction] = data.split(":");
    if (digestId && (reaction === "not_relevant" || reaction === "more")) {
      await run("INSERT INTO feedback (id,user_id,digest_id,reaction) VALUES (?,?,?,?)",
        uuid(), user.id, digestId, reaction);
      await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
      if (reaction === "more") {
        // Черга, а не обіцянка: сайт на Workers не дотягнеться до сканера,
        // тому запит підбирає сервер під час найближчого прогону доставки.
        await run("INSERT INTO delivery_requests (id,user_id) VALUES (?,?)", uuid(), user.id);
        await send(env, chatId, "Прийняв. Наступна добірка прийде протягом години.");
      } else {
        await send(env, chatId, "Дякую, врахую. Завтрашня добірка буде точнішою.");
      }
    }
  }
}

export async function handleCommand(env: Env, chatId: number, text: string): Promise<void> {
  const user = await one<{ id: string; status: string }>(
    "SELECT id,status FROM users WHERE telegram_chat_id=?", String(chatId));
  const cmd = text.split(/\s+/)[0]!.replace(/@\w+$/, "");

  if (!user && cmd !== "/start") {
    await send(env, chatId, "Спершу /start, щоб я знав, кого шукати.");
    return;
  }

  switch (cmd) {
    case "/pause":
      await run("UPDATE users SET status='paused', paused_reason='manual' WHERE id=?", user!.id);
      await send(env, chatId, "Призупинив. /resume коли захочеш повернутись.");
      break;

    case "/resume":
      await run("UPDATE users SET status='active', paused_reason=NULL, last_interaction_at=datetime('now') WHERE id=?", user!.id);
      await send(env, chatId, "Відновив. Наступна добірка прийде вранці.");
      break;

    case "/profile": {
      const p = await one<{ spheres: string; seniority: string | null; remote_mode: string; salary_min: number | null }>(
        "SELECT spheres,seniority,remote_mode,salary_min FROM profiles WHERE user_id=?", user!.id);
      await send(env, chatId, p
        ? `Сфери: ${(JSON.parse(p.spheres || "[]") as string[]).join(", ") || "—"}\n` +
          `Рівень: ${p.seniority ?? "—"}\nРобота: ${p.remote_mode}\n` +
          `Зарплата від: ${p.salary_min ?? "—"}\n\nЩоб змінити — просто напиши новий опис.`
        : "Профілю ще немає. Напиши, яку роботу шукаєш.");
      break;
    }

    case "/site": {
      const token = crypto.randomUUID().replace(/-/g, "");
      await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?",
        token, new Date(Date.now() + 15 * 60_000).toISOString(), user!.id);
      const base = env.SITE_URL ?? "https://nextrole.info";
      await send(env, chatId, `Разове посилання для входу, дійсне 15 хвилин:\n${base}/enter?token=${token}`);
      break;
    }

    case "/delete":
      await run("DELETE FROM users WHERE id=?", user!.id);
      await send(env, chatId, "Видалив акаунт і всі дані. Захочеш повернутись — просто /start.");
      break;

    default:
      await send(env, chatId,
        "/profile — профіль\n/pause і /resume — пауза\n/site — вхід на сайт\n/delete — видалити все");
  }
}
