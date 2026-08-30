/**
 * Прогін підбору: що б людина отримала СЬОГОДНІ за поточними правилами.
 *
 *   node dist/replay.js [--user <id>] [--limit 5] [--json out.json] [--baseline was.json]
 *
 * Навіщо це є. Правила підбору живуть у `match.ts` числами: сфера шість,
 * індустрія два, свіжість два. Поки їх не порахувати на живому кеші, ніхто
 * не може сказати, що станеться від зміни одного числа. Реальний випадок:
 * у добірці чотири вакансії стояли в нічию по 13 балів, і порядок між ними
 * вирішила дата публікації, а не відповідність. Побачити це можна було лише
 * з розкладкою бала.
 *
 * Прогін НІЧОГО не пише в базу і нікому нічого не шле. Він лише читає.
 *
 * Порядок роботи: зберегти базовий стан (`--json was.json`), змінити правила,
 * прогнати ще раз із `--baseline was.json` — і отримати таблицю «було/стало».
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { fetchCandidateRows, profileOf, PROFILE_COLUMNS, toCandidates, type UserRow } from "./digest.js";
import { pickTop, type Profile, type ScoredJob } from "./match.js";
import { readFileSync, writeFileSync } from "node:fs";

/** Один рядок результату — рівно те, що людина побачила б у повідомленні. */
interface ReplayPick {
  id: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  tags: string[];
  score: number;
  parts: Array<{ k: string; v: number }>;
}

interface ReplayUser {
  userId: string;
  locale: string;
  profile: string;
  windowSize: number;
  picks: ReplayPick[];
}

interface ReplayFile {
  at: string;
  users: ReplayUser[];
}

interface Args {
  onlyUser: string | null;
  limit: number;
  json: string | null;
  baseline: string | null;
}

export function parseReplayArgs(argv: string[]): Args {
  const out: Args = { onlyUser: null, limit: 5, json: null, baseline: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user") out.onlyUser = argv[++i] ?? null;
    else if (a === "--limit") out.limit = Number.parseInt(argv[++i] ?? "5", 10) || 5;
    else if (a === "--json") out.json = argv[++i] ?? null;
    else if (a === "--baseline") out.baseline = argv[++i] ?? null;
  }
  return out;
}

/** Профіль людськими словами — щоб у звіті було видно, кому це підбирали. */
export function describeProfile(p: Profile): string {
  return [
    p.spheres.join("+") || "—",
    p.customRole ? `роль «${p.customRole}»` : null,
    p.industries.join("+") || null,
    p.customIndustry ? `галузь «${p.customIndustry}»` : null,
    p.customSeniority ?? p.seniority,
    p.remoteMode,
    p.location ? `${p.location}${p.country ? ` (${p.country})` : ""}` : p.country,
    p.salaryMin ? `від ${p.salaryMin}` : null,
    p.wishes ? `побажання «${p.wishes}»` : null,
  ].filter(Boolean).join(" · ");
}

/** Розкладка одним рядком: sphere+6 level+3 fresh+2 = 11. */
export function partsLine(job: ReplayPick): string {
  const bits = job.parts.map((x) => `${x.k}${x.v > 0 ? "+" : ""}${round(x.v)}`);
  return `${bits.join(" ")} = ${round(job.score)}`;
}

const round = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const toPick = (j: ScoredJob): ReplayPick => ({
  id: j.id, company: j.company, title: j.title, location: j.location,
  remote: j.remote, tags: j.tags, score: j.score, parts: j.parts,
});

export function renderUser(u: ReplayUser): string {
  const head = `\n── ${u.userId.slice(0, 8)} · ${u.locale} · вікно ${u.windowSize}\n   ${u.profile}\n`;
  if (u.picks.length === 0) return `${head}   (нічого не підійшло)\n`;
  const rows = u.picks.map((j, i) => {
    const place = [j.location ?? "—", j.remote ? "віддалено" : null].filter(Boolean).join(" · ");
    return `   ${i + 1}. ${j.company} — ${j.title}\n      ${place}\n      ${partsLine(j)}`;
  });
  return `${head}${rows.join("\n")}\n`;
}

/**
 * Порівняння двох прогонів для однієї людини.
 *
 * Показуємо не «стало на 2 бали більше», а хто зайшов і хто вийшов: бал —
 * внутрішня одиниця, а людина бачить саме список компаній.
 */
export function renderDiff(was: ReplayUser | undefined, now: ReplayUser): string {
  if (!was) return `${renderUser(now)}   (у базовому прогоні цієї людини не було)\n`;
  const wasIds = new Set(was.picks.map((j) => j.id));
  const nowIds = new Set(now.picks.map((j) => j.id));
  const gone = was.picks.filter((j) => !nowIds.has(j.id));
  const came = now.picks.filter((j) => !wasIds.has(j.id));
  const kept = now.picks.filter((j) => wasIds.has(j.id));

  const label = (j: ReplayPick): string =>
    `${j.company} — ${j.title} [${j.location ?? "—"}${j.remote ? " · віддалено" : ""}]`;

  const lines = [
    `\n── ${now.userId.slice(0, 8)} · ${now.locale}`,
    `   ${now.profile}`,
    `   лишилось ${kept.length}, зайшло ${came.length}, вийшло ${gone.length}`,
  ];
  for (const j of gone) lines.push(`   −  ${label(j)}  (${partsLine(j)})`);
  for (const j of came) lines.push(`   +  ${label(j)}  (${partsLine(j)})`);
  for (const j of kept) lines.push(`   =  ${label(j)}  (${partsLine(j)})`);
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const now = new Date();
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });

  const where = ["u.status = 'active'"];
  const params: unknown[] = [];
  if (args.onlyUser) { where.push("u.id = ?"); params.push(args.onlyUser); }

  const users = await d1.query<UserRow>(
    `SELECT ${PROFILE_COLUMNS} WHERE ${where.join(" AND ")}`, params);

  const out: ReplayFile = { at: now.toISOString(), users: [] };
  for (const u of users) {
    const profile = profileOf(u);
    // Те саме вікно, що й у доставці: fetchCandidateRows спільна з digest.ts.
    const rows = await fetchCandidateRows(d1, profile, u.id);
    const candidates = toCandidates(rows);
    const top = pickTop(candidates, profile, args.limit, now);
    out.users.push({
      userId: u.id, locale: u.locale, profile: describeProfile(profile),
      windowSize: rows.length, picks: top.map(toPick),
    });
  }

  if (args.baseline) {
    const was = JSON.parse(readFileSync(args.baseline, "utf8")) as ReplayFile;
    const byId = new Map(was.users.map((x) => [x.userId, x]));
    console.log(`Було: ${was.at}\nСтало: ${out.at}`);
    for (const u of out.users) process.stdout.write(renderDiff(byId.get(u.userId), u));
  } else {
    for (const u of out.users) process.stdout.write(renderUser(u));
  }

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(out, null, 2));
    console.log(`\nЗаписано: ${args.json}`);
  }

  // Одна цифра, за якою видно здоров'я системи в цілому.
  const empty = out.users.filter((u) => u.picks.length === 0).length;
  const short = out.users.filter((u) => u.picks.length > 0 && u.picks.length < args.limit).length;
  console.log(`\nПрофілів ${out.users.length}: порожніх ${empty}, неповних ${short}.`);
}

if (process.argv[1]?.endsWith("replay.js")) await main();
