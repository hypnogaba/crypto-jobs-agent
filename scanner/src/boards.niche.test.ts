import { describe, expect, it } from "vitest";
import { nicheOf } from "./sources/boards.js";

describe("ніша вакансії з того, що сказала дошка", () => {
  // Живий запис із jobstash.xyz 02.09.
  const walletconnect = {
    title: "Engineering Manager",
    tags: [{ name: "Architecture" }, { name: "Web3" }, { name: "Typescript" }],
    organization: { name: "WalletConnect",
      summary: "WalletConnect operates crypto and stablecoin payment infrastructure." },
  };
  const lovable = {
    title: "Content Designer",
    tags: [{ name: "Content" }, { name: "Design" }],
    organization: { name: "Lovable", summary: "Build apps by chatting with AI." },
  };

  it("крипто-роботодавця впізнає з опису організації", () => {
    expect(nicheOf(walletconnect)).toEqual(["web3"]);
  });

  it("AI-редактор криптою не стає", () => {
    expect(nicheOf(lovable)).toEqual([]);
  });

  it("мовчання дошки — це порожньо, а не «не крипта»", () => {
    // Порожній результат не карає рядок: далі працюють звичайні правила.
    expect(nicheOf({ title: "Backend Engineer" })).toEqual([]);
  });

  it("власного тега дошки досить, навіть коли опису немає", () => {
    expect(nicheOf({ tags: [{ name: "DeFi" }] })).toEqual(["web3"]);
  });

  it("«trading» саме по собі криптою не робить", () => {
    // Саме на цьому гуртовий тег і помилявся: Optiver і DRW це трейдинг.
    expect(nicheOf({ tags: [{ name: "Trading" }],
      organization: { name: "Optiver", summary: "Global market maker." } })).toEqual([]);
  });
});
