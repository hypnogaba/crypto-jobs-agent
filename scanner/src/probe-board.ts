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
 * Формат задається через `--kind`, і задавати його треба свідомо. Спершу
 * тут стояв жорсткий `rss`, і перевірка оголосила мертвою дошку
 * `board:global-web3career`: вона читається розміткою JobPosting, а не
 * стрічкою, тож RSS-шлях і мав віддати нуль. Дошку через це вимкнули.
 * «Нуль» тут означає «нуль у ЦЬОМУ форматі», не «дошка мертва».
 *
 *   node dist/probe-board.js <адреса> [<адреса>…]
 *   node dist/probe-board.js --kind jsonld <адреса>
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

/**
 * Скільки записів у сирій відповіді — щоб було з чим порівняти розбір.
 * Для RSS це `<item>`, для розмітки — блоки JobPosting.
 */
async function rawItems(url: string, kind: string): Promise<number> {
  // fetchXml, а не fetchText: другий не експортується, а перший — це той
  // самий текст із заголовками, якими читає сам сканер.
  const { fetchXml } = await import("./http.js");
  const body = await fetchXml(url, {}, { retries: 0, timeoutMs: 20_000 });
  return kind === "rss"
    ? (body.match(/<item[\s>]/gi) ?? []).length
    : (body.match(/"@type"\s*:\s*"JobPosting"/gi) ?? []).length;
}

async function check(url: string, kind: string): Promise<Verdict> {
  const board: Board = {
    name: "probe", label: "probe", country: "*", feedUrl: url, kind,
  };
  try {
    const items = await rawItems(url, kind);
    const jobs = await fetchBoard(board, { retries: 0, timeoutMs: 20_000 });
    return {
      url, items, parsed: jobs.length,
      note: jobs.length === 0 && items > 0
        ? "записи є, але розбір дає нуль — заголовки без компанії"
        : "",
      samples: jobs.slice(0, 3).map((j) => `${j.company} │ ${j.title} │ ${j.location ?? "—"}`),
    };
  } catch (e) {
    return { url, items: 0, parsed: 0, samples: [],
             note: e instanceof Error ? e.message.slice(0, 100) : String(e) };
  }
}

async function main(): Promise<void> {
  const kindAt = process.argv.indexOf("--kind");
  const kind = kindAt > -1 ? process.argv[kindAt + 1] ?? "rss" : "rss";

  let urls = process.argv.slice(2)
    .filter((a, i) => !a.startsWith("--") && i !== kindAt - 1);
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
  const verdicts = await mapLimit(urls, 6, (u) => check(u, kind));

  for (const v of verdicts) {
    // «МЕРТВ» тут — «нуль записів У ЦЬОМУ форматі». Дошка може бути жива й
    // читатись іншим: web3.career не має RSS, але має розмітку JobPosting.
    const flag = v.parsed >= 3 ? "OK  " : v.items > 0 ? "ПУСТО" : `0/${kind}`;
    console.log(`${flag} ${String(v.items).padStart(4)}→${String(v.parsed).padStart(4)}  ${v.url}${v.note ? `  · ${v.note}` : ""}`);
    for (const s of v.samples) console.log(`         ${s}`);
  }
  const good = verdicts.filter((v) => v.parsed >= 3).length;
  console.log(`\n${good} із ${verdicts.length} стрічок дають вакансії.`);
}

await main();
