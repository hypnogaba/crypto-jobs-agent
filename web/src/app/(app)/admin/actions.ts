"use server";

/**
 * `refresh`, а не `revalidatePath`.
 *
 * У Next 16 це дві різні речі, і ми довго тиснули не ту. `revalidatePath`
 * чистить КЕШ маршруту; сторінка адмінки динамічна (`ƒ` у збірці), кешу в неї
 * немає взагалі, тож виклик чистив порожнє місце. Роутер на клієнті лишався
 * зі старим RSC — і кнопка виглядала мертвою, хоча дія в базі відпрацювала.
 *
 * Це стосувалось УСІХ кнопок панелі, а не лише приймання посилань; на ньому
 * просто стало видно, бо саме воно мало щось домалювати.
 */
import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { all, one, run } from "@/lib/db";
import { safeJobUrl } from "@/lib/safe-url";
import { INTAKE_LIMIT, atsApi, atsListInPage, boardName, classify, countJobs, feedInPage,
         labelOf, tidy, type Provider } from "@/lib/source-link";

/** Перевірка джерела живцем — не чекаючи ранкового прогону. */
export async function checkSource(formData: FormData): Promise<void> {
  await requireAdmin();
  const source = String(formData.get("source") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!/^https?:\/\/\S+$/i.test(url)) return;

  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const ok = res.ok;
    const text = ok ? "" : `HTTP ${res.status}`;
    await run(
      `INSERT INTO sources_state (source_name,status,last_ok_at,consecutive_fail_days,last_error,checked_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(source_name) DO UPDATE SET
         status=excluded.status, last_ok_at=COALESCE(excluded.last_ok_at, sources_state.last_ok_at),
         consecutive_fail_days=excluded.consecutive_fail_days,
         last_error=excluded.last_error, checked_at=datetime('now')`,
      source, ok ? "ok" : "degraded", ok ? new Date().toISOString() : null, ok ? 0 : 1, text || null);
  } catch (e) {
    await run("UPDATE sources_state SET status='degraded', last_error=?, checked_at=datetime('now') WHERE source_name=?",
      (e instanceof Error ? e.message : String(e)).slice(0, 200), source);
  }
  refresh();
}

/** Воскресити джерело, яке позначили мертвим помилково. */
export async function reviveSource(formData: FormData): Promise<void> {
  await requireAdmin();
  await run("UPDATE sources_state SET status='ok', consecutive_fail_days=0, last_error=NULL WHERE source_name=?",
    String(formData.get("source") ?? ""));
  refresh();
}

/** Ключ доступу. Вставив токен — джерело оживає без деплою. */
export async function saveSourceKey(formData: FormData): Promise<void> {
  await requireAdmin();
  const source = String(formData.get("source") ?? "").trim();
  const value = String(formData.get("key") ?? "").trim();
  if (!source) return;
  if (!value) {
    await run("DELETE FROM source_keys WHERE source_name=?", source);
  } else {
    await run(
      `INSERT INTO source_keys (source_name,key_value,updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(source_name) DO UPDATE SET key_value=excluded.key_value, updated_at=datetime('now')`,
      source, value);
  }
  refresh();
}

/** Додати компанію вручну в постійний список. */
export async function addCompany(formData: FormData): Promise<void> {
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || slug;
  const provider = String(formData.get("provider") ?? "").trim() || null;
  if (!slug) return;
  await run(
    `INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
     VALUES (?,?,?,?,'[]','manual',datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider`,
    slug, name, provider, slug);
  refresh();
}

/**
 * Відповідь на відгук просто в Telegram людини.
 *
 * Контакт зберігається як `tg:<chat_id>`, коли відгук прийшов із бота, — тож
 * відповісти можна тим самим ботом, без пошти й без окремого каналу.
 */
export async function replyToFeedback(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("reply") ?? "").trim();
  if (!id || text.length < 2) return;

  const row = await one<{ contact: string | null }>(
    "SELECT contact FROM site_feedback WHERE id=?", id);
  // Контакт із сайту — вільний текст: «tg:<id>» там міг написати будь-хто.
  // Відповідаємо лише в чат, який справді є нашим користувачем.
  const claimed = row?.contact?.startsWith("tg:") ? row.contact.slice(3) : null;
  const known = claimed
    ? await one<{ n: number }>("SELECT 1 n FROM users WHERE telegram_chat_id=?", claimed) : null;
  const chat = known ? claimed : null;

  const { env } = getCloudflareContext();
  const token = (env as unknown as Record<string, string | undefined>).TELEGRAM_BOT_TOKEN;

  if (chat && token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `Відповідь на твій відгук:\n\n${text}` }),
    });
  }

  // Позначаємо розібраним у будь-якому разі: якщо контакту немає, власник
  // усе одно прочитав і вирішив.
  await run("UPDATE site_feedback SET handled_at=datetime('now') WHERE id=?", id);
  refresh();
}

/** Прочитано й нічого відповідати. */
export async function dismissFeedback(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await run("UPDATE site_feedback SET handled_at=datetime('now') WHERE id=?", id);
  refresh();
}

/**
 * Прибрати всі джерела, які жодного разу нічого не дали.
 *
 * Їх 142 із 144 «зламаних»: зібрані з ATS-лінків у даних Getro без перевірки,
 * а дошки вже 404. Список із них — не робота, а шум. Це чиста операція в базі,
 * без жодного мережевого запиту, тож безпечна за будь-якої кількості.
 */
export async function purgeNeverWorked(): Promise<void> {
  await requireAdmin();
  await run(
    `UPDATE sources_state SET status='deprecated'
      WHERE status<>'ok' AND status<>'deprecated' AND last_ok_at IS NULL`);
  refresh();
}

/**
 * Перевірити наживо кілька джерел одразу.
 *
 * Обмежено п'ятнадцятьма: воркер має ліміт зовнішніх запитів на одне
 * виконання, і спроба перевірити всі 144 просто впала б посередині.
 */
export async function recheckSome(formData: FormData): Promise<void> {
  await requireAdmin();
  const kind = String(formData.get("kind") ?? "");

  const rows = await all<{ source_name: string; last_error: string | null }>(
    kind === "blocked"
      ? `SELECT source_name,last_error FROM sources_state
          WHERE status<>'ok' AND (last_error LIKE '%403%' OR last_error LIKE '%429%') LIMIT 15`
      : `SELECT source_name,last_error FROM sources_state
          WHERE status<>'ok' AND last_ok_at IS NOT NULL LIMIT 15`);

  for (const r of rows) {
    const url = /https?:\/\/\S+/.exec(r.last_error ?? "")?.[0]?.replace(/\s*→.*$/, "");
    if (!url) continue;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      await run(
        `UPDATE sources_state
            SET status=?, last_error=?, checked_at=datetime('now'),
                last_ok_at=CASE WHEN ? THEN datetime('now') ELSE last_ok_at END,
                consecutive_fail_days=CASE WHEN ? THEN 0 ELSE consecutive_fail_days END
          WHERE source_name=?`,
        res.ok ? "ok" : "degraded",
        res.ok ? null : `${url} → ${res.status}`,
        res.ok ? 1 : 0, res.ok ? 1 : 0, r.source_name);
    } catch {
      // мережа підвела — лишаємо як було, це не вирок джерелу
    }
  }
  refresh();
}

/**
 * Що саме робить кожен вид пропозиції.
 *
 * Однотипне виконується гуртом одним запитом: пропозиція «прибрати 142 дошки»
 * і має бути одним рухом, інакше вона знову перетвориться на сотню кнопок.
 */
async function execute(kind: string, target: string | null): Promise<void> {
  if (kind === "deprecate_never_worked") {
    await run(
      `UPDATE sources_state SET status='deprecated'
        WHERE status<>'ok' AND status<>'deprecated' AND last_ok_at IS NULL`);
  } else if (kind === "revive_source" && target) {
    await run(
      `UPDATE sources_state SET status='ok', consecutive_fail_days=0, last_error=NULL,
                                checked_at=datetime('now') WHERE source_name=?`, target);
  } else if (kind === "drop_dry_companies") {
    const limit = Number.parseInt(target ?? "30", 10) || 30;
    await run("DELETE FROM companies WHERE dry_scans >= ?", limit);
  }
  // notice виконувати нічого — його лише закривають
}

/**
 * Виконати пропозицію тижневого самоперегляду.
 *
 * Кожен вид знає рівно одну дію. Якщо системи не навчено її виконувати —
 * такої пропозиції просто не існує (див. scanner/src/review.ts), тому тут
 * немає гілки «а що робити з цим».
 */
export async function applyProposal(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const p = await one<{ kind: string; target: string | null; status: string }>(
    "SELECT kind,target,status FROM proposals WHERE id=?", id);
  if (!p || p.status !== "open") return;

  await execute(p.kind, p.target);
  // notice виконувати нічого — його лише закривають

  await run("UPDATE proposals SET status='applied', resolved_at=datetime('now') WHERE id=?", id);
  refresh();
}

export async function dismissProposal(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await run("UPDATE proposals SET status='dismissed', resolved_at=datetime('now') WHERE id=?", id);
  refresh();
}

/** «Застосувати все» для одного рівня важливості — щоб не тиснути тридцять разів. */
export async function applyAllProposals(formData: FormData): Promise<void> {
  await requireAdmin();
  const severity = String(formData.get("severity") ?? "");
  if (!["high", "medium", "low"].includes(severity)) return;

  const rows = await all<{ id: string; kind: string; target: string | null }>(
    "SELECT id,kind,target FROM proposals WHERE status='open' AND severity=? AND kind<>'notice'",
    severity);

  for (const r of rows) {
    await execute(r.kind, r.target);
    await run("UPDATE proposals SET status='applied', resolved_at=datetime('now') WHERE id=?", r.id);
  }
  refresh();
}

// ── національні дошки ────────────────────────────────────────

/**
 * Додати дошку країни.
 *
 * Перевіряємо стрічку ПЕРЕД записом. Дошка, додана наосліп, живе в списку
 * тижнями й мовчки нічого не дає — саме так у нас з'явилось півтори тисячі
 * мертвих джерел. Тому адреса, яка не віддає жодного <item>, у базу не
 * потрапляє взагалі.
 */
export async function addBoard(formData: FormData): Promise<void> {
  await requireAdmin();
  const country = String(formData.get("country") ?? "").trim().toUpperCase();
  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!/^[A-Z]{2}$/.test(country) || !label || !/^https?:\/\/\S+$/i.test(url)) return;

  let items = 0;
  try {
    const res = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
    if (res.ok) items = ((await res.text()).match(/<item[\s>]/g) ?? []).length;
  } catch { /* нижче розберемось */ }
  if (items === 0) return;

  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  await run(
    `INSERT INTO country_boards (id,country,name,label,feed_url,kind)
     VALUES (?,?,?,?,?,'rss') ON CONFLICT(name) DO NOTHING`,
    crypto.randomUUID(), country, `board:${country.toLowerCase()}-${slug}`, label, url);
  refresh();
}

/** Вимкнути або ввімкнути дошку, не втрачаючи її адреси. */
export async function toggleBoard(formData: FormData): Promise<void> {
  await requireAdmin();
  await run("UPDATE country_boards SET enabled = 1 - enabled WHERE id=?",
    String(formData.get("id") ?? ""));
  refresh();
}

/**
 * Перемикач цілої дошки, а не однієї рубрики.
 *
 * DOU — це 24 рядки в таблиці: сама дошка й 23 рубрики. Вимикати їх по
 * одному безглуздо, тому вимикаємо групою. Мітка рубрики — «DOU · Python»,
 * тож група — це все, що починається з «DOU».
 */
export async function toggleBoardGroup(formData: FormData): Promise<void> {
  await requireAdmin();
  const country = String(formData.get("country") ?? "");
  const board = String(formData.get("board") ?? "");
  if (!country || !board) return;

  // Вимикаємо, якщо увімкнена хоч одна; вмикаємо, коли вимкнені всі.
  await run(
    `UPDATE country_boards
        SET enabled = CASE WHEN EXISTS (
              SELECT 1 FROM country_boards x
               WHERE x.country=?1 AND (x.label=?2 OR x.label LIKE ?2 || ' · %') AND x.enabled=1
            ) THEN 0 ELSE 1 END
      WHERE country=?1 AND (label=?2 OR label LIKE ?2 || ' · %')`,
    country, board);
  refresh();
}

// ── джерела зі вставленого посилання ─────────────────────────

/** Один запит із коротким терпінням: мертвий хост не має тримати всю форму. */
async function probe(url: string): Promise<{ ok: boolean; body: string; note: string }> {
  // Той самий захист, що й на редиректах: адресу вставляє людина, а йде за
  // нею наш Worker зсередини мережі Cloudflare.
  const safe = safeJobUrl(url);
  if (!safe) return { ok: false, body: "", note: "адреса не https або веде на локальний хост" };
  try {
    const res = await fetch(safe, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "application/json, application/rss+xml, application/xml, text/html",
        // Без пізнаваного клієнта частина дошок віддає 403, і живе джерело
        // виглядало б мертвим.
        "User-Agent": "NextRoleBot/1.0 (+https://nextrole.info)",
      },
    });
    if (!res.ok) return { ok: false, body: "", note: `HTTP ${res.status}` };
    return { ok: true, body: (await res.text()).slice(0, 500_000), note: "" };
  } catch (e) {
    return { ok: false, body: "", note: e instanceof Error ? e.message.slice(0, 120) : "не відповідає" };
  }
}

async function record(url: string, verdict: string, kind: string | null,
                      target: string | null, note: string, found: number): Promise<void> {
  await run(
    "INSERT INTO source_intake (id,url,verdict,kind,target,note,found) VALUES (?,?,?,?,?,?,?)",
    crypto.randomUUID(), url.slice(0, 500), verdict, kind, target, note.slice(0, 300), found);
}

/** Компанія на ATS: перевіряємо її відкритий API тим самим викликом, що й сканер. */
async function takeAts(provider: Provider, slug: string, from: string): Promise<void> {
  const dup = await one<{ slug: string }>("SELECT slug FROM companies WHERE slug=?", slug);
  if (dup) { await record(from, "duplicate", "ats", slug, `${provider} вже у списку`, 0); return; }

  const r = await probe(atsApi(provider, slug));
  const n = r.ok ? countJobs(r.body) : 0;
  if (n === 0) {
    await record(from, r.ok ? "empty" : "unreachable", "ats", slug,
      r.ok ? `${provider}/${slug} відповів, але вакансій нуль` : `${provider}: ${r.note}`, 0);
    return;
  }
  await run(
    `INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
     VALUES (?,?,?,?,'[]','link',datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug`,
    slug, slug, provider, slug);
  await record(from, "added", "ats", slug, `${provider} · ${n} вакансій зараз`, n);
}

/** Стрічка: назву й країну беремо з неї самої, щоб не питати їх окремо. */
async function takeFeed(feedUrl: string, country: string, host: string, from: string): Promise<void> {
  const dup = await one<{ name: string }>("SELECT name FROM country_boards WHERE feed_url=?", feedUrl);
  if (dup) { await record(from, "duplicate", "board", dup.name, "ця стрічка вже читається", 0); return; }

  const r = await probe(feedUrl);
  const n = r.ok ? countJobs(r.body) : 0;
  if (n === 0) {
    await record(from, r.ok ? "empty" : "unreachable", "board", null,
      r.ok ? "стрічка відкрилась, але вакансій у ній нуль" : r.note, 0);
    return;
  }
  const label = labelOf(feedUrl, host);
  const name = boardName(country, label);

  /**
   * Ім'я стає відоме лише тут, після запиту, і воно може бути зайняте іншою
   * стрічкою: слаг збирається з латиниці, тож «DOU · Пайтон» і «DOU» дають
   * однакове `board:ua-dou`. Адреса вже перевірена вище — отже, ця стрічка
   * нова, і відмовити їй було б помилкою. Тому шукаємо вільне ім'я.
   *
   * `ON CONFLICT DO NOTHING` тут не рятує: він мовчки не вставив би нічого,
   * а журнал сказав би «додано».
   */
  let unique = name;
  for (let i = 2; i <= 9; i++) {
    const taken = await one<{ id: string }>("SELECT id FROM country_boards WHERE name=?", unique);
    if (!taken) break;
    unique = `${name}-${i}`;
  }

  await run(
    `INSERT INTO country_boards (id,country,name,label,feed_url,kind)
     VALUES (?,?,?,?,?,'rss') ON CONFLICT(name) DO NOTHING`,
    crypto.randomUUID(), country, unique, label, feedUrl);
  await record(from, "added", "board", unique,
    `${label} · ${country === "*" ? "глобальна" : country} · ${n} вакансій зараз`, n);
}

/**
 * Одне посилання → джерело в базі.
 *
 * Порядок навмисний: спершу дешеве (чи не додано вже), потім один запит, і
 * лише тоді запис. Джерело, додане без перевірки, живе в списку тижнями й
 * мовчки нічого не дає — саме так у нас з'явилось півтори тисячі мертвих
 * рядків. Тому те, що не віддало жодної вакансії, у базу не потрапляє; але,
 * на відміну від старої форми, тепер про це лишається слід із причиною.
 */
async function intake(url: string): Promise<void> {
  const g = classify(url);
  if (!g) { await record(url, "unknown", null, null, "не схоже на адресу", 0); return; }

  if (g.kind === "ats" && g.provider && g.slug) return takeAts(g.provider, g.slug, g.url);
  if (g.kind === "feed") return takeFeed(g.url, g.country, g.host, g.url);

  // Звичайна сторінка. Відкриваємо один раз і читаємо, що вона про себе
  // каже: посилання на свій ATS або оголошену в <head> стрічку. Глибше не
  // йдемо — обхід сайту з адмінки перетворився б на павука.
  const r = await probe(g.url);
  if (!r.ok) { await record(g.url, "unreachable", null, null, r.note, 0); return; }

  // Стрічка йде першою: вона дає ВСІ вакансії дошки й оновлюється сама,
  // тоді як список компаній зі сторінки — лише те, що вмістилось на перший
  // екран.
  const feed = feedInPage(r.body, g.url);
  if (feed) return takeFeed(feed, g.country, g.host, g.url);

  const ats = atsListInPage(r.body);

  // Одна компанія — це її власний «Careers».
  if (ats.length === 1) return takeAts(ats[0]!.provider, ats[0]!.slug, g.url);

  /**
   * Кілька — це дошка, і тоді забираємо всіх. Саме так влаштовані борди Getro
   * (jobs.solana.com, jobs.avax.network): посилання ведуть просто в ATS
   * роботодавця, і «додати сайт» означає «взяти собі його компанії».
   *
   * Перевіряти кожну живцем тут не можна — це десятки запитів понад ліміт
   * підзапитів воркера. Тому пишемо їх у список без проби: сканер опитає їх
   * уранці, а самолікування прибере мертві. Ризик тут інший, ніж у дошки:
   * зайва компанія коштує один запит на прогін, а не порожню стрічку назавжди.
   */
  if (ats.length > 1) {
    let added = 0;
    for (const c of ats) {
      const dup = await one<{ slug: string }>("SELECT slug FROM companies WHERE slug=?", c.slug);
      if (dup) continue;
      await run(
        `INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
         VALUES (?,?,?,?,'[]','link_board',datetime('now'))
         ON CONFLICT(slug) DO NOTHING`,
        c.slug, c.slug, c.provider, c.slug);
      added++;
    }
    await record(g.url, added > 0 ? "added" : "duplicate", "board_of_companies", g.host,
      added > 0
        ? `дошка компаній: ${added} нових із ${ats.length} на сторінці`
        : `усі ${ats.length} компаній зі сторінки вже у списку`, added);
    return;
  }

  await record(g.url, "unknown", null, null,
    "сторінка відкрилась, але ні ATS, ні стрічки в ній не оголошено — найпевніше вона малюється скриптом, і ми бачимо порожній каркас", 0);
}

/**
 * Вставлені посилання. Одне на рядок або просто через пробіл: люди копіюють
 * як вийде, і розділяти це має програма, а не людина.
 */
export async function addSources(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = String(formData.get("links") ?? "");
  const urls = [...new Set(
    raw.split(/[\s,;]+/).map((x) => tidy(x)).filter((x): x is string => Boolean(x)))]
    .slice(0, INTAKE_LIMIT);

  for (const u of urls) await intake(u);
  refresh();
}

/** Прибрати рядок із журналу — розібрався й не хочеш його більше бачити. */
export async function forgetIntake(formData: FormData): Promise<void> {
  await requireAdmin();
  await run("DELETE FROM source_intake WHERE id=?", String(formData.get("id") ?? ""));
  refresh();
}

/**
 * Підтягнути ніки тих, хто прив'язав Telegram до появи цього поля.
 *
 * Нові беруться самі з кожного оновлення у вебхуку. Але шестеро перших
 * писали боту раніше, і для них у базі порожньо, поки вони не напишуть ще
 * раз, — а саме їх власник і хоче впізнати сьогодні. `getChat` віддає нік
 * за chat_id, і це рівно один запит на людину.
 */
export async function refreshTelegramNames(): Promise<void> {
  await requireAdmin();
  const { env } = getCloudflareContext();
  const token = (env as unknown as Record<string, string | undefined>).TELEGRAM_BOT_TOKEN;
  if (!token) return;

  // Ліміт підзапитів Worker'а той самий, що й у прийманні посилань.
  const rows = await all<{ id: string; telegram_chat_id: string }>(
    `SELECT id, telegram_chat_id FROM users
      WHERE telegram_chat_id IS NOT NULL AND telegram_username IS NULL AND telegram_name IS NULL
      LIMIT 20`);

  for (const u of rows) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ chat_id: u.telegram_chat_id }),
      });
      const body = await res.json() as { ok?: boolean;
        result?: { username?: string; first_name?: string; last_name?: string } };
      if (!body.ok || !body.result) continue;
      const name = [body.result.first_name, body.result.last_name].filter(Boolean).join(" ") || null;
      await run("UPDATE users SET telegram_username=?, telegram_name=? WHERE id=?",
        body.result.username ?? null, name, u.id);
    } catch {
      // Людина могла заблокувати бота — це не привід валити всю кнопку.
    }
  }
  refresh();
}
