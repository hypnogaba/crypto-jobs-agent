/**
 * Тижневий самоперегляд.
 *
 * Раз на тиждень система дивиться на власні дані й пише, що варто змінити.
 * Власник читає в адмінці й тисне «Застосувати» або «Відхилити».
 *
 * Правило, яке тут головне: пропозиція існує лише тоді, коли систему НАВЧЕНО
 * її застосувати одним рухом. Спостереження, з якого нічого не випливає, — це
 * notice: воно повідомляє й не вдає, що є кнопкою.
 *
 * Кожне повідомлення має власний target, навіть якщо виконувати нема чого:
 * унікальний індекс іде по парі kind+target, і без цього два різні
 * повідомлення схлопувались би в одне. Перший же прогін це показав.
 *
 *   node dist/review.js [--dry]
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { probe } from "./http.js";

export type Kind = "deprecate_never_worked" | "revive_source" | "drop_dry_companies" | "notice";
export type Severity = "high" | "medium" | "low";

export interface Proposal {
  kind: Kind;
  target: string | null;
  title: string;
  detail: string;
  evidence: string;
  severity: Severity;
}

/** Стан, на який дивиться перегляд. Чисті дані — щоб правила були тестовані. */
export interface Snapshot {
  brokenNeverWorked: Array<{ source: string; days: number }>;
  deprecatedButAlive: string[];
  dryCompanies: Array<{ slug: string; name: string; dryScans: number }>;
  providerShare: Array<{ provider: string; jobs: number }>;
  totalJobs: number;
  staleJobs: number;
  duplicateRoles: number;
  /** Країни, звідки є люди, але дошки немає. Так система сама просить нову. */
  countriesWithoutBoard: Array<{ country: string; people: number }>;
}

/** Скільки поспіль порожніх сканів робить компанію непотрібною. */
const DRY_SCANS_LIMIT = 30;

/** Частка одного провайдера, вище якої це вже ризик, а не успіх. */
const PROVIDER_RISK_SHARE = 0.4;

/**
 * Правила. Кожне повертає нуль або більше пропозицій.
 * Порядок у списку = порядок у адмінці.
 */
export function review(s: Snapshot): Proposal[] {
  const out: Proposal[] = [];

  // 1. Джерела, які не дали нічого. Однією пропозицією, а не сотнею однакових:
  // сто рядків «прибрати X» — це стіна, а не робота.
  if (s.brokenNeverWorked.length > 0) {
    const sample = s.brokenNeverWorked.slice(0, 3).map((b) => b.source).join(", ");
    out.push({
      kind: "deprecate_never_worked", target: null, severity: "low",
      title: `Прибрати ${s.brokenNeverWorked.length} дошок, яких не існує`,
      detail: "Жодна з них не дала жодної вакансії за весь час і зараз недоступна. " +
              "Найпевніше, дошок ніколи не було: слаги взяли з чужих посилань.",
      evidence: `${sample}${s.brokenNeverWorked.length > 3 ? ` та ще ${s.brokenNeverWorked.length - 3}` : ""}`,
    });
  }

  // 2. Мертве, що ожило. Важливіше за прибирання: це повернення втраченого.
  for (const src of s.deprecatedButAlive) {
    out.push({
      kind: "revive_source", target: src, severity: "high",
      title: `Повернути ${src}`,
      detail: "Джерело позначене мертвим, але зараз відповідає. Ми його даремно не опитуємо.",
      evidence: "перевірено щойно: відповідає 200",
    });
  }

  // 3. Компанії, що давно нічого не дають. Політика ротації з плану, теж гуртом.
  if (s.dryCompanies.length > 0) {
    const sample = s.dryCompanies.slice(0, 3).map((c) => c.name).join(", ");
    out.push({
      kind: "drop_dry_companies", target: String(DRY_SCANS_LIMIT), severity: "low",
      title: `Прибрати ${s.dryCompanies.length} компаній без вакансій`,
      detail: `Дошки відповідають, але вакансій немає щонайменше ${DRY_SCANS_LIMIT} прогонів поспіль. ` +
              "Кожна витрачає запит щодня й нічого не дає.",
      evidence: `${sample}${s.dryCompanies.length > 3 ? ` та ще ${s.dryCompanies.length - 3}` : ""}`,
    });
  }

  // 4. Концентрація провайдерів — ризик, а не робота.
  const total = s.providerShare.reduce((n, p) => n + p.jobs, 0);
  if (total > 0) {
    for (const p of s.providerShare) {
      const share = p.jobs / total;
      if (share >= PROVIDER_RISK_SHARE) {
        out.push({
          kind: "notice", target: `provider:${p.provider}`, severity: "high",
          title: `${p.provider} тримає ${Math.round(share * 100)}% усіх вакансій`,
          detail: "Якщо цей провайдер змінить API, продукт втратить цю частку за одну ніч. " +
                  "Лікується не кнопкою, а новими провайдерами та розвідкою.",
          evidence: `${p.jobs.toLocaleString("uk-UA")} із ${total.toLocaleString("uk-UA")}`,
        });
      }
    }
  }

  // 5. Країна, з якої є люди, але дошки немає. Двісті дошок наперед — це
  // 190 мертвих рядків; дошка має з'являтись тоді, коли з'являється людина.
  // Виконати це кнопкою не можна — адресу стрічки мусить знайти людина.
  for (const c of s.countriesWithoutBoard) {
    out.push({
      kind: "notice", target: `no_board:${c.country}`, severity: "medium",
      title: `${c.country}: є люди, немає місцевої дошки`,
      detail: "Ці люди бачать лише глобальні вакансії. Розвідка по твіттеру шукає дошку " +
              "для цієї країни щонеділі й принесе її сюди окремою пропозицією — але лише " +
              "якщо знайде. Не чекає: додати стрічку посиланням можна будь-коли, і це " +
              "швидше за будь-який пошук.",
      evidence: `${c.people} ${c.people === 1 ? "людина" : "людей"} з країни ${c.country}`,
    });
  }

  // 6. Скільки кешу вже мертве.
  if (s.totalJobs > 0 && s.staleJobs / s.totalJobs > 0.2) {
    out.push({
      kind: "notice", target: "stale_cache", severity: "medium",
      title: `${Math.round((s.staleJobs / s.totalJobs) * 100)}% кешу не бачили на дошках`,
      detail: "Ці вакансії вже не потрапляють у добірки, але займають місце. " +
              "Якщо частка росте тижнями — щось не так зі скануванням, а не з ринком.",
      evidence: `${s.staleJobs.toLocaleString("uk-UA")} із ${s.totalJobs.toLocaleString("uk-UA")}`,
    });
  }

  // 7. Дублікати ролей під різними посиланнями.
  if (s.duplicateRoles > 50) {
    out.push({
      kind: "notice", target: "duplicate_roles", severity: "low",
      title: `${s.duplicateRoles} ролей дублюються під різними посиланнями`,
      detail: "Людині вони двічі не прийдуть — виключення йде за змістом. " +
              "Але це ознака, що ту саму вакансію ми беремо з кількох джерел.",
      evidence: `${s.duplicateRoles} груп із однаковою парою компанія+роль`,
    });
  }

  return out;
}

// ── збір знімка й запис ───────────────────────────────────────

async function collect(d1: D1Client): Promise<Snapshot> {
  const q = <T>(sql: string, p: unknown[] = []): Promise<T[]> => d1.query<T>(sql, p);

  const brokenNeverWorked = (await q<{ source_name: string; consecutive_fail_days: number }>(
    `SELECT source_name,consecutive_fail_days FROM sources_state
      WHERE status='degraded' AND last_ok_at IS NULL LIMIT 200`))
    .map((r) => ({ source: r.source_name, days: r.consecutive_fail_days }));

  // Мертві перевіряємо наживо — інакше «ожило» не з чого дізнатись.
  const dead = await q<{ source_name: string; last_error: string | null }>(
    "SELECT source_name,last_error FROM sources_state WHERE status='deprecated' LIMIT 40");
  const deprecatedButAlive: string[] = [];
  for (const d of dead) {
    // Адреса витягується з тексту помилки, який частково пишуть чужі
    // сервери, — тому лише через probe: та сама політика хостів, що й на
    // скані, плюс таймаут, щоб одне мовчазне з'єднання не тримало огляд.
    const url = /https?:\/\/\S+/.exec(d.last_error ?? "")?.[0]?.replace(/\s*→.*$/, "");
    if (!url) continue;
    if (await probe(url)) deprecatedButAlive.push(d.source_name);
  }

  const dryCompanies = (await q<{ slug: string; name: string; dry_scans: number }>(
    "SELECT slug,name,dry_scans FROM companies WHERE dry_scans >= ? LIMIT 50", [DRY_SCANS_LIMIT]))
    .map((r) => ({ slug: r.slug, name: r.name, dryScans: r.dry_scans }));

  const providerShare = await q<{ provider: string; jobs: number }>(
    `SELECT substr(source, 1, instr(source, ':') - 1) AS provider, COUNT(*) AS jobs
       FROM jobs_cache WHERE instr(source, ':') > 0
      GROUP BY provider ORDER BY jobs DESC LIMIT 10`);

  const counts = (await q<{ total: number; stale: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN fetched_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day') THEN 1 ELSE 0 END) AS stale
       FROM jobs_cache`))[0] ?? { total: 0, stale: 0 };

  const countriesWithoutBoard = await q<{ country: string; people: number }>(
    `SELECT p.country, COUNT(*) AS people
       FROM profiles p
      WHERE p.country IS NOT NULL
        AND p.country NOT IN (SELECT country FROM country_boards WHERE enabled=1)
      GROUP BY p.country ORDER BY people DESC LIMIT 10`);

  const dup = (await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT dedupe_key FROM jobs_cache GROUP BY dedupe_key HAVING COUNT(*) > 1)`))[0]?.n ?? 0;

  return {
    brokenNeverWorked, deprecatedButAlive, dryCompanies, providerShare,
    totalJobs: counts.total, staleJobs: counts.stale ?? 0, duplicateRoles: dup,
    countriesWithoutBoard,
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const dry = process.argv.includes("--dry");
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  const snapshot = await collect(d1);
  const proposals = review(snapshot);
  const runId = crypto.randomUUID();

  console.log(`Самоперегляд ${runId.slice(0, 8)}: ${proposals.length} пропозицій`);
  for (const p of proposals) console.log(`  [${p.severity}] ${p.title} — ${p.evidence}`);

  if (dry) { console.log("Пробний прогін, нічого не записано."); return; }

  // Унікальний індекс не дає створити другу таку саму відкриту пропозицію,
  // тож повторний прогін нічого не дублює.
  for (const p of proposals) {
    await d1.execute(
      `INSERT INTO proposals (id,kind,target,title,detail,evidence,severity,run_id)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), p.kind, p.target, p.title, p.detail, p.evidence, p.severity, runId]);
  }

  const open = (await d1.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM proposals WHERE status='open'"))[0]?.n ?? 0;
  console.log(`Відкритих пропозицій усього: ${open}`);
}

if (process.argv[1]?.endsWith("review.js")) await main();
