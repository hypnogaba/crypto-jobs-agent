import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyOverlay, BOARD_CHANGES, COMPANY_FIXES, CRYPTO_EMPLOYERS, GETRO_DISCOVERY, overlaySql,
} from "./crypto-sources.js";
import { keepInHybrid } from "./scan-core.js";
import { ATS } from "./sources/ats.js";

describe("міграція 0047 = crypto-sources.ts", () => {
  it("файл міграції дослівно той, що генерує код (правити .ts, потім згенерувати)", () => {
    const file = readFileSync(new URL("../../db/migrations/0047_ncj_crypto_sources.sql", import.meta.url), "utf8");
    expect(file).toBe(overlaySql());
  });
});

describe("список роботодавців", () => {
  it("без повторів слагу", () => {
    const slugs = CRYPTO_EMPLOYERS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it("кожен на провайдері, якого сканер уміє читати, і з причиною", () => {
    for (const e of CRYPTO_EMPLOYERS) {
      expect(ATS[e.provider], e.slug).toBeTypeOf("function");
      expect(e.note.length, e.slug).toBeGreaterThan(10);
      expect(e.slug, e.slug).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    }
  });
  it("усі з тегом web3: саме за ним NextCryptoJob їх бачить", () => {
    for (const e of CRYPTO_EMPLOYERS) expect(e.tags ?? ["web3"], e.slug).toContain("web3");
  });
  it("виправлення не суперечать додаванням: вилучений слаг не додається знову", () => {
    const dropped = new Set(COMPANY_FIXES.filter((f) => f.drop).map((f) => f.slug));
    for (const e of CRYPTO_EMPLOYERS) expect(dropped.has(e.slug), e.slug).toBe(false);
  });
  it("кожна зміна дошки й колекції має причину", () => {
    for (const b of BOARD_CHANGES) expect(b.note.length, b.name).toBeGreaterThan(10);
    for (const g of GETRO_DISCOVERY) expect(g.note.length, String(g.id)).toBeGreaterThan(10);
  });
});

describe("applyOverlay — те саме, що зробить міграція", () => {
  const base = () => ({
    companies: [
      { slug: "coinbase", name: "Coinbase", ats_provider: "greenhouse", ats_slug: "coinbase", tags: '["fintech"]' },
      { slug: "notion", name: "Notion", ats_provider: "ashby", ats_slug: "notion", tags: '["web3"]' },
    ],
    boards: [{ name: "board:global-cryptocareers", enabled: 1 }],
    getro: [],
    states: [], urls: [],
  });

  it("додає тег, не стираючи наявних", () => {
    const fix = COMPANY_FIXES.find((f) => f.slug === "coinbase");
    if (!fix) return;
    const t = applyOverlay(base());
    const tags = JSON.parse(String(t.companies.find((c) => c.slug === "coinbase")!.tags));
    expect(tags).toEqual(expect.arrayContaining(["fintech", "web3"]));
  });

  it("знімає web3 з не-крипто компанії", () => {
    const fix = COMPANY_FIXES.find((f) => f.slug === "notion");
    if (!fix) return;
    const t = applyOverlay(base());
    expect(JSON.parse(String(t.companies.find((c) => c.slug === "notion")!.tags))).not.toContain("web3");
  });

  it("вимикає дошку", () => {
    const ch = BOARD_CHANGES.find((b) => b.name === "board:global-cryptocareers");
    if (!ch) return;
    expect(applyOverlay(base()).boards[0]!.enabled).toBe(ch.enabled);
  });
});

describe("GETRO_MODE=hybrid", () => {
  const j = (url: string) => ({ url, company: "A", title: "B", location: null, remote: false, postedAt: null, source: "getro:1" });
  it("вакансія з публічним ATS іде через ATS, а не через Getro", () => {
    expect(keepInHybrid(j("https://jobs.ashbyhq.com/acme/1"))).toBe(false);
  });
  it("вакансія без публічного ATS лишається з Getro", () => {
    expect(keepInHybrid(j("https://valr.careers.hibob.com/jobs/1"))).toBe(true);
  });
});

describe("міграція 0047 на справжньому SQLite (D1 це SQLite)", () => {
  it("виконується й робить те, що обіцяє, на схемі з міграцій", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = new URL("../../db/migrations/", import.meta.url);
    const db = new DatabaseSync(":memory:");
    // Схема рівно з файлів міграцій: 0001 (companies, schema_migrations),
    // 0010 (country_boards), getro_collections і їхні ALTER з колонкою tags.
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(dir).filter((f) => /^00\d\d_.*\.sql$/.test(f) && f < "0047").sort();
    const want = /CREATE TABLE IF NOT EXISTS (companies|country_boards|getro_collections|schema_migrations)\b[\s\S]*?\);|ALTER TABLE (getro_collections|country_boards) ADD COLUMN [^;]+;/g;
    for (const f of files) {
      for (const m of readFileSync(new URL(f, dir), "utf8").matchAll(want)) db.exec(m[0]);
    }
    db.exec(`INSERT INTO companies (slug,name,ats_provider,ats_slug,tags) VALUES
      ('coinbase','Coinbase','greenhouse','coinbase','["fintech"]'),
      ('notion','Notion','ashby','notion','["web3"]'),
      ('kraken','Kraken','ashby','kraken','["web3"]'),
      ('tether','Tether Old','recruitee','tether','["fintech"]')`);
    db.exec(`INSERT INTO country_boards (id,country,name,label,feed_url,kind) VALUES
      ('b1','*','board:global-cryptocareers','Crypto Careers','https://crypto-careers.com/jobs','nextdata')`);
    db.exec(`INSERT INTO getro_collections (id,collection_id,label,enabled) VALUES ('getro-13362',13362,'x',0)`);

    db.exec(readFileSync(new URL("0047_ncj_crypto_sources.sql", dir), "utf8"));

    const tags = (slug: string) => JSON.parse(String((db.prepare("SELECT tags FROM companies WHERE slug=?").get(slug) as { tags: string }).tags));
    expect(tags("coinbase")).toEqual(expect.arrayContaining(["fintech", "web3"]));
    expect(tags("notion")).not.toContain("web3");
    expect(db.prepare("SELECT 1 FROM companies WHERE slug='kraken'").get()).toBeUndefined();
    expect(db.prepare("SELECT ats_provider, ats_slug FROM companies WHERE slug='kraken.com'").get())
      .toMatchObject({ ats_provider: "ashby", ats_slug: "kraken.com" });
    // Наявний рядок не втрачає своїх тегів, лише отримує web3.
    expect(tags("tether")).toEqual(expect.arrayContaining(["fintech", "web3"]));
    expect(db.prepare("SELECT ats_slug FROM companies WHERE slug='sui-foundation'").get())
      .toMatchObject({ ats_slug: "Sui%20Foundation" });
    expect(db.prepare("SELECT enabled FROM country_boards WHERE name='board:global-cryptocareers'").get())
      .toMatchObject({ enabled: 0 });
    expect(db.prepare("SELECT enabled, tags FROM getro_collections WHERE collection_id=13362").get())
      .toMatchObject({ enabled: 1, tags: '["web3"]' });
    expect(db.prepare("SELECT COUNT(*) n FROM getro_collections").get()).toMatchObject({ n: GETRO_DISCOVERY.length });
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE name='0047_ncj_crypto_sources.sql'").get()).toBeTruthy();

    // Повторний прогін нічого не ламає: міграцію можуть накотити двічі.
    db.exec(readFileSync(new URL("0047_ncj_crypto_sources.sql", dir), "utf8"));
    expect(tags("coinbase").filter((t: string) => t === "web3")).toHaveLength(1);
  });
});
