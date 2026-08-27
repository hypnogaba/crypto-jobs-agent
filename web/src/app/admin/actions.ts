"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";

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
