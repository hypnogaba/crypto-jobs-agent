"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { all, run, uuid } from "@/lib/db";
import { createSession, currentUser, destroySession, requireUser } from "@/lib/auth";
import { parseProfile, type ParsedProfile } from "@/lib/parse";
import { CvError, extractCvText } from "@/lib/cv";
import { isLocale, localeFromHeader } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";

const DRAFT_COOKIE = "nr_draft";

const env = async (): Promise<Record<string, string | undefined>> =>
  getCloudflareContext().env as unknown as Record<string, string | undefined>;

export async function detectLocale(): Promise<Locale> {
  const jar = await cookies();
  const chosen = jar.get("nr_locale")?.value;
  if (chosen && isLocale(chosen)) return chosen;
  const user = await currentUser();
  if (user && isLocale(user.locale)) return user.locale;
  return localeFromHeader((await headers()).get("accept-language"));
}

/** Крок 1: вільний текст або резюме. Розбір іде в куку-чернетку до реєстрації. */
export async function startOnboarding(formData: FormData): Promise<void> {
  let text = String(formData.get("input") ?? "").trim();

  // Резюме файлом — та сама гілка логіки, лише інший спосіб отримати текст
  const file = formData.get("cv");
  if (file instanceof File && file.size > 0) {
    try {
      text = await extractCvText(file);
    } catch (e) {
      redirect(`/?error=${e instanceof CvError ? e.message : "unreadable"}`);
    }
  }

  if (text.length < 3) redirect("/?error=empty");

  const { ANTHROPIC_API_KEY } = await env();
  const parsed = await parseProfile(text, ANTHROPIC_API_KEY ?? null);

  const jar = await cookies();
  jar.set(DRAFT_COOKIE, JSON.stringify({ text: text.slice(0, 20_000), parsed }), {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 3600,
  });
  redirect("/onboarding");
}

export async function readDraft(): Promise<{ text: string; parsed: ParsedProfile } | null> {
  const raw = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as { text: string; parsed: ParsedProfile }; } catch { return null; }
}

/** Крок 2: людина підтвердила чотири поля. Профіль зберігається у її акаунт. */
export async function saveProfile(formData: FormData): Promise<void> {
  const user = await currentUser();
  const draft = await readDraft();

  const profile = {
    spheres: formData.getAll("spheres").map(String),
    industries: formData.getAll("industries").map(String),
    seniority: String(formData.get("seniority") ?? "") || null,
    remoteMode: String(formData.get("remoteMode") ?? "remote_only"),
    location: String(formData.get("location") ?? "").trim() || null,
    salaryMin: Number.parseInt(String(formData.get("salaryMin") ?? ""), 10) || null,
    salaryCurrency: String(formData.get("salaryCurrency") ?? "").trim() || null,
  };

  if (!user) {
    // Ще немає акаунта — створюємо мовчки, без пошти й пароля.
    // Особа людини — це її Telegram, і вона підтвердить її наступним кроком.
    // Просити тут пароль означало б поставити анкету посеред дії.
    const id = uuid();
    await run(
      `INSERT INTO users (id,locale,timezone,delivery_hour,last_interaction_at)
       VALUES (?,?,?,7,datetime('now'))`,
      id, await detectLocale(), "UTC");
    await persistProfile(id, draft?.text ?? "", profile);
    (await cookies()).delete(DRAFT_COOKIE);
    await createSession(id);
    redirect("/telegram");
  }

  await persistProfile(user.id, draft?.text ?? "", profile);
  (await cookies()).delete(DRAFT_COOKIE);
  redirect("/telegram");
}

async function persistProfile(
  userId: string, rawInput: string,
  p: { spheres: string[]; industries: string[]; seniority: string | null; remoteMode: string;
       location: string | null; salaryMin: number | null; salaryCurrency: string | null }
): Promise<void> {
  const isCv = rawInput.length > 800;
  await run(
    `INSERT INTO profiles (user_id,mode,raw_input,cv_text,spheres,industries,seniority,remote_mode,location,salary_min,salary_currency,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       mode=excluded.mode, raw_input=excluded.raw_input, cv_text=excluded.cv_text,
       spheres=excluded.spheres, industries=excluded.industries, seniority=excluded.seniority,
       remote_mode=excluded.remote_mode, location=excluded.location,
       salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
       updated_at=datetime('now')`,
    userId, isCv ? "cv" : "freetext",
    isCv ? null : rawInput,           // файл резюме не зберігаємо, лише розібраний текст
    isCv ? rawInput.slice(0, 20_000) : null,
    JSON.stringify(p.spheres), JSON.stringify(p.industries),
    p.seniority, p.remoteMode, p.location, p.salaryMin, p.salaryCurrency);
}

// ── акаунт ───────────────────────────────────────────────────
export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}

// ── Telegram ─────────────────────────────────────────────────
export async function createConnectToken(): Promise<void> {
  const user = await requireUser();
  const token = crypto.randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + 15 * 60_000).toISOString();
  await run("UPDATE users SET connect_token=?, connect_expires_at=? WHERE id=?", token, expires, user.id);
  redirect("/telegram");
}

// ── налаштування ─────────────────────────────────────────────
export async function saveSettings(formData: FormData): Promise<void> {
  const user = await requireUser();
  const hour = Math.min(23, Math.max(0, Number.parseInt(String(formData.get("deliveryHour") ?? "7"), 10) || 7));
  const locale = String(formData.get("locale") ?? user.locale);
  const timezone = String(formData.get("timezone") ?? "UTC").slice(0, 64);
  await run("UPDATE users SET delivery_hour=?, locale=?, timezone=?, updated_at=datetime('now') WHERE id=?",
    hour, isLocale(locale) ? locale : "en", timezone, user.id);
  (await cookies()).set("nr_locale", locale, { path: "/", maxAge: 31_536_000 });
  redirect("/settings?saved=1");
}

export async function togglePause(): Promise<void> {
  const user = await requireUser();
  const next = user.status === "paused" ? "active" : "paused";
  await run("UPDATE users SET status=?, paused_reason=?, updated_at=datetime('now') WHERE id=?",
    next, next === "paused" ? "manual" : null, user.id);
  redirect("/settings");
}

/** Повне видалення. Каскади в схемі стирають профіль, сесії, історію й реакції. */
export async function deleteAccount(): Promise<void> {
  const user = await requireUser();
  await run("DELETE FROM users WHERE id=?", user.id);
  await destroySession();
  redirect("/");
}

export async function recordFeedback(formData: FormData): Promise<void> {
  const user = await requireUser();
  const digestId = String(formData.get("digestId") ?? "");
  const reaction = String(formData.get("reaction") ?? "");
  if (reaction !== "not_relevant" && reaction !== "more") return;

  await run("INSERT INTO feedback (id,user_id,digest_id,reaction) VALUES (?,?,?,?)",
    uuid(), user.id, digestId, reaction);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);

  // «Ще п'ять» — це запит, який мусить хтось виконати, а не просто відмітка
  if (reaction === "more") {
    await run("INSERT INTO delivery_requests (id,user_id) VALUES (?,?)", uuid(), user.id);
  }
  redirect("/dashboard?queued=1");
}

export const listMatches = async (userId: string) =>
  all<{ id: string; company: string; title: string; location: string | null; url: string; why_fits: string; created_at: string; digest_id: string }>(
    `SELECT s.id,j.company,j.title,j.location,j.url,s.why_fits,s.created_at,s.digest_id
     FROM sent s JOIN jobs_cache j ON j.id = s.job_id
     WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 50`, userId);

/** Перемикач мови в навігації. Для зареєстрованих зберігається в профіль. */
export async function switchLocale(formData: FormData): Promise<void> {
  const chosen = String(formData.get("locale") ?? "en");
  if (!isLocale(chosen)) return;
  (await cookies()).set("nr_locale", chosen, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  const user = await currentUser();
  if (user) await run("UPDATE users SET locale=? WHERE id=?", chosen, user.id);
  redirect((await headers()).get("referer")?.replace(/^https?:\/\/[^/]+/, "") || "/");
}
