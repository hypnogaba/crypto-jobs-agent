import { describe, expect, it } from "vitest";
import { deriveTags } from "./tags.js";
import type { RawJob } from "./types.js";

const j = (o: Partial<RawJob>): RawJob => ({
  url: "https://x.test/1", company: "Acme", title: "Engineer", location: null,
  remote: false, postedAt: null, source: "greenhouse:acme", ...o });

describe("deriveTags — маршрутизація за нішами", () => {
  it("розпізнає сферу з назви посади", () => {
    expect(deriveTags(j({ title: "Senior Backend Engineer" }))).toContain("engineering");
    expect(deriveTags(j({ title: "Developer Advocate" }))).toContain("devrel");
    expect(deriveTags(j({ title: "Head of Business Development" }))).toContain("partnerships");
  });
  it("розпізнає індустрію окремо від сфери", () => {
    const t = deriveTags(j({ title: "Solana Protocol Engineer" }));
    expect(t).toContain("web3");
    expect(t).toContain("engineering");
  });
  // Рівень більше не тегується взагалі: питання про нього прибрано, і
  // єдине правило, що читало ці теги, пішло разом із ним. Тег, якого ніхто
  // не питає, — саме та тиха розбіжність, з якої й почалась історія.
  it("рівня в тегах немає", () => {
    for (const title of ["Head of Product", "Junior QA Engineer", "Senior Backend Engineer",
                         "VP, Growth Marketing", "SVP Engineering"]) {
      const t = deriveTags(j({ title }));
      expect(t).not.toContain("lead");
      expect(t).not.toContain("senior");
      expect(t).not.toContain("junior");
    }
  });
  it("Getro сам по собі більше не означає web3", () => {
    // Колекція 1200 — ізраїльська дошка з Teva й NVIDIA. Нішу тепер диктує
    // конкретна колекція через inheritedTags, а не префікс джерела.
    expect(deriveTags(j({ source: "getro:1200" }))).not.toContain("web3");
    expect(deriveTags(j({ source: "getro:858", inheritedTags: ["web3"] }))).toContain("web3");
  });

  it("успадковує теги від джерела", () => {
    expect(deriveTags(j({ source: "aggregator:remoteok" }))).toContain("remote");
  });
  it("ніколи не лишає порожній список", () => {
    expect(deriveTags(j({ title: "Zookeeper" })).length).toBeGreaterThan(0);
  });
});

describe("успадковані теги компанії", () => {
  it("ніша компанії доживає до вакансії", () => {
    const t = deriveTags(j({ title: "Backend Engineer", source: "greenhouse:alchemy",
      inheritedTags: ["web3"] }));
    expect(t).toContain("web3");
    expect(t).toContain("engineering");
  });
  it("без успадкування нічого не ламається", () => {
    expect(deriveTags(j({ title: "Backend Engineer" }))).toContain("engineering");
  });
});

describe("сфера design", () => {
  it("дизайнер отримує тег design, product лишається як був", () => {
    const j = { title: "Senior Product Designer (Figma)", company: "Acme", source: "greenhouse:acme", remote: false } as unknown as Parameters<typeof deriveTags>[0];
    const tags = deriveTags(j);
    expect(tags).toContain("design");
    expect(tags).toContain("product");
  });
  it("UX, motion і brand design — теж design", () => {
    const of = (title: string) => deriveTags({ title, company: "X", source: "lever:x", remote: false } as unknown as Parameters<typeof deriveTags>[0]);
    expect(of("UX Researcher")).toContain("design");
    expect(of("Motion Graphics Lead")).toContain("design");
    expect(of("Brand Design Manager")).toContain("design");
    expect(of("Backend Engineer")).not.toContain("design");
  });
});
