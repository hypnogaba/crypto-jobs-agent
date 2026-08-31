import { describe, expect, it } from "vitest";
import { extractCvText, CvError } from "./cv";

const file = (content: Uint8Array | string, name = "cv.txt"): File =>
  new File([typeof content === "string" ? content : (content.buffer as ArrayBuffer)], name);

const LONG = "Partnerships and ecosystem lead, eight years in business development, "
  + "developer relations, web3 infrastructure, remote across Europe, from 90k EUR. ";

describe("extractCvText", () => {
  it("читає звичайний текст", async () => {
    const t = await extractCvText(file(LONG.repeat(2)));
    expect(t).toContain("Partnerships");
  });

  it("відхиляє порожній файл", async () => {
    await expect(extractCvText(file(""))).rejects.toBeInstanceOf(CvError);
  });

  it("відхиляє завеликий файл", async () => {
    const big = new File([new ArrayBuffer(5 * 1024 * 1024)], "big.pdf");
    await expect(extractCvText(big)).rejects.toThrow(/tooBig/);
  });

  it("відхиляє файл, з якого не вийшло дістати текст", async () => {
    // Так поводиться скан-картинка: байти є, тексту немає
    await expect(extractCvText(file("коротко"))).rejects.toThrow(/unreadable/);
  });

  /**
   * Довжина нічого не доводить. Резюме зі вшитим шрифтом, прочитане без
   * таблиці символів, дає саме таке: багато байтів, жодного слова. Раніше
   * воно проходило перевірку й їхало в модель під виглядом резюме.
   */
  it("відхиляє довгий, але нечитний набір байтів", async () => {
    const noise = Array.from({ length: 400 }, (_, i) => String.fromCharCode(1 + (i % 30))).join("");
    await expect(extractCvText(file(noise))).rejects.toThrow(/unreadable/);
  });

  it("обрізає дуже довге резюме", async () => {
    const t = await extractCvText(file(LONG.repeat(600)));
    expect(t.length).toBeLessThanOrEqual(20_000);
  });
});

describe("extractPdf: розпакувальна бомба", () => {
  it("зупиняється на стелі, а не розгортає гігабайти", async () => {
    // 6 МБ нулів стискаються в кілька кілобайт; стеля на потік — 2 МБ.
    const zeros = new Uint8Array(6 * 1024 * 1024);
    const cs = new CompressionStream("deflate");
    const packed = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(cs)).arrayBuffer());
    const enc = new TextEncoder();
    const pdf = new Uint8Array([...enc.encode("%PDF-1.4\n1 0 obj<</Length 1>>stream\n"), ...packed, ...enc.encode("\nendstream\n")]);
    const file = new File([pdf], "bomb.pdf", { type: "application/pdf" });
    await expect(extractCvText(file)).rejects.toThrow(CvError);
    await expect(extractCvText(file)).rejects.toThrow("tooBig");
  });
});

// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { docxToText } from "./cv.js";

/**
 * .docx — найчастіший формат резюме, і саме він не читався: PDF ловився за
 * сигнатурою, а все інше декодувалось як UTF-8, з чого ZIP дає кашу.
 * Людина з вордівським резюме бачила «не зміг прочитати файл».
 *
 * Взірець — справжній архів, зібраний zipfile, а не вигаданий рядок:
 * помилка тут була б саме в бінарному розборі, і текстовий підробок її б
 * не впіймав.
 */
describe("резюме у .docx", () => {
  const bytes = readFileSync(new URL("./__fixtures__/sample-cv.docx", import.meta.url));
  const file = () => new File([new Uint8Array(bytes)], "cv.docx");

  it("читається як текст", async () => {
    const text = await extractCvText(file());
    expect(text).toContain("Senior Community Manager");
    expect(text).toContain("Bratislava");
    expect(text).toContain("3000 EUR");
  });

  it("абзаци не злипаються в одне слово", async () => {
    const text = await extractCvText(file());
    // Без переносів «Yehor KovalenkoSenior Community Manager» стало б одним
    // словом, і розбір по ньому не влучив би ні в роль, ні в місто.
    expect(text).not.toMatch(/KovalenkoSenior/);
  });

  it("розмітка Word знімається, а сутності розкриваються", () => {
    expect(docxToText("<w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>"))
      .toContain("A & B");
    expect(docxToText("<w:p><w:t>A</w:t></w:p><w:p><w:t>B</w:t></w:p>")).toMatch(/A\s*\n+\s*B/);
  });

  it("ZIP без word/document.xml — це не резюме", async () => {
    // Порожній ZIP: сигнатура є, потрібного запису немає.
    const empty = new Uint8Array([0x50,0x4b,0x03,0x04, ...new Array(18).fill(0),
                                  0x50,0x4b,0x05,0x06, ...new Array(18).fill(0)]);
    await expect(extractCvText(new File([empty], "x.docx"))).rejects.toThrow();
  });
});
