import { describe, expect, it } from "vitest";
import { mapIndustries } from "./getro.js";

describe("mapIndustries — ніша береться з даних Getro, не вгадується", () => {
  it("розпізнає крипто-екосистему", () => {
    expect(mapIndustries({ industry_tags: ["Software", "Blockchain and Cryptocurrency"] }))
      .toContain("web3");
  });
  it("НЕ вважає медичну екосистему крипто", () => {
    const t = mapIndustries({ industry_tags: ["Software", "Health Care", "Apps"] });
    expect(t).toContain("health");
    expect(t).not.toContain("web3");
  });
  it("розпізнає AI", () => {
    expect(mapIndustries({ industry_tags: ["Artificial Intelligence (AI)", "Machine Learning"] }))
      .toContain("ai");
  });
  it("порожні дані дають порожній список, а не здогад", () => {
    expect(mapIndustries({})).toEqual([]);
    expect(mapIndustries(undefined)).toEqual([]);
  });
});
