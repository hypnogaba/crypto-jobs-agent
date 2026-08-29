"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { all, one, run, uuid } from "@/lib/db";
import { createSession, currentUser, destroySession, requireUser } from "@/lib/auth";
import { parseProfile, type ParsedProfile } from "@/lib/parse";
import { CvError, extractCvText } from "@/lib/cv";
import { isLocale, localeFromHeader } from "@/lib/i18n";
import { safeTimezone } from "@/lib/digest-time";
import { FEEDBACK_LIMITS, checkRate, recordFailure } from "@/lib/ratelimit";
import type { Locale } from "@/lib/vocab";
import { persistCountry } from "@/lib/profile-country";
import { sendText } from "@/lib/telegram-send";

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

/**
 * Зона з форми, а коли скрипт її не зняв (вимкнений JS, блокувальник) —
 * зона, яку Cloudflare визначає за адресою запиту. UTC лишається лише
 * останнім притулком: інакше людина в Парижі отримувала б добірку об 11:00.
 */
function timezoneFrom(formData: FormData): string {
  const fromForm = String(formData.get("timezone") ?? "").trim();
  if (fromForm && fromForm !== "UTC") return safeTimezone(fromForm);
  let fromEdge = "";
  try {
    const cf = (getCloudflareContext().cf as { timezone?: string } | undefined);
    fromEdge = cf?.timezone ?? "";
  } catch { /* поза Workers (тести, dev) контексту немає */ }
  return safeTimezone(fromEdge || fromForm);
}

/** Крок 2: людина підтвердила чотири поля. Профіль зберігається у її акаунт. */
export async function saveProfile(formData: FormData): Promise<void> {
  const user = await currentUser();
  const draft = await readDraft();

  // Зону знімає скрипт на самій формі. Перевіряємо її через сам Intl —
  // підроблене значення мовчки стало б розкладом доставки.
  const timezone = timezoneFrom(formData);

  const profile = {
    spheres: formData.getAll("spheres").map(String),
    industries: formData.getAll("industries").map(String),
    seniority: String(formData.get("seniority") ?? "") || null,
    remoteMode: String(formData.get("remoteMode") ?? "remote_only"),
    location: String(formData.get("location") ?? "").trim() || null,
    salaryMin: Number.parseInt(String(formData.get("salaryMin") ?? ""), 10) || null,
    salaryCurrency: String(formData.get("salaryCurrency") ?? "").trim() || null,
    wishes: String(formData.get("wishes") ?? "").trim().slice(0, 2000) || null,
  };
  // Звідки прийшла форма: /profile повертає на себе, перший прохід — далі
  // до Telegram. Значення з форми обмежене двома варіантами, не адресою.
  const back = String(formData.get("back") ?? "") === "profile" ? "/profile?saved=1" : "/telegram";

  if (!user) {
    // Ще немає акаунта — створюємо мовчки, без пошти й пароля.
    // Особа людини — це її Telegram, і вона підтвердить її наступним кроком.
    // Просити тут пароль означало б поставити анкету посеред дії.
    const id = uuid();
    await run(
      `INSERT INTO users (id,locale,timezone,delivery_hour,last_interaction_at)
       VALUES (?,?,?,9,datetime('now'))`,
      id, await detectLocale(), timezone);
    await persistProfile(id, draft?.text ?? "", profile);
    (await cookies()).delete(DRAFT_COOKIE);
    await createSession(id);
    redirect("/telegram");
  }

  // Той, хто зареєструвався до появи цього поля, лишався з UTC назавжди.
  // Перезбереження профілю тепер його виправляє. Справжню зону на UTC не
  // міняємо: порожній браузерний сигнал не має стирати відоме значення.
  if (timezone !== "UTC") {
    await run("UPDATE users SET timezone=?, updated_at=datetime('now') WHERE id=?", timezone, user.id);
  }

  // «Змінити профіль» приходить без чернетки: людина правила лише галочки.
  // Текст резюме, з якого їх колись розібрано, має пережити це редагування.
  await persistProfile(user.id, draft?.text ?? null, profile);
  (await cookies()).delete(DRAFT_COOKIE);
  redirect(back);
}

async function persistProfile(
  userId: string, rawInput: string | null,
  p: { spheres: string[]; industries: string[]; seniority: string | null; remoteMode: string;
       location: string | null; salaryMin: number | null; salaryCurrency: string | null;
       wishes: string | null }
): Promise<void> {
  // Без нового тексту (null) три текстові стовпці лишаються як були: раніше
  // редагування без чернетки ставило cv_text=NULL, raw_input='' і
  // mode='freetext', і резюме зникало з профілю мовчки.
  const keepText = rawInput === null;
  const isCv = (rawInput ?? "").length > 800;
  const textCols = keepText
    ? "mode=profiles.mode, raw_input=profiles.raw_input, cv_text=profiles.cv_text"
    : "mode=excluded.mode, raw_input=excluded.raw_input, cv_text=excluded.cv_text";
  await run(
    `INSERT INTO profiles (user_id,mode,raw_input,cv_text,spheres,industries,seniority,remote_mode,location,salary_min,salary_currency,wishes,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ${textCols},
       spheres=excluded.spheres, industries=excluded.industries, seniority=excluded.seniority,
       remote_mode=excluded.remote_mode, location=excluded.location,
       salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
       wishes=excluded.wishes,
       updated_at=datetime('now')`,
    userId, isCv ? "cv" : "freetext",
    isCv || keepText ? null : rawInput,   // файл резюме не зберігаємо, лише розібраний текст
    isCv ? rawInput!.slice(0, 20_000) : null,
    JSON.stringify(p.spheres), JSON.stringify(p.industries),
    p.seniority, p.remoteMode, p.location, p.salaryMin, p.salaryCurrency, p.wishes);
  await persistCountry(userId, p.location);

  // Перша добірка поза розкладом. Умова NOT EXISTS принципова: без неї
  // кожне редагування профілю замовляло б позачергову доставку. Таблиця
  // й погодинний розгрібач уже існують (scanner/src/digest.ts).
  // Країну ставимо ДО запиту: інакше перша ж добірка підбиралася б без неї.
  await run(
    `INSERT INTO delivery_requests (id,user_id)
     SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM sent WHERE user_id=?)
                  AND NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=?)`,
    uuid(), userId, userId, userId);
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
  const hour = Math.min(23, Math.max(0, Number.parseInt(String(formData.get("deliveryHour") ?? "9"), 10) || 9));
  const raw = String(formData.get("locale") ?? user.locale);
  const locale = isLocale(raw) ? raw : "en";
  const timezone = timezoneFrom(formData);
  await run("UPDATE users SET delivery_hour=?, locale=?, timezone=?, updated_at=datetime('now') WHERE id=?",
    hour, locale, timezone, user.id);
  // У куку йде вже перевірене значення — те саме, що й у базу.
  (await cookies()).set("nr_locale", locale, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
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

  // digest_id приходить із форми: без звірки власника реакцію можна було б
  // повісити на чужу добірку, підставивши id.
  const mine = await one<{ n: number }>(
    "SELECT 1 n FROM sent WHERE digest_id=? AND user_id=? LIMIT 1", digestId, user.id);
  if (!mine) redirect("/dashboard");

  await run("INSERT INTO feedback (id,user_id,digest_id,reaction) VALUES (?,?,?,?)",
    uuid(), user.id, digestId, reaction);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);

  // «Ще п'ять» — це запит, який мусить хтось виконати, а не просто відмітка.
  // Один відкритий запит на людину: другий дотик не має замовляти другу добірку.
  if (reaction === "more") {
    await run(
      `INSERT INTO delivery_requests (id,user_id)
       SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=? AND handled_at IS NULL)`,
      uuid(), user.id, user.id);
  }
  redirect("/dashboard?queued=1");
}

export const listMatches = async (userId: string) =>
  all<{ id: string; company: string; title: string; location: string | null; url: string;
        why_fits: string; match_facts: string; summary: string | null;
        salary_min: number | null; salary_currency: string | null;
        applied_at: string | null; hidden_at: string | null;
        created_at: string; digest_id: string }>(
    `SELECT s.id,j.company,j.title,j.location,j.url,s.why_fits,s.match_facts,
            j.summary,j.salary_min,j.salary_currency,
            s.applied_at,s.hidden_at,s.created_at,s.digest_id
     FROM sent s JOIN jobs_cache j ON j.id = s.job_id
     WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 50`, userId);

/**
 * Стан вакансії в кабінеті.
 *
 * Кожна дія звіряє власника: id рядка sent приходить із форми, тож без
 * умови user_id людина могла б змінити чужий запис, підмінивши id.
 */
async function setMatchState(
  formData: FormData, column: "applied_at" | "hidden_at", value: "now" | null
): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Назва стовпця береться з літерального об'єднання типів, а не з форми —
  // рядок SQL лишається замкненим.
  await run(
    `UPDATE sent SET ${column} = ${value === "now" ? "datetime('now')" : "NULL"}
      WHERE id=? AND user_id=?`, id, user.id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
  redirect("/dashboard");
}

// Кожен експорт у файлі "use server" мусить бути саме async-функцією.
// Стрілка, що просто повертає проміс, збірку не пройде.
export async function hideMatch(f: FormData): Promise<void>   { await setMatchState(f, "hidden_at", "now"); }
export async function unhideMatch(f: FormData): Promise<void> { await setMatchState(f, "hidden_at", null); }
export async function undoApplied(f: FormData): Promise<void> { await setMatchState(f, "applied_at", null); }

/** Перемикач мови в навігації. Для зареєстрованих зберігається в профіль. */
/**
 * Три стани, не два: світло, темрява і «як у системі». Порожнє значення стирає
 * куку, тож людина може повернутись до системної теми, а не лишитись замкненою
 * в одному з двох виборів.
 */
/**
 * Вільний відгук із сайту.
 *
 * Пишеться в базу Й одразу летить власнику в Telegram. Тільки база означала б,
 * що відгук лежить, доки хтось не відкриє адмінку; тільки повідомлення — що
 * він зникне, якщо власник його змахне. Тому обидва.
 */
export async function sendFeedback(formData: FormData): Promise<void> {
  const message = String(formData.get("message") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim().slice(0, 200) || null;
  const page = String(formData.get("page") ?? "").slice(0, 200) || null;

  if (message.length < 3) redirect("/feedback?error=empty");

  const ip = (await headers()).get("cf-connecting-ip") ?? "unknown";
  // М'який ліміт: тут рахується кожен надісланий відгук, а за адресою може
  // стояти ціла мережа. Жорсткий авторизаційний ліміт блокував їх усіх.
  if (!(await checkRate(`feedback:${ip}`)).allowed) redirect("/feedback?error=tooMany");
  await recordFailure(`feedback:${ip}`, FEEDBACK_LIMITS);

  const locale = await detectLocale();
  const user = await currentUser();

  await run(
    `INSERT INTO site_feedback (id,user_id,contact,locale,page,message) VALUES (?,?,?,?,?,?)`,
    uuid(), user?.id ?? null, contact, locale, page, message.slice(0, 4000));

  // Долетіти має одразу. Впало — відгук уже в базі, нічого не втрачено.
  const { TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID } = await env();
  if (TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID) {
    const who = user ? `акаунт ${user.id.slice(0, 8)}` : "без акаунту";
    const text = `Відгук із сайту (${locale}, ${who})` +
      (page ? `\nСторінка: ${page}` : "") +
      (contact ? `\nЗв'язок: ${contact}` : "") +
      `\n\n${message.slice(0, 3000)}`;
    // База вже має запис: невдача лише потрапляє в лог, не до людини.
    await sendText(TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, text);
  }

  redirect("/feedback?sent=1");
}

/**
 * Зона, яку тихо надіслав браузер.
 *
 * Викликається лише тоді, коли в базі досі UTC. Ніколи не затирає вже
 * відому зону і ніколи не ставить UTC: порожній чи підроблений сигнал не
 * має псувати розклад доставки.
 *
 * Зона відповідає РІВНО за одне — коли надсилати добірку. Країну вона не
 * визначає: національні дошки прив'язані до того, де людина хоче працювати,
 * а не до того, де вона зараз сидить.
 */
export async function recordTimezone(raw: string): Promise<void> {
  const user = await currentUser();
  if (!user || user.timezone !== "UTC") return;

  const tz = safeTimezone(raw);
  if (tz === "UTC") return;

  await run("UPDATE users SET timezone=?, updated_at=datetime('now') WHERE id=? AND timezone='UTC'", tz, user.id);
}

export async function switchTheme(formData: FormData): Promise<void> {
  const chosen = String(formData.get("theme") ?? "");
  const jar = await cookies();
  if (chosen === "light" || chosen === "dark") {
    jar.set("nr_theme", chosen, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  } else {
    jar.delete("nr_theme");
  }
  redirect((await headers()).get("referer")?.replace(/^https?:\/\/[^/]+/, "") || "/");
}

export async function switchLocale(formData: FormData): Promise<void> {
  const chosen = String(formData.get("locale") ?? "en");
  if (!isLocale(chosen)) return;
  (await cookies()).set("nr_locale", chosen, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  const user = await currentUser();
  if (user) await run("UPDATE users SET locale=? WHERE id=?", chosen, user.id);
  redirect((await headers()).get("referer")?.replace(/^https?:\/\/[^/]+/, "") || "/");
}
