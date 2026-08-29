import { describe, expect, it, vi } from "vitest";

// Облік токенів тягне D1; локальний розбір його не потребує.
vi.mock("@/lib/usage", () => ({ logUsage: async () => {}, readUsage: () => ({ input: 0, output: 0 }) }));

import { parseLocally } from "./parse";

describe("сфера «дизайн»", () => {
  it("упізнається латиницею й кирилицею", () => {
    expect(parseLocally("Senior product designer, Figma, remote").spheres).toContain("design");
    expect(parseLocally("UX/UI, 5 років").spheres).toContain("design");
    expect(parseLocally("шукаю роботу графічним дизайнером у Києві").spheres).toContain("design");
    expect(parseLocally("графический дизайнер").spheres).toContain("design");
  });

  it("не чіпляється до слів усередині інших", () => {
    // «uiuc», «designated» — не дизайн
    expect(parseLocally("Designated backend engineer").spheres).not.toContain("design");
    expect(parseLocally("built the guide").spheres).not.toContain("design");
  });

  it("продукт більше не тягне дизайн за собою", () => {
    const { spheres } = parseLocally("product manager");
    expect(spheres).toContain("product");
    expect(spheres).not.toContain("design");
  });
});
