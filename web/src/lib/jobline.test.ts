import { describe, expect, it } from "vitest";
import { tidyCompany, tidyLocation } from "./jobline";

describe("tidyLocation", () => {
  it("місто лишає, абзац прибирає", () => {
    expect(tidyLocation("Warsaw, Poland")).toBe("Warsaw, Poland");
    expect(tidyLocation("Belgrade, Serbia;")).toBe("Belgrade, Serbia");
    expect(tidyLocation("REMOTE (US/Canada/Brazil) Full-time AI Risk Decisioning platform that helps organizations manage onboarding and fraud")).toBeNull();
  });
  it("порожнє це null", () => {
    expect(tidyLocation(null)).toBeNull();
    expect(tidyLocation("  ")).toBeNull();
  });
});

describe("tidyCompany", () => {
  it("домен і ключ з адреси", () => {
    expect(tidyCompany("Oscilar.com")).toBe("Oscilar");
    expect(tidyCompany("jetbrains")).toBe("Jetbrains");
  });
  it("звичайні назви не чіпає", () => {
    for (const n of ["Acme Inc.", "A&B Labs", "Monad Foundation", "iExec"]) expect(tidyCompany(n)).toBe(n);
  });
});
