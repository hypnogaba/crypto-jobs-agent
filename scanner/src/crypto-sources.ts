/**
 * Крипто-джерела, додані й виправлені 13.09.2026 для NextCryptoJob.
 *
 * Кеш вакансій спільний: NextRole і NextCryptoJob читають ту саму таблицю
 * `jobs_cache`, і NextCryptoJob бере з неї лише рядки з тегом `web3`. Тому
 * все тут має тег `web3`, а на не-крипто поведінку NextRole ніщо не впливає.
 *
 * Цей файл одночасно:
 *   - джерело правди для міграції 0047 (`overlaySql()`; тест звіряє файл
 *     міграції з цим виводом, тож вони не розійдуться);
 *   - накладка на знімок таблиць для скану насухо (`applyOverlay`), щоб
 *     оцінка «що дасть міграція» рахувалась тим самим кодом.
 *
 * Кожен роботодавець перевірений живим запитом до публічного API його ATS
 * (Greenhouse Job Board API, Lever Postings API, Ashby Posting API тощо): ці
 * API існують саме для того, щоб вакансії читали й показували. Рішення про
 * кожне джерело з посиланнями записані в docs/reference/job-sources-catalogue.md.
 */
import type { AtsProvider } from "./types.js";

export interface CryptoEmployer {
  name: string;
  provider: AtsProvider;
  /** Слаг ATS; він же `companies.slug`, як у збору посилань із Getro. */
  slug: string;
  tags?: string[];
  /** Звідки відомо, що це саме та компанія. */
  note: string;
}

export interface CompanyFix {
  slug: string;
  /** Вилучити рядок: мертва адреса, яку замінює правильна під іншим слагом. */
  drop?: boolean;
  addTags?: string[];
  removeTags?: string[];
  note: string;
}

export interface BoardChange { name: string; enabled: 0 | 1; note: string }

export interface GetroDiscovery { id: number; label: string; url: string; note: string }

/** Роботодавці з публічним ATS. Заповнено перевіркою 13.09.2026. */
export const CRYPTO_EMPLOYERS: CryptoEmployer[] = [];

/** Виправлення наявних рядків `companies`. */
export const COMPANY_FIXES: CompanyFix[] = [];

/** Дошки, які вимикаємо або вмикаємо, з причиною. */
export const BOARD_CHANGES: BoardChange[] = [];

/**
 * Колекції Getro, з яких щотижнева розвідка забирає посилання на ATS
 * роботодавців. Щоденний скан їх не читає (GETRO_MODE=discover).
 */
export const GETRO_DISCOVERY: GetroDiscovery[] = [];

// ── накладка на знімок для скану насухо ──────────────────────

type Row = Record<string, unknown>;

const tagsOf = (raw: unknown): string[] => {
  try { const v = JSON.parse(String(raw ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

export function applyOverlay<T extends { companies: Row[]; boards: Row[]; getro: Row[] }>(t: T): T {
  const companies = new Map(t.companies.map((r) => [String(r.slug), { ...r }]));
  for (const f of COMPANY_FIXES) {
    const r = companies.get(f.slug);
    if (!r) continue;
    if (f.drop) { companies.delete(f.slug); continue; }
    const tags = tagsOf(r.tags).filter((x) => !(f.removeTags ?? []).includes(x));
    for (const x of f.addTags ?? []) if (!tags.includes(x)) tags.push(x);
    r.tags = JSON.stringify(tags);
  }
  for (const e of CRYPTO_EMPLOYERS) {
    const prior = companies.get(e.slug);
    const tags = tagsOf(prior?.tags);
    for (const x of e.tags ?? ["web3"]) if (!tags.includes(x)) tags.push(x);
    companies.set(e.slug, {
      ...(prior ?? { discovered_via: "curated", dry_scans: 0, last_fit_at: null }),
      slug: e.slug, name: e.name, ats_provider: e.provider, ats_slug: e.slug, tags: JSON.stringify(tags),
    });
  }
  const boards = t.boards.map((r) => {
    const ch = BOARD_CHANGES.find((b) => b.name === r.name);
    return ch ? { ...r, enabled: ch.enabled } : r;
  });
  const getro = [...t.getro];
  for (const g of GETRO_DISCOVERY) {
    const i = getro.findIndex((r) => Number(r.collection_id) === g.id);
    const row = { id: `getro-${g.id}`, collection_id: g.id, label: g.label, url: g.url, enabled: 1, tags: '["web3"]' };
    if (i >= 0) getro[i] = { ...getro[i], enabled: 1, tags: '["web3"]' }; else getro.push(row);
  }
  return { ...t, companies: [...companies.values()], boards, getro };
}

// ── SQL міграції ──────────────────────────────────────────────

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * Доповнити JSON-масив тегів без повторів, у SQLite. Порядок наявних
 * зберігається: `json_each` віддає їх за ключем, нові стають у хвіст.
 */
const unionSql = (col: string, add: string[]): string => {
  const extra = add.map((t) => `SELECT ${q(t)}`).join(" UNION ALL ");
  return `(SELECT json_group_array(value) FROM (SELECT value FROM json_each(${col}) UNION SELECT * FROM (${extra}) WHERE 1))`;
};

export function overlaySql(): string {
  const out: string[] = [];
  out.push(`-- Крипто-джерела для NextCryptoJob (13.09.2026).
--
-- ЗГЕНЕРОВАНО з scanner/src/crypto-sources.ts командою
--   cd scanner && npm run build && node dist/crypto-sources.js > ../db/migrations/0047_ncj_crypto_sources.sql
-- Правити треба той файл, а не цей: тест crypto-sources.test.ts звіряє їх.
--
-- Що робить: додає крипто-роботодавців із публічним ATS (тег web3),
-- виправляє хибні й мертві рядки компаній, знімає тег web3 з компаній, які
-- не крипто, вимикає мертві дошки й додає колекції Getro для щотижневого
-- збору посилань на ATS. Причини кожного рядка: у тому ж .ts і в
-- docs/reference/job-sources-catalogue.md.
`);
  for (const f of COMPANY_FIXES) {
    out.push(`-- ${f.slug}: ${f.note}`);
    if (f.drop) { out.push(`DELETE FROM companies WHERE slug = ${q(f.slug)};`); continue; }
    if (f.removeTags?.length) {
      out.push(`UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN (${f.removeTags.map(q).join(",")})) WHERE slug = ${q(f.slug)};`);
    }
    if (f.addTags?.length) {
      out.push(`UPDATE companies SET tags = ${unionSql("companies.tags", f.addTags)} WHERE slug = ${q(f.slug)};`);
    }
  }
  for (const e of CRYPTO_EMPLOYERS) {
    const tags = e.tags ?? ["web3"];
    out.push(`-- ${e.name}: ${e.note}`);
    out.push(`INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES (${q(e.slug)},${q(e.name)},${q(e.provider)},${q(e.slug)},${q(JSON.stringify(tags))},'curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=${unionSql("companies.tags", tags)};`);
  }
  for (const b of BOARD_CHANGES) {
    out.push(`-- ${b.name}: ${b.note}`);
    out.push(`UPDATE country_boards SET enabled = ${b.enabled} WHERE name = ${q(b.name)};`);
  }
  for (const g of GETRO_DISCOVERY) {
    out.push(`-- getro:${g.id} ${g.label}: ${g.note}`);
    out.push(`INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES (${q(`getro-${g.id}`)}, ${g.id}, ${q(g.label)}, ${q(g.url)}, 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';`);
  }
  out.push(`INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0047_ncj_crypto_sources.sql');`);
  return out.join("\n") + "\n";
}

if (process.argv[1]?.endsWith("crypto-sources.js")) process.stdout.write(overlaySql());
