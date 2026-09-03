import { describe, expect, it, vi } from "vitest";
import { cachedRoleLines, d1Store, saveRoleLines, type RoleLineStore } from "./roleline.js";

const memStore = () => {
  const rows = new Map<string, string>();
  const store: RoleLineStore = {
    get: async (ids, locale) =>
      new Map(ids.map((id) => [id, rows.get(`${id}:${locale}`)!]).filter(([, v]) => Boolean(v)) as Array<[string, string]>),
    put: async (fresh) => { for (const r of fresh) rows.set(`${r.id}:${r.locale}`, r.role); },
  };
  return { store, rows };
};

describe("кеш рядка про роль", () => {
  it("покладене однією добіркою читається наступною", async () => {
    const { store } = memStore();
    await saveRoleLines([{ id: "j1", title: "Engineer", role: "Будувати платформу." }], "uk", store);
    expect(await cachedRoleLines(["j1"], "uk", store)).toEqual(new Map([["j1", "Будувати платформу."]]));
    // Інша мова — інший рядок, а не той самий.
    expect(await cachedRoleLines(["j1"], "fr", store)).toEqual(new Map());
  });

  it("порожній рядок у кеш не потрапляє", async () => {
    const { rows } = memStore();
    const { store } = memStore();
    await saveRoleLines([{ id: "j1", title: "T", role: null }], "uk", store);
    expect(await cachedRoleLines(["j1"], "uk", store)).toEqual(new Map());
    expect(rows.size).toBe(0);
  });

  /** Кеш не важливіший за доставку: впав — картка йде без рядка про роль. */
  it("збій сховища не кидає далі", async () => {
    const broken: RoleLineStore = {
      get: async () => { throw new Error("d1 down"); },
      put: async () => { throw new Error("d1 down"); },
    };
    expect(await cachedRoleLines(["j1"], "uk", broken)).toEqual(new Map());
    await expect(saveRoleLines([{ id: "j1", title: "T", role: "r" }], "uk", broken)).resolves.toBeUndefined();
  });

  it("порожній список — жодного запиту в базу", async () => {
    const d1 = { query: vi.fn(), batch: vi.fn() };
    const store = d1Store(d1);
    expect(await store.get([], "uk")).toEqual(new Map());
    await store.put([]);
    expect(d1.query).not.toHaveBeenCalled();
    expect(d1.batch).not.toHaveBeenCalled();
  });

  it("пише в job_i18n мовою й читає лише непорожні", async () => {
    const d1 = {
      query: vi.fn().mockResolvedValue([{ job_id: "j1", summary: "Будувати платформу." }, { job_id: "j2", summary: null }]),
      batch: vi.fn().mockResolvedValue(undefined),
    };
    const store = d1Store(d1);
    expect(await store.get(["j1", "j2"], "uk")).toEqual(new Map([["j1", "Будувати платформу."]]));
    await store.put([{ id: "j1", locale: "uk", title: "Engineer", role: "Будувати платформу." }]);
    expect(d1.batch.mock.calls[0]![0][0].params).toEqual(["j1", "uk", "Engineer", "Будувати платформу."]);
  });
});
