/**
 * Ранкова добірка: підбір, оформлення, доставка.
 * Запускається щогодини — обслуговує тих, у кого зараз обрана година.
 *
 *   node dist/digest.js [--force] [--user <id>]
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { explainWithClaude, pickTop, type CandidateJob, type Profile } from "./match.js";

const DIGEST_SIZE = 5;

interface UserRow {
  id: string; telegram_chat_id: string | null; locale: string;
  timezone: string; delivery_hour: number; status: string; last_interaction_at: string | null;
  spheres: string; industries: string; seniority: string | null;
  remote_mode: string; location: string | null; salary_min: number | null;
}

const list = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Котра зараз година в поясі людини. Без цього «07:00» безглузде для світу. */
function hourIn(timezone: string, now: Date): number {
  try {
    return Number.parseInt(new Intl.DateTimeFormat("en-GB",
      { timeZone: timezone, hour: "2-digit", hour12: false }).format(now), 10);
  } catch {
    return now.getUTCHours();
  }
}

function formatDigest(
  jobs: Array<CandidateJob & { why: string }>, scanned: { jobs: number; companies: number }
): string {
  const lines = ["Доброго ранку. Ось що знайшлось сьогодні.", ""];
  jobs.forEach((j, i) => {
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push(`${i + 1} · ${j.company} — ${j.title}`);
    const money = j.salaryMin ? `${j.salaryMin.toLocaleString("uk-UA")} ${j.salaryCurrency ?? ""}`.trim() : "вилку не вказано";
    lines.push(`${j.location ?? (j.remote ? "віддалено" : "локація не вказана")} · ${money}`);
    lines.push("");
    lines.push(`Чому ти: ${j.why}`);
    lines.push("");
    // Голе посилання окремим рядком: частина клієнтів Telegram ріже markdown-лінки
    lines.push(j.url);
    lines.push("");
  });
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  if (jobs.length < DIGEST_SIZE) {
    lines.push(`Сьогодні менше ніж зазвичай — ${jobs.length} замість ${DIGEST_SIZE}. Ми копали глибше, але кращого не знайшли.`);
    lines.push("");
  }
  lines.push(`Переглянуто ${scanned.jobs.toLocaleString("uk-UA")} вакансій у ${scanned.companies} компаніях.`);
  return lines.join("\n");
}

async function sendTelegram(token: string, chatId: string, text: string, digestId: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[
        { text: "Не те, що треба", callback_data: `fb:${digestId}:not_relevant` },
        { text: "Ще п'ять", callback_data: `fb:${digestId}:more` },
      ]] },
    }),
  });
  return res.ok;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const force = process.argv.includes("--force");
  const onlyUser = process.argv[process.argv.indexOf("--user") + 1];
  const now = new Date();
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? null;

  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  const users = await d1.query<UserRow>(
    `SELECT u.*, p.spheres,p.industries,p.seniority,p.remote_mode,p.location,p.salary_min
     FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'active'` + (onlyUser ? " AND u.id = ?" : ""),
    onlyUser ? [onlyUser] : []);

  const scanned = (await d1.query<{ jobs: number; companies: number }>(
    "SELECT COUNT(*) AS jobs, COUNT(DISTINCT company_key) AS companies FROM jobs_cache"))[0]
    ?? { jobs: 0, companies: 0 };

  // Хто натиснув «Ще п'ять»: їм добірка йде поза розкладом
  const requested = new Set((await d1.query<{ user_id: string }>(
    "SELECT DISTINCT user_id FROM delivery_requests WHERE handled_at IS NULL"
  )).map((r) => r.user_id));
  if (requested.size > 0) console.log(`Запитів «ще»: ${requested.size}`);

  let delivered = 0;
  for (const u of users) {
    const onRequest = requested.has(u.id);
    if (!force && !onRequest && hourIn(u.timezone, now) !== u.delivery_hour) continue;

    // ── автопауза після 14 днів повної тиші ──
    // Того, хто щойно попросив ще, паузити безглуздо: він якраз активний.
    if (u.last_interaction_at && !onRequest) {
      const silentDays = (now.getTime() - new Date(u.last_interaction_at).getTime()) / 86_400_000;
      if (silentDays > 17) {
        await d1.execute("UPDATE users SET status='paused', paused_reason='inactive' WHERE id=?", [u.id]);
        console.log(`  ${u.id.slice(0, 8)}: пауза після ${Math.round(silentDays)} днів тиші`);
        continue;
      }
      if (silentDays > 14 && silentDays <= 15 && botToken && u.telegram_chat_id) {
        await sendTelegram(botToken, u.telegram_chat_id,
          "Ти ще шукаєш роботу? Якщо так — просто натисни будь-яку кнопку або напиши щось. " +
          "Якщо ні, я поставлю добірки на паузу за кілька днів.", "checkin");
      }
    }

    // ── Спершу дотиснути непроставлене ──
    // Запис зі статусом pending означає «підібрано, але не доставлено».
    // Без цієї гілки такі рядки блокували б вакансію назавжди: вона вже в sent,
    // тому в шортліст більше не потрапляє, а людина її так і не побачила.
    const pending = await d1.query<{ digest_id: string }>(
      "SELECT DISTINCT digest_id FROM sent WHERE user_id=? AND status='pending' ORDER BY created_at LIMIT 1", [u.id]);
    if (pending.length > 0 && botToken && u.telegram_chat_id) {
      const digestId = pending[0]!.digest_id;
      const rows2 = await d1.query<{ company: string; title: string; location: string | null; remote: number;
        url: string; why_fits: string; salary_min: number | null; salary_currency: string | null }>(
        `SELECT j.company,j.title,j.location,j.remote,j.url,s.why_fits,j.salary_min,j.salary_currency
         FROM sent s JOIN jobs_cache j ON j.id=s.job_id
         WHERE s.user_id=? AND s.digest_id=?`, [u.id, digestId]);
      const retry = rows2.map((r) => ({
        id: "", companyKey: "", tags: [], postedAt: null,
        company: r.company, title: r.title, location: r.location, remote: r.remote === 1,
        url: r.url, salaryMin: r.salary_min, salaryCurrency: r.salary_currency, why: r.why_fits }));
      const ok = await sendTelegram(botToken, u.telegram_chat_id, formatDigest(retry, scanned), digestId);
      if (ok) {
        await d1.execute("UPDATE sent SET status='sent', sent_at=? WHERE digest_id=?", [now.toISOString(), digestId]);
        delivered++;
        console.log(`  ${u.id.slice(0, 8)}: доставлено відкладену добірку ${digestId.slice(0, 8)}`);
      }
      continue;
    }

    const profile: Profile = {
      userId: u.id, spheres: list(u.spheres), industries: list(u.industries),
      seniority: u.seniority, remoteMode: u.remote_mode, location: u.location, salaryMin: u.salary_min,
    };

    // Шортліст: свіже, ще не надіслане цій людині
    const rows = await d1.query<{
      id: string; company: string; company_key: string; title: string; location: string | null;
      remote: number; url: string; tags: string; posted_at: string | null;
      salary_min: number | null; salary_currency: string | null;
    }>(
      `SELECT j.* FROM jobs_cache j
       WHERE j.id NOT IN (SELECT job_id FROM sent WHERE user_id = ?)
       ORDER BY j.fetched_at DESC LIMIT 600`, [u.id]);

    const candidates: CandidateJob[] = rows.map((r) => ({
      id: r.id, company: r.company, companyKey: r.company_key, title: r.title,
      location: r.location, remote: r.remote === 1, url: r.url, tags: list(r.tags),
      postedAt: r.posted_at, salaryMin: r.salary_min, salaryCurrency: r.salary_currency,
    }));

    const top = pickTop(candidates, profile, DIGEST_SIZE, now);
    if (top.length === 0) {
      // Запит закриваємо навіть без результату — інакше він висітиме вічно
      if (onRequest) {
        await d1.execute(
          "UPDATE delivery_requests SET handled_at=datetime('now') WHERE user_id=? AND handled_at IS NULL",
          [u.id]);
        if (botToken && u.telegram_chat_id) {
          await sendTelegram(botToken, u.telegram_chat_id,
            "Поки що більше нічого нового під твій профіль. Наступна добірка — вранці.", "none");
        }
      }
      console.log(`  ${u.id.slice(0, 8)}: нічого не підійшло`);
      continue;
    }

    const why = await explainWithClaude(top, profile, cfg.anthropicApiKey);
    const digestId = crypto.randomUUID();
    const withWhy = top.map((j, i) => ({ ...j, why: why[i]! }));

    await d1.batch(withWhy.map((j) => ({
      sql: `INSERT INTO sent (id,user_id,job_id,digest_id,why_fits,status,sent_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(user_id,job_id) DO NOTHING`,
      params: [crypto.randomUUID(), u.id, j.id, digestId, j.why,
               u.telegram_chat_id && botToken ? "sent" : "pending",
               u.telegram_chat_id && botToken ? now.toISOString() : null],
    })));

    const text = formatDigest(withWhy, scanned);
    if (botToken && u.telegram_chat_id) {
      const ok = await sendTelegram(botToken, u.telegram_chat_id, text, digestId);
      if (!ok) {
        await d1.execute("UPDATE sent SET status='pending', sent_at=NULL WHERE digest_id=?", [digestId]);
        console.log(`  ${u.id.slice(0, 8)}: доставка не вдалась, спробуємо наступного прогону`);
        continue;
      }
      delivered++;
      if (onRequest) {
        await d1.execute(
          "UPDATE delivery_requests SET handled_at=datetime('now') WHERE user_id=? AND handled_at IS NULL",
          [u.id]);
      }
      console.log(`  ${u.id.slice(0, 8)}: надіслано ${withWhy.length}${onRequest ? " (на запит)" : ""}`);
    } else {
      console.log(`  ${u.id.slice(0, 8)}: підібрано ${withWhy.length}, доставка чекає на токен бота`);
      if (process.env.PRINT_DIGEST) console.log("\n" + text + "\n");
    }
  }

  console.log(`Добірка: оброблено ${users.length} профілів, доставлено ${delivered}.`);
}

await main();
