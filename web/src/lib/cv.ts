/**
 * Витяг тексту з файлу резюме.
 *
 * Продукт обіцяє «завантаж CV», а вмів досі лише вставлений текст.
 * Працює у Workers без жодної залежності: PDF розбирається власним
 * мінімальним читачем потоків, решта — як текст.
 *
 * Сам файл ніде не зберігається: витягуємо текст і забуваємо про нього.
 */

const MAX_BYTES = 4 * 1024 * 1024;

export class CvError extends Error {}

/**
 * Байт у символ один в один.
 *
 * УВАГА: TextDecoder("latin1") — це насправді windows-1252, а не ISO-8859-1.
 * Байти 0x80–0x9F мапляться на інші кодові позиції, і зворотне перетворення
 * їх псує. Саме через це ламався zlib-заголовок кожного PDF.
 */
const toBinaryString = (b: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < b.length; i += 8192) {
    out += String.fromCharCode(...b.subarray(i, i + 8192));
  }
  return out;
};

const indexOfBytes = (hay: Uint8Array, needle: string, from: number): number => {
  const n = needle.length;
  outer: for (let i = from; i <= hay.length - n; i++) {
    for (let k = 0; k < n; k++) if (hay[i + k] !== needle.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
};

/** Розпаковує потоки FlateDecode і збирає текст із рядкових літералів. */
async function extractPdf(bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  let cursor = 0;

  for (;;) {
    // Межі потоку шукаємо в БАЙТАХ: будь-який рядковий проміжний крок
    // спотворив би стиснені дані.
    const open = indexOfBytes(bytes, "stream", cursor);
    if (open === -1) break;
    let start = open + 6;
    if (bytes[start] === 0x0d) start++;
    if (bytes[start] === 0x0a) start++;

    const close = indexOfBytes(bytes, "endstream", start);
    if (close === -1) break;
    let end = close;
    if (bytes[end - 1] === 0x0a) end--;
    if (bytes[end - 1] === 0x0d) end--;
    cursor = close + 9;

    const slice = bytes.slice(start, end);   // копія: subarray не приймається як BlobPart
    let text: string;
    try {
      const ds = new DecompressionStream("deflate");
      const buf = await new Response(new Blob([slice.buffer as ArrayBuffer]).stream().pipeThrough(ds)).arrayBuffer();
      text = toBinaryString(new Uint8Array(buf));
    } catch {
      text = toBinaryString(slice);   // нестиснений потік
    }

    for (const t of text.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      chunks.push(t[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
    }
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export async function extractCvText(file: File): Promise<string> {
  if (file.size === 0) throw new CvError("empty");
  if (file.size > MAX_BYTES) throw new CvError("tooBig");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

  const text = isPdf
    ? await extractPdf(bytes)
    : new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  const clean = text.replace(/ /g, " ").replace(/\s+/g, " ").trim();

  // Занадто мало тексту — майже завжди скан-картинка, а не текстовий PDF
  if (clean.length < 120) throw new CvError("unreadable");
  return clean.slice(0, 20_000);
}
