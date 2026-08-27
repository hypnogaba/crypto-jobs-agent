import { describe, expect, it } from "vitest";
import { judgeDay } from "./watchdog.js";

describe("judgeDay — судить за результатом, не за фактом запуску", () => {
  it("форсує, якщо скан не запускався", () => {
    expect(judgeDay(null, 0, 5).rerun).toBe(true);
  });
  it("форсує, якщо прогін впав", () => {
    expect(judgeDay({ id: "abcdef12", distinctCompanies: 0, status: "failed" }, 0, 5).rerun).toBe(true);
  });
  it("форсує чистий прогін, що дав замало компаній", () => {
    const v = judgeDay({ id: "abcdef12", distinctCompanies: 3, status: "ok" }, 3, 5);
    expect(v.rerun).toBe(true);
    expect(v.reason).toContain("3");
  });
  it("вірить кешу, а не звіту прогону", () => {
    expect(judgeDay({ id: "abcdef12", distinctCompanies: 12, status: "ok" }, 2, 5).rerun).toBe(true);
  });
  it("пропускає день, що взяв поріг", () => {
    expect(judgeDay({ id: "abcdef12", distinctCompanies: 9, status: "ok" }, 9, 5).rerun).toBe(false);
  });
});
