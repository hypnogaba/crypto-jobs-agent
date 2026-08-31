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

/**
 * .docx — це ZIP, а розпаковувати ми вже вміємо.
 *
 * Найчастіший формат резюме, і саме він не читався: PDF ловився за
 * сигнатурою, а все інше декодувалось як UTF-8. ZIP під декодером дає кашу,
 * `literacy()` її відкидає — і людина з вордівським резюме бачила «не зміг
 * прочитати файл», хоча файл був цілком звичайний.
 *
 * Свого розпакувальника не пишемо й залежності не додаємо: у Worker є
 * DecompressionStream, і він уже носить PDF-потоки. Різниця одна — у ZIP
 * лежить СИРИЙ deflate без zlib-обгортки, тобто "deflate-raw".
 */
const DOCX_PART = "word/document.xml";

/** Чи це ZIP: «PK\x03\x04» на початку. .docx, .odt і будь-який архів. */
const isZip = (b: Uint8Array): boolean =>
  b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

const u16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number): number =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/**
 * Один названий запис із ZIP.
 *
 * Читаємо через центральний каталог, а не скануванням локальних заголовків:
 * у каталозі лежать надійні розміри, тоді як локальний заголовок має право
 * ставити нулі й дописувати розмір ПІСЛЯ даних (прапорець 0x08). Саме так
 * пишуть архіватори, що не знають розміру наперед, — а Word серед них.
 */
async function zipEntry(bytes: Uint8Array, want: string): Promise<Uint8Array | null> {
  // Кінець центрального каталогу — з хвоста, бо там змінний коментар.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  let at = u32(bytes, eocd + 16);
  const count = u16(bytes, eocd + 10);
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (u32(bytes, at) !== 0x02014b50) return null;
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const method = u16(bytes, at + 10);
    const compSize = u32(bytes, at + 20);
    const localAt = u32(bytes, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));

    if (name === want) {
      if (compSize > MAX_INFLATED_STREAM) throw new CvError("tooBig");
      // Довжини імені й «extra» в локальному заголовку СВОЇ — у каталозі
      // вони інші, і взяти їх звідти означало б зчитати зі зсувом.
      if (u32(bytes, localAt) !== 0x04034b50) return null;
      const dataAt = localAt + 30 + u16(bytes, localAt + 26) + u16(bytes, localAt + 28);
      // Копія, а не підмасив: підмасив ділить буфер із цілим архівом, і Blob
      // від нього взяв би файл із нульового байта — deflate тоді падає з
      // «invalid stored block lengths». Той самий обхід, що й для PDF вище.
      const slice = bytes.slice(dataAt, dataAt + compSize);
      if (method === 0) return slice;
      if (method !== 8) return null;
      return await inflateRawCapped(slice, MAX_INFLATED_STREAM);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Те саме, що inflateCapped, але без zlib-обгортки: у ZIP лежить сирий deflate. */
async function inflateRawCapped(slice: Uint8Array, cap: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const reader = new Blob([slice.buffer as ArrayBuffer]).stream().pipeThrough(ds).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel(); throw new CvError("tooBig"); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

/**
 * Текст із розмітки Word.
 *
 * Абзац і розрив рядка стають переносом, табуляція — пробілом, решта тегів
 * зникає. Без цього весь документ склеївся б в один рядок і «Senior Product
 * ManagerAcme2021» читалось би як одне слово — саме те, від чого потім
 * страждає розбір.
 */
export function docxToText(xml: string): string {
  return xml
    .replace(/<w:(?:p|br)\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function extractCvText(file: File): Promise<string> {
  if (file.size === 0) throw new CvError("empty");
  if (file.size > CV_MAX_BYTES) throw new CvError("tooBig");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

  if (isZip(bytes)) {
    const part = await zipEntry(bytes, DOCX_PART);
    // ZIP без word/document.xml — не .docx: .odt, .pages, просто архів. Для
    // людини це та сама відповідь «не прочитав», і вона чесна.
    if (!part) throw new CvError("unreadable");
    const clean = tidy(docxToText(new TextDecoder("utf-8", { fatal: false }).decode(part)));
    if (clean.length < MIN_CHARS || literacy(clean) < MIN_LITERACY) throw new CvError("unreadable");
    return clean.slice(0, 20_000);
  }

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
