import { describe, expect, it } from "vitest";
import { readPdfText } from "./pdf";

/**
 * PDF складаємо самі, байт до байта.
 *
 * Готового файлу тут бути не може: перевіряти треба саме ті властивості, на
 * яких читач ламався, а не «якийсь PDF узагалі». Кожна збірка нижче — це
 * окрема пастка справжніх резюме.
 */

const inflate = async (slice: Uint8Array): Promise<Uint8Array> => {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([slice.buffer as ArrayBuffer]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Складає файл із готових тіл обʼєктів: `1 0 obj … endobj`. */
const build = (objects: string[]): Uint8Array =>
  new TextEncoder().encode(
    "%PDF-1.7\n" + objects.map((body, i) => `${i + 1} 0 obj\n${body}\nendobj\n`).join("") + "%%EOF");

/** Таблиця /ToUnicode: коди гліфів у літери. */
const cmap = (pairs: Array<[number, string]>): string => {
  const rows = pairs
    .map(([code, ch]) => `<${code.toString(16).padStart(2, "0")}> `
      + `<${ch.charCodeAt(0).toString(16).padStart(4, "0")}>`)
    .join("\n");
  return `<</Length 1>>\nstream\n/CIDInit /ProcSet findresource begin\n`
    + `1 begincodespacerange\n<00> <FF>\nendcodespacerange\n`
    + `${pairs.length} beginbfchar\n${rows}\nendbfchar\nend\nendstream`;
};

const content = (body: string): string => `<</Length 1>>\nstream\n${body}\nendstream`;

const HELLO: Array<[number, string]> = [
  [0x01, "I"], [0x02, "v"], [0x03, "a"], [0x04, "n"], [0x05, "P"], [0x06, "o"],
];

describe("readPdfText", () => {
  it("читає рядок, записаний кодами гліфів", async () => {
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 4 0 R>>>> /Contents 6 0 R>>",
      "<</Type /Font /Subtype /TrueType /FirstChar 1 /LastChar 6 "
        + "/Widths [500 500 500 500 500 500] /ToUnicode 5 0 R>>",
      cmap(HELLO),
      content("BT /F1 10 Tf <010203040506> Tj ET"),
    ]);
    expect((await readPdfText(pdf, inflate)).trim()).toBe("IvanPo");
  });

  /**
   * Головна пастка: генератор ставить кожну літеру власним `Td`, і жодного
   * пробілу у файлі немає. Пробіл треба вивести з того, наскільки зсув більший
   * за ширину попереднього гліфа.
   */
  it("виводить пробіл із відстані, а не з тексту", async () => {
    // Ширина кожного гліфа — 500 тисячних, тобто 5 одиниць при кеглі 10.
    const glyphs = "BT /F1 10 Tf <01> Tj 5 0 Td <02> Tj 5 0 Td <03> Tj 5 0 Td <04> Tj"
      + " 12 0 Td <05> Tj 5 0 Td <06> Tj ET";
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 4 0 R>>>> /Contents 6 0 R>>",
      "<</Type /Font /Subtype /TrueType /FirstChar 1 /LastChar 6 "
        + "/Widths [500 500 500 500 500 500] /ToUnicode 5 0 R>>",
      cmap(HELLO),
      content(glyphs),
    ]);
    // Зсув 5 — це рівно ширина літери, пробілу там немає. Зсув 12 — ширина
    // плюс сім одиниць порожнечі, і саме туди має стати пробіл.
    expect((await readPdfText(pdf, inflate)).trim()).toBe("Ivan Po");
  });

  /**
   * Type3 міряє ширини власною /FontMatrix. Якщо ділити їх на тисячу, як усі
   * інші шрифти, кожен проміжок здається пробілом — виходить «I v a n».
   */
  it("рахує ширини Type3 за його FontMatrix", async () => {
    const glyphs = "BT /F1 40 Tf <01> Tj 20 0 Td <02> Tj 20 0 Td <03> Tj 20 0 Td <04> Tj ET";
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 4 0 R>>>> /Contents 6 0 R>>",
      // 1024 одиниці шрифта × (1/2048) × кегль 40 = 20 — рівно зсув у потоці.
      "<</Type /Font /Subtype /Type3 /FontMatrix [.00048828125 0 0 .00048828125 0 0] "
        + "/FirstChar 1 /LastChar 6 /Widths [1024 1024 1024 1024 1024 1024] /ToUnicode 5 0 R>>",
      cmap(HELLO),
      content(glyphs),
    ]);
    expect((await readPdfText(pdf, inflate)).trim()).toBe("Ivan");
  });

  it("бере пробіл із від'ємного зсуву в масиві TJ", async () => {
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 4 0 R>>>> /Contents 6 0 R>>",
      "<</Type /Font /Subtype /TrueType /FirstChar 1 /LastChar 6 "
        + "/Widths [500 500 500 500 500 500] /ToUnicode 5 0 R>>",
      cmap(HELLO),
      content("BT /F1 10 Tf [<01020304> -400 <0506>] TJ ET"),
    ]);
    expect((await readPdfText(pdf, inflate)).trim()).toBe("Ivan Po");
  });

  it("успадковує ресурси від /Pages, коли сторінка своїх не має", async () => {
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1 /Resources <</Font <</F1 4 0 R>>>>>>",
      "<</Type /Page /Parent 2 0 R /Contents 6 0 R>>",
      "<</Type /Font /Subtype /TrueType /FirstChar 1 /LastChar 6 "
        + "/Widths [500 500 500 500 500 500] /ToUnicode 5 0 R>>",
      cmap(HELLO),
      content("BT /F1 10 Tf <0102> Tj ET"),
    ]);
    expect((await readPdfText(pdf, inflate)).trim()).toBe("Iv");
  });

  it("читає текст із форми /XObject", async () => {
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 4 0 R>> "
        + "/XObject <</X7 7 0 R>>>> /Contents 6 0 R>>",
      "<</Type /Font /Subtype /TrueType /FirstChar 1 /LastChar 6 "
        + "/Widths [500 500 500 500 500 500] /ToUnicode 5 0 R>>",
      cmap(HELLO),
      content("BT /F1 10 Tf <01> Tj ET"),
      `<</Type /XObject /Subtype /Form>>\nstream\nBT /F1 10 Tf <0506> Tj ET\nendstream`,
    ]);
    const text = await readPdfText(pdf, inflate);
    expect(text).toContain("I");
    expect(text).toContain("Po");
  });

  it("без /ToUnicode лишає байти як є — старий простий PDF читається далі", async () => {
    const pdf = build([
      "<</Type /Catalog /Pages 2 0 R>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>",
      "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>",
      content("BT /F1 10 Tf (Partnerships lead) Tj ET"),
    ]);
    expect((await readPdfText(pdf, inflate)).trim()).toBe("Partnerships lead");
  });
});
