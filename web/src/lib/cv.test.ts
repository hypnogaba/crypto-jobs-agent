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
