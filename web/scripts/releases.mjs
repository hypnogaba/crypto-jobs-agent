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

const raw = execSync(
  `git log --since="${DAYS} days ago" --date=short --pretty=format:%ad%x09%h%x09%s`,
  { encoding: "utf8" },
).trim();

const byDay = new Map();
for (const line of raw.split("\n").filter(Boolean)) {
  const [date, hash, subject] = line.split("\t");
  if (!byDay.has(date)) byDay.set(date, []);
  byDay.get(date).push({ hash, subject });
}

const days = [...byDay.entries()].map(([date, changes]) => ({ date, changes }));

const body = `// Згенеровано: npm run releases. Руками не редагувати.
// Джерело — git log; як це працює й навіщо, описано в scripts/releases.mjs.

export type Release = {
  date: string;
  changes: Array<{ hash: string; subject: string }>;
};

export const RELEASES: Release[] = ${JSON.stringify(days, null, 2)};

export const GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " "))};
`;

writeFileSync(OUT, body);
console.log(`releases.ts: ${days.length} днів, ${raw.split("\n").length} змін`);
