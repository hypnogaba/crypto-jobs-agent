"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { all, one, run } from "@/lib/db";

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
  revalidatePath("/admin");
}

/** Воскресити джерело, яке позначили мертвим помилково. */
export async function reviveSource(formData: FormData): Promise<void> {
  await requireAdmin();
  await run("UPDATE sources_state SET status='ok', consecutive_fail_days=0, last_error=NULL WHERE source_name=?",
    String(formData.get("source") ?? ""));
  revalidatePath("/admin");
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
  revalidatePath("/admin");
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
  revalidatePath("/admin");
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
  revalidatePath("/admin");
}

/** Прочитано й нічого відповідати. */
export async function dismissFeedback(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await run("UPDATE site_feedback SET handled_at=datetime('now') WHERE id=?", id);
  revalidatePath("/admin");
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
  revalidatePath("/admin");
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
  revalidatePath("/admin");
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
  revalidatePath("/admin");
}

export async function dismissProposal(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await run("UPDATE proposals SET status='dismissed', resolved_at=datetime('now') WHERE id=?", id);
  revalidatePath("/admin");
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
  revalidatePath("/admin");
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
  revalidatePath("/admin");
}

/** Вимкнути або ввімкнути дошку, не втрачаючи її адреси. */
export async function toggleBoard(formData: FormData): Promise<void> {
  await requireAdmin();
  await run("UPDATE country_boards SET enabled = 1 - enabled WHERE id=?",
    String(formData.get("id") ?? ""));
  revalidatePath("/admin");
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
  revalidatePath("/admin");
}
