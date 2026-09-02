import { describe, expect, it } from "vitest";
import { planRetag } from "./retag.js";

const row = (o: Partial<Parameters<typeof planRetag>[0][number]> = {}) => ({
  id: "j1", title: "Senior Product Designer", company: "Acme", company_key: "acme",
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

  it("рівня більше не додає — правил під нього немає", () => {
    expect(planRetag([row({ title: "VP, Growth Marketing", tags: '["marketing"]' })])).toEqual([]);
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

describe("ніша джерела", () => {
  // Живий випадок 02.09: jobstash.xyz віддавав 1651 крипто-вакансію, з яких
  // тег web3 мали 36. Правило дивиться в назву, а назва про крипту мовчить.
  const row = {
    id: "j1", title: "Senior Backend Engineer", company: "Helius",
    // remote: 0 навмисно — інакше рядок отримує ще й тег «remote», і
    // перевірка перестає бути про нішу.
    source: "board:global-jobstash", remote: 0, tags: '["engineering"]',
  };

  it("без ніші джерела тег не з'являється — саме так і було", () => {
    expect(planRetag([row])).toEqual([]);
  });

  it("з нішею джерела вакансія нарешті стає крипто-вакансією", () => {
    const niche = new Map([["board:global-jobstash", ["web3"]]]);
    const [change] = planRetag([row], niche);
    expect(change?.added).toEqual(["web3"]);
    expect(change?.tags).toEqual(["engineering", "web3"]);
  });

  it("чуже джерело чужу нішу не бере", () => {
    const niche = new Map([["board:global-jobstash", ["web3"]]]);
    expect(planRetag([{ ...row, source: "board:dou-python" }], niche)).toEqual([]);
  });
});

describe("planRetag — ніша компанії", () => {
  const crypto = new Map([["binance", ["web3"]]]);

  it("вакансія відомої крипто-компанії дістає нішу, хоч джерело мовчить", () => {
    // Живий випадок 02.09: «Binance Accelerator Program — QA (Content)»
    // приїхала колекцією Getro без тегів і лежала в кеші як marketing.
    const plan = planRetag([row({
      company: "Binance", company_key: "binance", source: "getro:1513",
      title: "Binance Accelerator Program - QA (Content)", tags: '["marketing"]',
    })], new Map(), crypto);
    expect(plan[0]!.added).toEqual(["web3"]);
  });

  it("чужа компанія нішу не дістає", () => {
    expect(planRetag([row({ company_key: "acme", tags: '["design","product","senior"]' })],
      new Map(), crypto)).toEqual([]);
  });

  it("сфери від компанії не беремо: у Binance є і бекендери, і юристи", () => {
    const plan = planRetag([row({
      company_key: "binance", title: "Legal Counsel", tags: '["finance-legal"]',
    })], new Map(), new Map([["binance", ["web3", "engineering"]]]));
    expect(plan[0]!.added).toEqual(["web3"]);
  });
});
