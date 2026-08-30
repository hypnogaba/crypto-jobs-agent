"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { MATCH_LIMIT, orderFor } from "@/lib/match-sort";
import { all, one, run, uuid } from "@/lib/db";
import { createSession, currentUser, destroySession, requireUser } from "@/lib/auth";
import { parseLocally, parseProfile, type ParsedProfile } from "@/lib/parse";
import { CvError, extractCvText } from "@/lib/cv";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
import { safeTimezone } from "@/lib/digest-time";
import { FEEDBACK_LIMITS, ONBOARD_LIMITS, checkRate, recordFailure } from "@/lib/ratelimit";
import { INDUSTRIES, SPHERES, needsCity, parseModes, serializeModes, type Locale } from "@/lib/vocab";
import { persistDerived } from "@/lib/profile-country";
import { pathFor } from "@/lib/seo";
import { sendText } from "@/lib/telegram-send";

const DRAFT_COOKIE = "nr_draft";

/**
 * Стеля тексту, який їде далі. Це вже не обмеження куки — у куці лишився сам
 * лише ідентифікатор, — а стеля того, що має сенс класти в profiles.raw_input.
 */
const DRAFT_TEXT_MAX = 2_500;

/** Скільки живе покинута чернетка, перш ніж прибиральник її зносить. */
const DRAFT_TTL = "-1 day";

/** Довжина вільних полів профілю, яка ще схожа на місто чи код валюти. */
const SHORT_FIELD_MAX = 120;

const allowed = (values: string[], vocab: ReadonlyArray<{ id: string }>): string[] => {
  const ids = new Set(vocab.map((v) => v.id));
  return [...new Set(values.filter((v) => ids.has(v)))];
};

/**
 * Один ліміт на анкету без сесії: і крок 1 (виклик моделі), і крок 2
 * (новий рядок users + позачергова добірка). Ключ — адреса від Cloudflare.
 */
async function guardOnboarding(): Promise<void> {
  const ip = (await headers()).get("cf-connecting-ip") ?? "unknown";
  const key = `onboard:${ip}`;
  if (!(await checkRate(key)).allowed) redirect(`${await homePath()}?error=tooMany`);
  await recordFailure(key, ONBOARD_LIMITS);
}

const env = async (): Promise<Record<string, string | undefined>> =>
  getCloudflareContext().env as unknown as Record<string, string | undefined>;

/**
 * Головна мовою людини. Кожен redirect з помилкою веде саме сюди: голе "/"
 * викидало людину з /uk на англійську сторінку — і вона там ще й лишалась,
 * бо мова живе в куці, а кука після цього казала «англійська».
 */
const homePath = async (): Promise<string> => pathFor(await detectLocale(), "/");

export async function detectLocale(): Promise<Locale> {
  const jar = await cookies();
  const chosen = jar.get("nr_locale")?.value;
  if (chosen && isLocale(chosen)) return chosen;
  const user = await currentUser();
  if (user && isLocale(user.locale)) return user.locale;
  return DEFAULT_LOCALE;
}

/**
 * Запам'ятати мову сторінки, з якої людина щойно пішла в анкету.
 *
 * Публічні сторінки беруть мову з адреси (/uk, /fr), а `detectLocale` —
 * з куки. Куку ж не ставив ніхто, крім перемикача в навігації. Через це
 * людина, що прийшла на /uk і написала про себе українською, з кроку 2 і
 * далі бачила англійську, а в базі їй записувалось locale='en' — тобто й
 * добірки в Telegram приходили англійською назавжди. Те саме ставалось із
 * заходом із пошуку на /fr чи /ru.
 *
 * Виграє мова СТОРІНКИ, а не стара кука: людина щойно читала саме її.
 * Перемикач на публічних сторінках і так веде на адресу тієї ж мови, тож
 * розбіжності між ними не буває.
 */
async function rememberLocale(formData: FormData): Promise<Locale> {
  const fromPage = String(formData.get("locale") ?? "");
  if (!isLocale(fromPage)) return detectLocale();
  (await cookies()).set("nr_locale", fromPage, {
    path: "/", maxAge: 31_536_000, sameSite: "lax",
  });
  return fromPage;
}

/** Крок 1: вільний текст або резюме. Розбір іде в куку-чернетку до реєстрації. */
export async function startOnboarding(formData: FormData): Promise<void> {
  // Мову ставимо ДО будь-якого redirect: і помилка розбору, і відмова за
  // лімітом мають лишити людину вдома, а не викинути на англійську головну.
  const home = pathFor(await rememberLocale(formData), "/");
  await guardOnboarding();
  let text = String(formData.get("input") ?? "").trim();
  // Резюме це чи тези — знає лише ця сторінка. Далі вгадувати нема за чим:
  // довжина тексту про це не каже (див. міграцію 0017).
  let source: "cv" | "freetext" = "freetext";

  // Резюме файлом — та сама гілка логіки, лише інший спосіб отримати текст
  const file = formData.get("cv");
  if (file instanceof File && file.size > 0) {
    source = "cv";
    try {
      text = await extractCvText(file);
    } catch (e) {
      redirect(`${home}?error=${e instanceof CvError ? e.message : "unreadable"}`);
    }
  }

  if (text.length < 3) redirect(`${home}?error=empty`);

  /**
   * Модель тут НЕ викликається, і це головне в цьому кроці.
   *
   * Раніше `parseProfile` стояв просто в переході: людина тиснула стрілку й
   * дивилась на нерухому сторінку 7.7 секунди (виміряно на claude-opus-5).
   * Перше, що продукт робив після першої ж дії людини, — змушував її чекати.
   *
   * Тепер у чернетку лягає миттєвий розбір регулярками, а уточнення моделлю
   * робить сама сторінка /onboarding усередині Suspense: каркас з'являється
   * одразу, галочки доїжджають потоком. Ніхто не чекає на порожньому екрані.
   */
  const parsed = parseLocally(text);

  /**
   * Чернетка йде в базу, а в куці лишається сам лише ідентифікатор.
   *
   * Досі тут лежав увесь JSON. Next кодує значення куки через
   * encodeURIComponent, українська літера в UTF-8 — це шість символів на
   * виході, і 444 українські символи давали 2 723 байти при стелі браузера
   * 4 096. Браузер ріже таку куку МОВЧКИ: readDraft() віддавав null, а
   * /onboarding показував залогіненій людині старий рядок із profiles замість
   * щойно розібраного тексту. Тези українською ламали крок 2 гарантовано.
   */
  const id = uuid();
  await run(
    "INSERT INTO onboarding_drafts (id,text,parsed,source) VALUES (?,?,?,?)",
    id, text.slice(0, DRAFT_TEXT_MAX), JSON.stringify(parsed), source);
  await sweepDrafts();

  const jar = await cookies();
  jar.set(DRAFT_COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 3600,
  });
  redirect("/onboarding");
}

export async function readDraft(): Promise<
  { id: string; text: string; parsed: ParsedProfile; source: string; refined: boolean } | null
> {
  const id = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (!id) return null;
  // Прострочену чернетку не віддаємо навіть тоді, коли прибиральник до неї ще
  // не дійшов: кука живе годину, рядок — добу, і читати текст, який ми
  // пообіцяли не тримати, не можна через одну лише розбіжність у розкладі.
  const row = await one<{ text: string; parsed: string; source: string | null; refined: number }>(
    `SELECT text, parsed, source, refined FROM onboarding_drafts
      WHERE id=? AND created_at >= datetime('now', ?)`, id, DRAFT_TTL);
  if (!row) return null;
  try {
    return { id, text: row.text, parsed: JSON.parse(row.parsed) as ParsedProfile,
             source: row.source ?? "freetext", refined: row.refined === 1 };
  } catch { return null; }
}

/** Чернетку прибираємо разом із кукою: текст людини не має пережити анкету. */
async function dropDraft(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(DRAFT_COOKIE)?.value;
  if (id) await run("DELETE FROM onboarding_drafts WHERE id=?", id);
  jar.delete(DRAFT_COOKIE);
  await sweepDrafts();
}

/**
 * Знести покинуті чернетки. Викликається на обох кінцях анкети — і коли її
 * починають, і коли завершують.
 *
 * Спершу прибирання стояло лише в startOnboarding. Виходило, що поки ніхто не
 * починає нову анкету, чужий текст лежить у базі безстроково — попри те, що
 * і коментар у міграції, і сторінка приватності обіцяють добу. Окремого крона
 * у Воркера немає, тож чистимо там, де й так уже пишемо.
 */
async function sweepDrafts(): Promise<void> {
  await run(`DELETE FROM onboarding_drafts WHERE created_at < datetime('now', ?)`, DRAFT_TTL);
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

  // Усе, що має словник, звіряємо зі словником; вільні поля обрізаємо.
  // Форма й так дає лише ці значення, але форма — не межа довіри.
  // «Де хочеш працювати» — набір: офіс у своєму місті й готовність переїхати
  // не виключають одне одного. parseModes викидає «тільки віддалено», коли
  // воно стоїть поруч із ширшим варіантом.
  const modes = parseModes(formData.getAll("remoteMode").map(String).join(","));
  const location = String(formData.get("location") ?? "").trim().slice(0, SHORT_FIELD_MAX) || null;
  const salaryMinRaw = Number.parseInt(String(formData.get("salaryMin") ?? ""), 10);
  const profile = {
    spheres: allowed(formData.getAll("spheres").map(String), SPHERES),
    industries: allowed(formData.getAll("industries").map(String), INDUSTRIES),
    customRole: String(formData.get("customRole") ?? "").trim().slice(0, SHORT_FIELD_MAX) || null,
    customIndustry: String(formData.get("customIndustry") ?? "").trim().slice(0, SHORT_FIELD_MAX) || null,
    // Витяг із резюме людина бачить і може виправити — тому він приходить
    // формою, а не тягнеться з чернетки повз неї.
    cvHighlights: String(formData.get("cvHighlights") ?? "").trim().slice(0, 300) || null,
    remoteMode: serializeModes(modes) || "remote_only",
    location,
    // Поле МІСЯЧНЕ — так думають люди, і так воно підписане. У базі лежить
    // річна: вакансії зведені до річних, і дві одиниці виміру в одній колонці
    // вже коштували нам мовчазної втрати «3000 євро».
    salaryMin: Number.isFinite(salaryMinRaw) && salaryMinRaw > 0 && salaryMinRaw < 1_000_000
      ? salaryMinRaw * 12 : null,
    salaryCurrency: String(formData.get("salaryCurrency") ?? "").trim().slice(0, 8) || null,
    wishes: String(formData.get("wishes") ?? "").trim().slice(0, 2000) || null,
  };
  // Звідки прийшла форма: /profile повертає на себе, перший прохід — далі
  // до Telegram. Значення з форми обмежене двома варіантами, не адресою.
  const back = String(formData.get("back") ?? "") === "profile" ? "/profile?saved=1" : "/telegram";

  // Куди повертати з помилкою. Той самий вибір, що й у `back`, лише без
  // «збережено»: людина ще нічого не зберегла.
  const wrong = (code: string): never =>
    redirect(String(formData.get("back") ?? "") === "profile"
      ? `/profile?error=${code}` : `/onboarding?error=${code}`);

  /**
   * Хоча б одна сфера — або своя назва ролі.
   *
   * Без цього підбір не має за чим шукати: сфера важить ±6 балів, і штраф
   * за «жодного збігу» стоїть під умовою «людина щось назвала». Порожня
   * анкета проходила мовчки, і людина отримувала п'ять випадкових
   * віддалених вакансій — юриста, HR-партнера, дата-саєнтиста — з упевненим
   * поясненням під кожною. Бот таке не пропускав із першого дня (canFinish
   * у bot-onboarding.ts); сайт пропускав.
   */
  if (profile.spheres.length === 0 && !profile.customRole) wrong("sphere");

  // Місто — не прикраса: з нього виводиться країна, а з країни — національні
  // дошки вакансій. Хто обрав офіс у своєму місті чи переїзд, а міста не
  // назвав, лишався б з самою лише глобальною стрічкою й ніколи б не дізнався
  // чому. Форма це вимагає сама; тут — межа довіри, бо форму можна обійти.
  if (needsCity(modes) && !profile.location) wrong("city");

  if (!user) {
    await guardOnboarding();
    // Ще немає акаунта — створюємо мовчки, без пошти й пароля.
    // Особа людини — це її Telegram, і вона підтвердить її наступним кроком.
    // Просити тут пароль означало б поставити анкету посеред дії.
    const id = uuid();
    await run(
      `INSERT INTO users (id,locale,timezone,delivery_hour,last_interaction_at)
       VALUES (?,?,?,9,datetime('now'))`,
      id, await detectLocale(), timezone);
    await persistProfile(id, draft?.text ?? "", draft?.source ?? "freetext", profile);
    await dropDraft();
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
  await persistProfile(user.id, draft?.text ?? null, draft?.source ?? "freetext", profile);
  await dropDraft();
  redirect(back);
}

async function persistProfile(
  userId: string, rawInput: string | null, source: string,
  p: { spheres: string[]; industries: string[]; customRole: string | null;
       customIndustry: string | null;
       remoteMode: string;
       location: string | null; salaryMin: number | null; salaryCurrency: string | null;
       wishes: string | null; cvHighlights: string | null }
): Promise<void> {
  // Без нового тексту (null) три текстові стовпці лишаються як були: раніше
  // редагування без чернетки ставило cv_text=NULL, raw_input='' і
  // mode='freetext', і резюме зникало з профілю мовчки.
  const keepText = rawInput === null;
  // Резюме це чи тези — каже чернетка, а не довжина рядка. Стара мірка
  // («більше 800 символів») робила з довгих тез резюме: mode='cv',
  // raw_input=NULL, і слова людини зникали з профілю.
  const isCv = source === "cv";
  const textCols = keepText
    ? "mode=profiles.mode, raw_input=profiles.raw_input, cv_text=profiles.cv_text"
    : "mode=excluded.mode, raw_input=excluded.raw_input, cv_text=excluded.cv_text";
  await run(
    `INSERT INTO profiles (user_id,mode,raw_input,cv_text,spheres,custom_role,industries,custom_industry,remote_mode,location,salary_min,salary_currency,wishes,cv_highlights,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ${textCols},
       spheres=excluded.spheres, custom_role=excluded.custom_role,
       industries=excluded.industries, custom_industry=excluded.custom_industry,
       remote_mode=excluded.remote_mode, location=excluded.location,
       salary_min=excluded.salary_min, salary_currency=excluded.salary_currency,
       wishes=excluded.wishes, cv_highlights=excluded.cv_highlights,
       updated_at=datetime('now')`,
    userId, isCv ? "cv" : "freetext",
    isCv || keepText ? null : rawInput,   // файл резюме не зберігаємо, лише розібраний текст
    isCv ? rawInput!.slice(0, 20_000) : null,
    JSON.stringify(p.spheres), p.customRole,
    JSON.stringify(p.industries), p.customIndustry,
    p.remoteMode, p.location, p.salaryMin, p.salaryCurrency, p.wishes, p.cvHighlights);
  await persistDerived(userId, (await env()).ANTHROPIC_API_KEY ?? null);

}

/** «Прислати 5 зараз» після анкети: один відкритий запит на людину. */
export async function requestFirstFive(): Promise<void> {
  const user = await requireUser();
  await run(
    `INSERT INTO delivery_requests (id,user_id)
     SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=? AND handled_at IS NULL)`,
    uuid(), user.id, user.id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
  redirect("/dashboard?queued=1");
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

/**
 * Добірки поточної людини. Id береться із сесії, не з аргументу: цей файл —
 * "use server", і кожен експорт тут є HTTP-ендпоінтом, який можна викликати
 * з будь-яким аргументом.
 */
export async function listMatches(sort: string | undefined = "day") {
  const user = await requireUser();

  // Порядок збирається з БІЛОГО СПИСКУ, не з рядка запиту: `sort` приходить
  // з адреси, а тут «use server» — кожен експорт є відкритим ендпоінтом.
  const order = orderFor(sort);

  return all<{ id: string; company: string; title: string; location: string | null; url: string;
        why_fits: string; match_facts: string; summary: string | null;
        salary_min: number | null; salary_currency: string | null;
        applied_at: string | null; hidden_at: string | null;
        created_at: string; digest_id: string; score: number | null }>(
    `SELECT s.id,j.company,j.title,j.location,j.url,s.why_fits,s.match_facts,
            j.summary,j.salary_min,j.salary_currency,
            s.applied_at,s.hidden_at,s.created_at,s.digest_id,s.score
     FROM sent s JOIN jobs_cache j ON j.id = s.job_id
     WHERE s.user_id=? ORDER BY ${order} LIMIT ${MATCH_LIMIT}`, user.id);
}

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
  redirect(await backToReferer());
}

/**
 * Шлях повернення після перемикача в навігації.
 *
 * Лише шлях із того самого origin. Голий зріз схеми й хоста віддавав би
 * «//evil.com» із referer «https://nextrole.info//evil.com» — а це вже
 * відкритий редирект.
 */
async function backToReferer(): Promise<string> {
  const h = await headers();
  const ref = h.get("referer");
  if (!ref) return "/";
  try {
    const url = new URL(ref);
    const here = h.get("host");
    if (here && url.host !== here) return "/";
    const path = url.pathname + url.search;
    return /^\/(?!\/)/.test(path) ? path : "/";
  } catch {
    return "/";
  }
}

export async function switchLocale(formData: FormData): Promise<void> {
  const chosen = String(formData.get("locale") ?? "en");
  if (!isLocale(chosen)) return;
  (await cookies()).set("nr_locale", chosen, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  const user = await currentUser();
  if (user) await run("UPDATE users SET locale=? WHERE id=?", chosen, user.id);
  redirect(await backToReferer());
}

/**
 * Уточнити чернетку моделлю — з боку сторінки, а не з боку переходу.
 *
 * Викликається з /onboarding усередині Suspense. Результат кладеться назад у
 * чернетку, тож повторне відкриття тієї самої сторінки моделі вже не турбує:
 * розбір коштує грошей, а людина оновлює сторінку частіше, ніж здається.
 */
export async function refineDraft(id: string, text: string,
                                  local: ParsedProfile): Promise<ParsedProfile> {
  const { ANTHROPIC_API_KEY } = await env();
  if (!ANTHROPIC_API_KEY) return local;

  const parsed = await parseProfile(text, ANTHROPIC_API_KEY);
  await run("UPDATE onboarding_drafts SET parsed=?, refined=1 WHERE id=?",
    JSON.stringify(parsed), id);
  return parsed;
}
