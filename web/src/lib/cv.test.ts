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

  it("обрізає дуже довге резюме", async () => {
    const t = await extractCvText(file(LONG.repeat(600)));
    expect(t.length).toBeLessThanOrEqual(20_000);
  });
});
