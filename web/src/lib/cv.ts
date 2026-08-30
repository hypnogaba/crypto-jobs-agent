/**
 * Витяг тексту з файлу резюме.
 *
 * Продукт обіцяє «завантаж CV», а вмів досі лише вставлений текст.
 * Працює у Workers без жодної залежності: PDF читає власний розбірник у
 * pdf.ts, решта — як текст.
 *
 * Сам файл ніде не зберігається: витягуємо текст і забуваємо про нього.
 */

import { PdfAbort, readPdfText, toBinaryString } from "./pdf";

/**
 * Стеля на сам файл. Єдине джерело правди для цього числа: сторінка бере
 * його звідси й тим самим показує людині ту межу, яка справді діє, а поле
 * не дає навіть спробувати більший файл.
 *
 * Стеля Next на тіло серверної дії (next.config.ts) мусить лишатись ВИЩОЮ:
 * вона спрацьовує раніше за цей код, і файл рівно на межі має отримати
 * пояснення, а не сторінку 500.
 */
export const CV_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Стеля на розпакований потік і на всі потоки разом.
 *
 * Deflate стискає нулі в тисячі разів: файл на 4 МБ може розгорнутись у
 * гігабайти й покласти ізолят. Текстове резюме — це десятки кілобайт, тож
 * межі щедрі, але скінченні.
 */
const MAX_INFLATED_STREAM = 2 * 1024 * 1024;
const MAX_INFLATED_TOTAL = 8 * 1024 * 1024;

export class CvError extends Error {}

/** Читає розпакований потік, зупиняючись на стелі замість того, щоб рости. */
async function inflateCapped(slice: Uint8Array, cap: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const reader = new Blob([slice.buffer as ArrayBuffer]).stream().pipeThrough(ds).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new PdfAbort("tooBig");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

/**
 * Запасний прохід: рядкові літерали з усього файлу підряд.
 *
 * Читач у pdf.ts розуміє формат, і саме тому може на ньому спіткнутись —
 * зламаний xref, чужий /Encoding, генератор із власними вигадками. Тоді
 * лишається те, що працювало раніше: узяти все, що лежить у круглих дужках.
 * Для простих PDF (LaTeX, старі принтери) цього досить, і краще мати грубий
 * текст, ніж не мати ніякого.
 */
async function literalSweep(bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  const bin = toBinaryString(bytes);
  let cursor = 0;
  let inflated = 0;

  for (;;) {
    const open = bin.indexOf("stream", cursor);
    if (open === -1) break;
    let start = open + 6;
    if (bytes[start] === 0x0d) start++;
    if (bytes[start] === 0x0a) start++;

    const close = bin.indexOf("endstream", start);
    if (close === -1) break;
    let end = close;
    if (bytes[end - 1] === 0x0a) end--;
    if (bytes[end - 1] === 0x0d) end--;
    cursor = close + 9;

    const slice = bytes.slice(start, end);   // копія: subarray не приймається як BlobPart
    let text: string;
    try {
      const buf = await inflateCapped(slice, MAX_INFLATED_STREAM);
      inflated += buf.byteLength;
      if (inflated > MAX_INFLATED_TOTAL) throw new PdfAbort("tooBig");
      text = toBinaryString(buf);
    } catch (e) {
      if (e instanceof PdfAbort) throw e;
      text = toBinaryString(slice);   // нестиснений потік
    }

    for (const t of text.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      chunks.push(t[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
    }
  }

  return chunks.join(" ");
}

/**
 * Частка літер і цифр серед усього тексту.
 *
 * Потрібна саме тому, що довжина нічого не доводить. Резюме з підмножиною
 * шрифта, прочитане без таблиці /ToUnicode, дає сотні символів — але це
 * коди гліфів і уламки шрифтових таблиць, а не слова. Стара перевірка
 * «більше 120 символів» таке пропускала, і далі в модель їхало сміття під
 * виглядом резюме. Живий текст будь-якою мовою впевнено переходить межу.
 */
const literacy = (s: string): number =>
  s.length === 0 ? 0 : (s.match(/[\p{L}\p{N}\s]/gu)?.length ?? 0) / s.length;

const MIN_CHARS = 120;
const MIN_LITERACY = 0.7;

/**
 * Прибирання пробілів зі збереженням рядків.
 *
 * Розриви лишаються навмисно: у резюме рядок — це одиниця сенсу (посада,
 * компанія, дата), і модель розбирає такий текст помітно краще, ніж суцільне
 * полотно. Схлопуються тільки повтори.
 */
const tidy = (s: string): string => s
  .replace(/\u00a0/g, " ")
  .replace(/[^\S\n]+/g, " ")
  .replace(/ ?\n ?/g, "\n")
  .replace(/\n{2,}/g, "\n")
  .trim();

export async function extractCvText(file: File): Promise<string> {
  if (file.size === 0) throw new CvError("empty");
  if (file.size > CV_MAX_BYTES) throw new CvError("tooBig");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

  if (!isPdf) {
    const clean = tidy(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    // Та сама перевірка, що й для PDF: під виглядом .txt приходить і .doc, і
    // архів, і будь-що інше, з чого декодер зробить довгий набір знаків.
    if (clean.length < MIN_CHARS || literacy(clean) < MIN_LITERACY) throw new CvError("unreadable");
    return clean.slice(0, 20_000);
  }

  let inflated = 0;
  const inflate = async (slice: Uint8Array): Promise<Uint8Array> => {
    const out = await inflateCapped(slice, MAX_INFLATED_STREAM);
    inflated += out.byteLength;
    if (inflated > MAX_INFLATED_TOTAL) throw new PdfAbort("tooBig");
    return out;
  };

  let clean = "";
  try {
    clean = tidy(await readPdfText(bytes, inflate));
  } catch (e) {
    if (e instanceof PdfAbort) throw new CvError("tooBig");
    clean = "";   // читач спіткнувся — нижче спробуємо грубо
  }

  if (clean.length < MIN_CHARS || literacy(clean) < MIN_LITERACY) {
    const rough = tidy(await literalSweep(bytes).catch((e) => {
      if (e instanceof PdfAbort) throw new CvError("tooBig");
      return "";
    }));
    // Беремо запасний прохід лише тоді, коли він справді кращий: інакше
    // грубі уламки заступили б нормально прочитаний, просто короткий текст.
    if (literacy(rough) >= MIN_LITERACY && rough.length > clean.length) clean = rough;
  }

  // Занадто мало тексту або суцільні коди гліфів — майже завжди скан-картинка
  // або шрифт без таблиці символів. Обіцяти таке резюме не можна.
  if (clean.length < MIN_CHARS || literacy(clean) < MIN_LITERACY) throw new CvError("unreadable");
  return clean.slice(0, 20_000);
}
