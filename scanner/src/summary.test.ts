import { describe, expect, it } from "vitest";
import { summarize, cut } from "./summary.js";

describe("summarize", () => {
  it("бере абзац після заголовка про роль, а не рекламу компанії", () => {
    const text = [
      "About Ramp",
      "Ramp is building the smart infrastructure for finance teams, embedded in the transaction flow of every dollar a business spends.",
      "About the Role",
      "You will own the trade lifecycle for equities and crypto, resolving settlement breaks and reconciling with brokers every day.",
    ].join("\n\n");
    expect(summarize(text, "Ramp")).toMatch(/^You will own the trade lifecycle/);
  });

  it("не лишає тегів, коли HTML екранований подвійно", () => {
    // Greenhouse віддає &lt;p&gt;. Якщо декодувати сутності ПІСЛЯ зняття
    // тегів, вони випливають у видимий текст — саме цей дефект ловимо.
    const text = "&lt;p&gt;You will help fintechs and broker-dealers launch brokerage products using our institutional API.&lt;/p&gt;";
    const out = summarize(text, "Alpaca");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toMatch(/^You will help fintechs/);
  });

  it("відкидає абзац, що відкривається назвою компанії", () => {
    const text = [
      "Alpaca is a fast-growing fintech company serving developers around the world with brokerage infrastructure at scale.",
      "We are looking for a high-performing Account Executive with a track record of selling to registered investment advisers.",
    ].join("\n\n");
    expect(summarize(text, "Alpaca")).toMatch(/^We are looking for a high-performing/);
  });

  it("відкидає юридичні та маркетингові блоки", () => {
    const text = [
      "Benefits: we offer generous health cover, unlimited leave and an annual learning budget for every employee.",
      "In this role you will run ACATS and non-ACATS transfer workflows across the partner ecosystem.",
    ].join("\n\n");
    expect(summarize(text, "Acme")).toMatch(/^In this role you will run ACATS/);
  });

  it("повертає null на порожньому вході, а не порожній рядок", () => {
    expect(summarize("", "Acme")).toBeNull();
    expect(summarize(null, "Acme")).toBeNull();
    expect(summarize("   \n  ", "Acme")).toBeNull();
  });

  it("не повертає самих заголовків без тіла", () => {
    expect(summarize("Your Role:\n\nApply now", "Acme")).toBeNull();
  });
});

describe("cut", () => {
  it("обрізає по межі речення", () => {
    const p = "First sentence here. " + "x".repeat(300) + ".";
    expect(cut(p, 240)).toBe("First sentence here.");
  });

  it("не чіпає короткий текст", () => {
    expect(cut("Short one.", 240)).toBe("Short one.");
  });

  it("ріже по слову, коли перше речення довше за ліміт", () => {
    const p = "word ".repeat(100).trim() + ".";
    const out = cut(p, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
  });
});
