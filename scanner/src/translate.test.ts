import { describe, expect, it, vi } from "vitest";
import { applyTranslations, translateJobs, TRANSLATE_MODEL, type I18nStore, type Translation } from "./translate.js";

const memStore = (seed: Array<[string, Translation]> = []) => {
  const m = new Map<string, Translation>(seed);
  const store: I18nStore = {
    get: async (ids) => new Map(ids.filter((id) => m.has(id)).map((id) => [id, m.get(id)!])),
    put: async (rows) => { for (const r of rows) m.set(r.id, { title: r.title, summary: r.summary }); },
  };
  return { store, m };
};

const jobs = [
  { id: "j1", title: "Senior Backend Engineer", summary: "You will own the trade lifecycle." },
  { id: "j2", title: "Product Designer", summary: null },
];

const reply = (items: unknown) => new Response(JSON.stringify({
  content: [{ type: "text", text: JSON.stringify({ items }) }],
  usage: { input_tokens: 120, output_tokens: 60 },
}), { status: 200 });

describe("translateJobs", () => {
  it("без ключа або для англійської — жодного запиту й порожня мапа", async () => {
    const f = vi.fn();
    expect(await translateJobs(jobs, "uk", null, memStore().store, { fetchImpl: f })).toEqual(new Map());
    expect(await translateJobs(jobs, "en", "key", memStore().store, { fetchImpl: f })).toEqual(new Map());
    expect(f).not.toHaveBeenCalled();
  });

  it("один запит на всю добірку, JSON туди і назад, результат у кеші", async () => {
    const f = vi.fn().mockResolvedValue(reply([
      { id: "j1", title: "Старший бекенд-інженер", summary: "Ти вестимеш життєвий цикл угоди." },
      { id: "j2", title: "Продуктовий дизайнер", summary: null },
    ]));
    const usage: unknown[] = [];
    const { store, m } = memStore();
    const tr = await translateJobs(jobs, "uk", "key", store, { fetchImpl: f, onUsage: (u) => { usage.push(u); } });
    expect(f).toHaveBeenCalledTimes(1);
    const req = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as { model: string; messages: Array<{ content: string }> };
    expect(req.model).toBe(TRANSLATE_MODEL);
    expect(req.messages[0]!.content).toContain('"id":"j1"');
    expect(req.messages[0]!.content).toContain("Ukrainian");
    expect(tr.get("j1")).toEqual({ title: "Старший бекенд-інженер", summary: "Ти вестимеш життєвий цикл угоди." });
    expect(tr.get("j2")).toEqual({ title: "Продуктовий дизайнер", summary: null });
    expect(m.size).toBe(2);
    expect(usage).toEqual([{ model: TRANSLATE_MODEL, inputTokens: 120, outputTokens: 60, ok: true }]);
  });

  it("з кешу — без запиту; бракує одного — питає лише про нього", async () => {
    const f = vi.fn().mockResolvedValue(reply([{ id: "j2", title: "Дизайнер", summary: null }]));
    const { store } = memStore([["j1", { title: "Кешований", summary: "Кеш." }]]);
    const tr = await translateJobs(jobs, "uk", "key", store, { fetchImpl: f });
    const req = JSON.parse((f.mock.calls[0]![1] as { body: string }).body) as { messages: Array<{ content: string }> };
    expect(req.messages[0]!.content).not.toContain('"id":"j1"');
    expect(tr.get("j1")!.title).toBe("Кешований");
    expect(tr.get("j2")!.title).toBe("Дизайнер");
  });

  it("збій мережі, не-JSON, HTTP 500, загублений опис — оригінал", async () => {
    const { store, m } = memStore();
    expect(await translateJobs(jobs, "fr", "key", store, { fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) })).toEqual(new Map());
    expect(await translateJobs(jobs, "fr", "key", store, { fetchImpl: vi.fn().mockResolvedValue(new Response("oops", { status: 500 })) })).toEqual(new Map());
    expect(await translateJobs(jobs, "fr", "key", store, { fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "not json" }] }), { status: 200 })) })).toEqual(new Map());
    // j1 мав опис, переклад його загубив — j1 лишається оригіналом, j2 береться.
    const partial = await translateJobs(jobs, "fr", "key", store, { fetchImpl: vi.fn().mockResolvedValue(reply([
      { id: "j1", title: "Ingénieur", summary: null }, { id: "j2", title: "Designer produit", summary: null }])) });
    expect(partial.has("j1")).toBe(false);
    expect(partial.get("j2")!.title).toBe("Designer produit");
    expect(m.has("j1")).toBe(false);
  });
});

describe("applyTranslations", () => {
  it("підставляє назву й опис, компанію не чіпає", () => {
    const cards = [{ id: "j1", company: "Acme", title: "Engineer", summary: "Own it." }];
    const out = applyTranslations(cards, new Map([["j1", { title: "Інженер", summary: "Володій цим." }]]));
    expect(out[0]).toEqual({ id: "j1", company: "Acme", title: "Інженер", summary: "Володій цим." });
    expect(applyTranslations(cards, new Map())[0]).toEqual(cards[0]);
  });
});
