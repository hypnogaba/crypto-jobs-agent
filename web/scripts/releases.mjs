/**
 * Історія версій для панелі власника.
 *
 * Воркер не має git, тому список збирається тут і кладеться у файл, який
 * потрапляє в збірку. Джерело — самі коміти: у цьому репозиторії заголовок
 * коміта є реченням про те, що змінилось для людини, тож окремий CHANGELOG
 * писати не треба й нема ризику, що він розійдеться з кодом.
 *
 *     npm run releases      # перед деплоєм
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const DAYS = 30;   // скільки днів історії тримаємо в панелі
const OUT = new URL("../src/lib/releases.ts", import.meta.url);

/**
 * Що НЕ є зміною продукту.
 *
 * Панель показувала всі коміти підряд, і за день їх набиралось 57: між
 * «Кабінет: кнопка Уточнити» стояли чотири рядки «Історія версій», мерджі
 * гілок і правки документації. Список був повний і нечитний водночас —
 * власник шукав у ньому те, що змінилось для людей, і не знаходив.
 *
 * Прибираємо службове: перегенерацію самого цього файлу, злиття гілок,
 * документацію, специфікації й плани. Решта — це те, що людина побачить.
 */
const CHORE = /^(?:Історія версій|Злиття\b|Мердж\b|Merge |docs:|chore|test:|Специфікація:|План:|Плани\b|SETUP\b|lint\b)/i;

/** Довгий заголовок ріжемо по межі слова: рядок панелі — не абзац. */
const SUBJECT_MAX = 120;
const clip = (s) => s.length <= SUBJECT_MAX
  ? s
  : `${s.slice(0, SUBJECT_MAX).replace(/\s+\S*$/, "")}…`;

const raw = execSync(
  `git log --no-merges --since="${DAYS} days ago" --date=short --pretty=format:%ad%x09%h%x09%s`,
  { encoding: "utf8" },
).trim();

const byDay = new Map();
for (const line of raw.split("\n").filter(Boolean)) {
  const [date, hash, subject] = line.split("\t");
  if (!byDay.has(date)) byDay.set(date, { changes: [], chores: 0 });
  const day = byDay.get(date);
  if (CHORE.test(subject)) day.chores += 1;
  else day.changes.push({ hash, subject: clip(subject) });
}

// День, у якому не лишилось жодної змістовної зміни, у панелі не потрібен.
const days = [...byDay.entries()]
  .map(([date, day]) => ({ date, changes: day.changes, chores: day.chores }))
  .filter((d) => d.changes.length > 0);

const body = `// Згенеровано: npm run releases. Руками не редагувати.
// Джерело — git log; як це працює й навіщо, описано в scripts/releases.mjs.

export type Release = {
  date: string;
  changes: Array<{ hash: string; subject: string }>;
  /** Скільки службових комітів того дня приховано (мерджі, docs, перегенерації). */
  chores: number;
};

export const RELEASES: Release[] = ${JSON.stringify(days, null, 2)};

export const GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " "))};
`;

writeFileSync(OUT, body);
console.log(`releases.ts: ${days.length} днів, `
  + `${days.reduce((a, d) => a + d.changes.length, 0)} змін, `
  + `${days.reduce((a, d) => a + d.chores, 0)} службових приховано`);
