/**
 * Ранкова добірка: підбір, оформлення, доставка.
 * Запускається щогодини — обслуговує тих, у кого зараз обрана година.
 *
 *   node dist/digest.js [--force] [--user <id>]
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { explainWithClaude, pickTop, type CandidateJob, type Profile } from "./match.js";
import { asLocale, intlOf, say, scanned as scannedLine, thin, type Locale } from "./digest-copy.js";

const DIGEST_SIZE = 5;

interface UserRow {
  id: string; telegram_chat_id: string | null; locale: string;
  timezone: string; delivery_hour: number; status: string; last_interaction_at: string | null;
  spheres: string; industries: string; seniority: string | null;
  remote_mode: string; location: string | null; salary_min: number | null;
  country: string | null;
  custom_role: string | null;
  seniority_weight: number | null;
  location_weight: number | null;
  salary_weight: number | null;
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
  jobs: Array<CandidateJob & { why: string }>,
  scanned: { jobs: number; companies: number },
  locale: Locale
): string {
  const lines = [say(locale, "greeting"), ""];
  jobs.forEach((j, i) => {
    if (i > 0) { lines.push("─────────────"); lines.push(""); }

    // Компанія окремим рядком: очі шукають саме її, а не назву посади.
    lines.push(`${i + 1}. ${j.company}`);
    lines.push(j.title);

    // Другий рядок збираємо лише з того, що справді відоме. «Вилку не вказано»
    // п'ять разів поспіль — це не інформація, а шум: у першій справжній
    // добірці так було в усіх п'яти вакансіях.
    const facts = [
      j.location ?? (j.remote ? say(locale, "remote") : null),
      j.remote && j.location ? say(locale, "remote") : null,
      j.salaryMin
        ? `${say(locale, "from")} ${j.salaryMin.toLocaleString(intlOf(locale))} ${j.salaryCurrency ?? ""}`.trim()
        : null,
    ].filter(Boolean);
    if (facts.length) lines.push(facts.join(" · "));

    lines.push("");
    lines.push(`${say(locale, "why")}: ${j.why}`);
    lines.push("");
    // Голе посилання окремим рядком: частина клієнтів Telegram ріже markdown-лінки
    lines.push(j.url);
    lines.push("");
  });
  lines.push("─────────────");
  lines.push("");
  if (jobs.length < DIGEST_SIZE) {
    lines.push(thin(locale, jobs.length, DIGEST_SIZE));
    lines.push("");
  }
  lines.push(scannedLine(locale, scanned.jobs, scanned.companies));
  return lines.join("\n");
}

async function sendTelegram(
  token: string, chatId: string, text: string, digestId: string, locale: Locale
): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[
        { text: say(locale, "notRelevant"), callback_data: `fb:${digestId}:not_relevant` },
        { text: say(locale, "more"), callback_data: `fb:${digestId}:more` },
      ]] },
    }),
  });
  return res.ok;
}

/**
 * Розбір аргументів.
 *
 * Написане навпростець `argv[argv.indexOf("--user") + 1]` тихо ламало все:
 * без прапорця indexOf дає −1, тож onlyUser ставав argv[0] — шляхом до node.
 * Значення непорожнє, тому кожен плановий прогін звужувався до
 * `u.id = '/usr/local/bin/node'` і не знаходив нікого. Добірки не доходили
 * взагалі, і жодної помилки при цьому не було.
 */
export function parseArgs(argv: string[]): { force: boolean; onlyUser: string | null } {
  const i = argv.indexOf("--user");
  return {
    force: argv.includes("--force"),
    onlyUser: i === -1 ? null : argv[i + 1] ?? null,
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { force, onlyUser } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? null;

  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  const users = await d1.query<UserRow>(
    `SELECT u.*, p.spheres,p.industries,p.seniority,p.remote_mode,p.location,p.salary_min,p.custom_role,p.country,
            t.seniority_weight,t.location_weight,t.salary_weight
     FROM users u JOIN profiles p ON p.user_id = u.id
     LEFT JOIN user_tuning t ON t.user_id = u.id
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
          say(asLocale(u.locale), "checkin"), "checkin", asLocale(u.locale));
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
      const loc = asLocale(u.locale);
      const ok = await sendTelegram(
        botToken, u.telegram_chat_id, formatDigest(retry, scanned, loc), digestId, loc);
      if (ok) {
        await d1.execute("UPDATE sent SET status='sent', sent_at=? WHERE digest_id=?", [now.toISOString(), digestId]);
        delivered++;
        console.log(`  ${u.id.slice(0, 8)}: доставлено відкладену добірку ${digestId.slice(0, 8)}`);
      }
      continue;
    }

    const profile: Profile = {
      userId: u.id, spheres: list(u.spheres), industries: list(u.industries),
      customRole: u.custom_role,
      // Вивчене зі скарг. Немає рядка — усі ваги одиничні, поведінка як була.
      tuning: {
        seniority: u.seniority_weight ?? 1,
        location: u.location_weight ?? 1,
        salary: u.salary_weight ?? 1,
      },
      seniority: u.seniority, remoteMode: u.remote_mode, location: u.location, salaryMin: u.salary_min,
      country: u.country,
    };

    // Шортліст: свіже, ще не надіслане цій людині
    const rows = await d1.query<{
      id: string; company: string; company_key: string; title: string; location: string | null;
      remote: number; url: string; tags: string; posted_at: string | null;
      salary_min: number | null; salary_currency: string | null; dedupe_key: string | null;
      source: string; country: string | null;
    }>(
      // Вікно кандидатів. Чотири правила, кожне з реального прогону:
      //
      // 1. Сортуємо за posted_at, а не fetched_at. Скан пише тисячі рядків за
      //    одну хвилину, тож fetched_at у них однаковий — «найсвіжіші 600» це
      //    не свіжість, а довільний зріз.
      // 2. Не більше трьох вакансій на компанію. Без цього одна фірма з великою
      //    дошкою забирає все вікно: lever:jobgether дав 582 рядки з 600, і
      //    правило «одна роль на компанію» лишало від добірки одну вакансію.
      // 3. Не слати те саме за ЗМІСТОМ, а не лише за рядком у базі. Компанія,
      //    що перевиставила вакансію під новим URL, створює новий id — і людина
      //    отримувала б її вдруге. Таких груп у кеші 398.
      // 4. Тільки те, що ми бачили на дошці нещодавно. Кеш нічого не видаляє
      //    (це зламало б каскад sent.job_id і дозволило б повторно надіслати
      //    вакансію), тому мертві просто не потрапляють у вікно. Три доби —
      //    запас на випадок, якщо скан упав на день.
      // 5. Чужу країну відсікаємо ТУТ, а не після відбору. Національні дошки
      //    дають близько шестисот свіжих вакансій на день; відсортовані за
      //    posted_at, вони заповнили б вікно з 1200 і випали б аж на підборі,
      //    лишивши людину з іншої країни майже без кандидатів. Це та сама
      //    пастка, що колись із lever:jobgether, тільки з іншого боку.
      `SELECT * FROM (
         SELECT j.*, ROW_NUMBER() OVER (
           PARTITION BY j.company_key ORDER BY j.posted_at DESC, j.fetched_at DESC
         ) AS rn
         FROM jobs_cache j
         WHERE j.id NOT IN (SELECT job_id FROM sent WHERE user_id = ?)
           AND j.dedupe_key NOT IN (
             SELECT dedupe_key FROM sent WHERE user_id = ? AND dedupe_key IS NOT NULL)
           AND j.fetched_at >= datetime('now', '-3 day')
           AND (j.country IS NULL OR j.country = ?)
       )
       WHERE rn <= 3
       ORDER BY posted_at DESC, fetched_at DESC
       LIMIT 1200`, [u.id, u.id, u.country]);

    // Ключ змісту не входить у CandidateJob — тримаємо збоку до запису в sent.
    const dedupeById = new Map(rows.map((r) => [r.id, r.dedupe_key ?? null]));

    const candidates: CandidateJob[] = rows.map((r) => ({
      id: r.id, company: r.company, companyKey: r.company_key, title: r.title,
      location: r.location, remote: r.remote === 1, url: r.url, tags: list(r.tags),
      postedAt: r.posted_at, salaryMin: r.salary_min, salaryCurrency: r.salary_currency,
      source: r.source, country: r.country,
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
            say(asLocale(u.locale), "nothingNew"), "none", asLocale(u.locale));
        }
      }
      console.log(`  ${u.id.slice(0, 8)}: нічого не підійшло`);
      continue;
    }

    const why = await explainWithClaude(top, profile, cfg.anthropicApiKey, undefined, async (u) => {
      // Облік не має права зламати доставку: впав запис — добірка все одно йде.
      try {
        await d1.execute(
          `INSERT INTO api_usage (id,service,operation,model,input_tokens,output_tokens,cost_usd,ok)
           VALUES (?,'anthropic','match_reason',?,?,?,0,?)`,
          [crypto.randomUUID(), u.model, u.inputTokens, u.outputTokens, u.ok ? 1 : 0]);
      } catch { /* журнал не важливіший за доставку */ }
    });
    const digestId = crypto.randomUUID();
    const withWhy = top.map((j, i) => ({ ...j, why: why[i]! }));

    await d1.batch(withWhy.map((j) => ({
      sql: `INSERT INTO sent (id,user_id,job_id,digest_id,why_fits,status,sent_at,dedupe_key)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(user_id,job_id) DO NOTHING`,
      params: [crypto.randomUUID(), u.id, j.id, digestId, j.why,
               u.telegram_chat_id && botToken ? "sent" : "pending",
               u.telegram_chat_id && botToken ? now.toISOString() : null,
               dedupeById.get(j.id) ?? null],
    })));

    const locale = asLocale(u.locale);
    const text = formatDigest(withWhy, scanned, locale);
    if (botToken && u.telegram_chat_id) {
      const ok = await sendTelegram(botToken, u.telegram_chat_id, text, digestId, locale);
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

if (process.argv[1]?.endsWith("digest.js")) await main();
