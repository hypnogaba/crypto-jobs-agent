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
  const chat = row?.contact?.startsWith("tg:") ? row.contact.slice(3) : null;

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
