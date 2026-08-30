import { describe, expect, it } from "vitest";
import { planRetag } from "./retag.js";

const row = (o: Partial<Parameters<typeof planRetag>[0][number]> = {}) => ({
  id: "j1", title: "Senior Product Designer", company: "Acme",
  source: "greenhouse:acme", remote: 0, tags: '["product","senior"]', ...o });

describe("planRetag", () => {
  it("додає тег, якого правило раніше не знало", () => {
    // Саме цей випадок і стався: сферу «дизайн» додали через двадцять три
    // хвилини після останнього скану, і жоден дизайнер її не побачив.
    const plan = planRetag([row()]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.added).toContain("design");
    expect(plan[0]!.tags).toEqual(expect.arrayContaining(["product", "senior", "design"]));
  });

  it("успадкованих тегів не чіпає — лише доповнює", () => {
    // «web3» прийшов від компанії з колекції Getro, з назви його не вивести.
    // Перезапис зніс би нішу цілій групі компаній.
    const plan = planRetag([row({ tags: '["web3","product"]' })]);
    expect(plan[0]!.tags).toContain("web3");
  });

  it("мовчить, коли міняти нема чого", () => {
    expect(planRetag([row({ tags: '["design","product","senior"]' })])).toEqual([]);
  });

  it("VP отримує рівень — той самий випадок, що йшов junior-ам", () => {
    const plan = planRetag([row({ title: "VP, Growth Marketing", tags: '["marketing"]' })]);
    expect(plan[0]!.added).toContain("lead");
  });

  it("«other» не приклеюється до рядка, у якого теги вже є", () => {
    // deriveTags ставить «other», коли не впізнав нічого. Для рядка з
    // успадкованим тегом це була б відверта неправда.
    expect(planRetag([row({ title: "Zookeeper", tags: '["web3"]' })])).toEqual([]);
  });

  it("порожній рядок усе ж отримує «other», щоб не лишитись без тегів", () => {
    const plan = planRetag([row({ title: "Zookeeper", tags: "[]" })]);
    expect(plan[0]!.added).toEqual(["other"]);
  });

  it("побите JSON у тегах не валить прогін", () => {
    const plan = planRetag([row({ tags: "не json" })]);
    expect(plan[0]!.tags).toEqual(expect.arrayContaining(["design"]));
  });

  it("віддаленість береться зі стовпця, а не вгадується", () => {
    const plan = planRetag([row({ remote: 1, tags: '["design","product","senior"]' })]);
    expect(plan[0]!.added).toEqual(["remote"]);
  });
});
