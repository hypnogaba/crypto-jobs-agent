/**
 * Чи годиться стрічка як дошка — відповідь тим самим кодом, що читає скан.
 *
 * Питання «чи жива стрічка» і «чи дасть вона вакансії» — різні, і друге
 * важливіше. `parseBoardTitle` мовчки викидає елемент, у якого не видно
 * компанії, тож стрічка на сто позицій із заголовками виду «Senior Backend
 * Engineer» дає рівно нуль рядків у базі. Перевірка, яка рахує лише <item>,
 * назвала б таку дошку здоровою — і ми додали б ще одне мовчазне джерело.
 *
 * Тому тут викликається справжній `fetchBoard`, а не його опис. Він же
 * показує, ЯК саме розібрався заголовок, — а розбір видно очима лише на
 * прикладах, не на числі.
 *
 *   node dist/probe-board.js <адреса> [<адреса>…]
 *   node dist/probe-board.js --stdin < список.txt
 */
import { fetchBoard, type Board } from "./sources/boards.js";

interface Verdict {
  url: string;
  items: number;      // скільки <item> у стрічці
  parsed: number;     // скільки з них стали вакансіями
  note: string;
  samples: string[];
}

/** Кількість <item> у сирому XML — щоб було з чим порівняти розбір. */
async function rawItems(url: string): Promise<number> {
  const { fetchXml } = await import("./http.js");
  const xml = await fetchXml(url, {}, { retries: 0, timeoutMs: 20_000 });
  return (xml.match(/<item[\s>]/gi) ?? []).length;
}

async function check(url: string): Promise<Verdict> {
  const board: Board = {
    name: "probe", label: "probe", country: "*", feedUrl: url, kind: "rss",
  };
  try {
    const items = await rawItems(url);
    const jobs = await fetchBoard(board, { retries: 0, timeoutMs: 20_000 });
    return {
      url, items, parsed: jobs.length,
      note: jobs.length === 0 && items > 0
        ? "заголовки без компанії — розбір дає нуль"
        : "",
      samples: jobs.slice(0, 3).map((j) => `${j.company} │ ${j.title} │ ${j.location ?? "—"}`),
    };
  } catch (e) {
    return { url, items: 0, parsed: 0, samples: [],
             note: e instanceof Error ? e.message.slice(0, 100) : String(e) };
  }
}

async function main(): Promise<void> {
  let urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (process.argv.includes("--stdin")) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    urls = Buffer.concat(chunks).toString("utf8")
      .split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  }
  if (!urls.length) {
    console.error("нічого перевіряти: дай адреси аргументами або --stdin");
    process.exit(2);
  }

  const { mapLimit } = await import("./http.js");
  const verdicts = await mapLimit(urls, 6, check);

  for (const v of verdicts) {
    const flag = v.parsed >= 3 ? "OK  " : v.items > 0 ? "ПУСТО" : "МЕРТВ";
    console.log(`${flag} ${String(v.items).padStart(4)}→${String(v.parsed).padStart(4)}  ${v.url}${v.note ? `  · ${v.note}` : ""}`);
    for (const s of v.samples) console.log(`         ${s}`);
  }
  const good = verdicts.filter((v) => v.parsed >= 3).length;
  console.log(`\n${good} із ${verdicts.length} стрічок дають вакансії.`);
}

await main();
