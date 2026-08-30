# Чистка кеша вакансій + міський/глобальний баланс — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) База перестає рости вічно: вакансії старші за 30 діб видаляються — але тільки ті, яких ніхто ніколи не бачив, тому історія кабінету й правило «не слати двічі» лишаються цілими. (2) Людина, що назвала місто й готова на офіс, отримує приблизно половину добірки з рідного міста, а не саму лише віддалену роботу.

**Architecture:** Три незалежні шматки, з них два в сканері й один у базі. (1) Міграція `0019`: індекс `sent(job_id)` — без нього перевірка «чи слали цю вакансію» на кожен рядок кеша це повний скан `sent`. (2) `scanner/src/prune.ts` + чиста логіка в `prune-rules.ts`: видаляє з `jobs_cache` рядки, старші за `RETENTION_DAYS`, які **не згадані в `sent`**, і прибирає осиротілі переклади з `job_i18n` (там FK немає взагалі, тому вони не зникають самі). Каскад `ON DELETE CASCADE` лишається на місці — ми його не чіпаємо, ми просто ніколи не видаляємо рядок, до якого він прив'язаний. Це вдвічі менше роботи, ніж перебудова таблиці, і не має жодного шансу знести історію. (3) Квота міста в `match.ts pickTop` + пропуск місцевих вакансій у вікно кандидатів у `digest.ts`.

**Tech Stack:** Node + TypeScript сканер під systemd (`scanner/`), Cloudflare D1 через REST (`scanner/src/d1.ts`), vitest. Тести: `cd scanner && npm test`. Тайпчек: `cd scanner && npx tsc --noEmit`. Деплой сканера: `rsync dist/` на `tradebot-vps` у `/opt/nextrole-scanner` (git на VPS немає). Коміти від `hypnogaba <hypnogaba@gmail.com>`, без `Co-Authored-By`.

---

## Поточний стан, який план змінює (перевірено 2026-08-30)

- `db/migrations/0001_schema.sql:99` — `sent.job_id TEXT NOT NULL REFERENCES jobs_cache(id) ON DELETE CASCADE`. **Це головна пастка:** наївне `DELETE FROM jobs_cache WHERE fetched_at < ...` тихо знесе рядки `sent`.
- `scanner/src/digest.ts:800` — коментар «Кеш нічого не видаляє (це зламало б каскад `sent.job_id` і дозволило б повторно надіслати вакансію)». Відмова від чистки була свідомою; план знімає саме цю причину, і коментар треба переписати, а не лишити брехати.
- Ніде в `scanner/src` і `web/src` немає жодного `DELETE FROM jobs_cache`. Кеш росте монотонно з першого дня.
- `db/migrations/0013_job_i18n.sql` — `job_i18n.job_id` **без FK**. Каскад його не прибере навіть тоді, коли вакансію видалено; це окремий, самостійний витік.
- `scanner/src/digest.ts:807` — у добірку йде лише `fetched_at >= datetime('now','-3 day')`. Тобто 27 із 30 діб зберігання ніхто не читає; видалення на 30-й день не забирає в добірки нічого.
- `web/src/app/(seo)/_pages/home.tsx:64` — публічна цифра на головній це `SELECT COUNT(*) FROM jobs_cache`, тобто **весь кеш разом із мертвими**. Після чистки число впаде. Це не регресія, це виправлення: зараз сайт обіцяє більше, ніж має.
- `scanner/src/match.ts:224-230` — місто дає `+3` і не більше. Квоти немає. Віддалена вакансія набирає свій бонус раніше, тож у людини з Києва київські офісні позиції системно програють і в добірку майже не потрапляють.
- `scanner/src/digest.ts:803-812` — вікно кандидатів `LIMIT 1200`, порядок `on_topic DESC, posted_at DESC`. Місцева вакансія без збігу за темою може не дійти навіть до оцінювання — рівно та сама пастка, що описана в коментарі №6 про вузькі сфери.
- `scanner/src/repo.ts:67` — `id` вакансії це `crypto.randomUUID()` на вставці, а `ON CONFLICT(url)` його зберігає. Отже після видалення той самий URL отримає **новий** `id`, і захист за `job_id` про нього нічого не знатиме. Виживає тільки `dedupe_key` у `sent` — ще одна причина ніколи не видаляти рядок, що вже комусь відправлений.

## Що вже є і будувати НЕ треба

**Правило «не слати ту саму вакансію двічі» існує й працює.** Не переписувати:

| Рівень | Де | Що робить |
|---|---|---|
| За рядком | `digest.ts:804` | `j.id NOT IN (SELECT job_id FROM sent WHERE user_id = ?)` |
| За змістом | `digest.ts:805-806` | `j.dedupe_key NOT IN (SELECT dedupe_key FROM sent WHERE user_id = ? AND dedupe_key IS NOT NULL)` |
| У базі | `0001_schema.sql:106` | `UNIQUE(user_id, job_id)` на `sent` |
| Історія | `0005_sent_dedupe_key.sql` | `dedupe_key` денормалізований у `sent` і дозаповнений для старих рядків |

Єдине завдання цього плану щодо цього правила — **не зламати його чисткою**.

---

## Файли

| Файл | Дія | Відповідальність |
|---|---|---|
| `db/migrations/0019_sent_job_index.sql` | створити | індекс `sent(job_id)` для перевірки «чи слали» |
| `scanner/src/prune-rules.ts` | створити | чисті SQL-будівники й межа дати, без мережі |
| `scanner/src/prune-rules.test.ts` | створити | |
| `scanner/src/prune.ts` | створити | точка входу: рахує, видаляє пакетами, звітує |
| `scanner/src/config.ts` | змінити | `retentionDays`, `pruneBatch` |
| `scanner/src/digest.ts` | змінити | коментар №4 (кеш тепер чиститься) + `is_local` у вікні |
| `scanner/src/match.ts` | змінити | `isLocal`, `wantsLocalMix`, коло квоти в `pickTop` |
| `scanner/src/match.test.ts` | змінити | тести квоти |
| `scanner/deploy/nextrole-prune.service` | створити | systemd-юніт |
| `scanner/deploy/nextrole-prune.timer` | створити | Нд 04:00 |
| `scanner/deploy/README.md` | змінити | новий таймер у списку |
| `web/src/app/(app)/admin/page.tsx` | змінити | плитка «видалено минулого разу» |

---

### Task 1: Індекс під перевірку «чи слали цю вакансію»

Без нього кожен прогін чистки робить повний скан `sent` для кожного рядка-кандидата. `sent` має `UNIQUE(user_id, job_id)`, але цей індекс починається з `user_id`, тому пошук лише за `job_id` ним не користується.

**Files:**
- Create: `db/migrations/0019_sent_job_index.sql`

- [ ] **Step 1: Міграція**

```sql
-- db/migrations/0019_sent_job_index.sql
-- Чистка кеша питає про КОЖЕН старий рядок: «чи слали його комусь?».
-- UNIQUE(user_id, job_id) на це не працює — складений індекс шукається
-- зліва направо, а user_id ми тут не знаємо. Без власного індексу прогін
-- чистки це повний скан sent на кожного кандидата.
CREATE INDEX IF NOT EXISTS idx_sent_job ON sent(job_id);
```

- [ ] **Step 2: Застосувати до D1**

Run: `npx wrangler d1 execute crypto-jobs-agent --remote --file db/migrations/0019_sent_job_index.sql`
Expected: `Executed 1 command`

---

### Task 2: Чиста логіка чистки

Уся небезпечна частина — це умова відбору. Її і тестуємо окремо від мережі.

**Files:**
- Create: `scanner/src/prune-rules.ts`
- Create: `scanner/src/prune-rules.test.ts`

- [ ] **Step 1: Тест**

```ts
// scanner/src/prune-rules.test.ts
import { describe, it, expect } from "vitest";
import { countStaleSql, deleteStaleSql, countOrphanI18nSql, deleteOrphanI18nSql, cutoff } from "./prune-rules";

describe("правила чистки", () => {
  it("межа рахується назад у добах", () => {
    expect(cutoff(30)).toBe("-30 day");
    expect(cutoff(1)).toBe("-1 day");
  });

  it("НІКОЛИ не чіпає вакансію, яку комусь надсилали", () => {
    // Найважливіший тест у файлі. Каскад sent.job_id знесе історію
    // кабінету й захист від повтору, якщо ця умова колись зникне.
    for (const sql of [countStaleSql(), deleteStaleSql()]) {
      expect(sql).toContain("NOT EXISTS");
      expect(sql).toContain("FROM sent");
    }
  });

  it("видаляє пакетом, а не всім кешем за один запит", () => {
    // D1 по HTTP не витримує видалення десятків тисяч рядків одним викликом.
    expect(deleteStaleSql()).toContain("LIMIT");
  });

  it("осиротілі переклади прибираються окремо — у job_i18n немає FK", () => {
    expect(deleteOrphanI18nSql()).toContain("job_i18n");
    expect(deleteOrphanI18nSql()).toContain("NOT EXISTS");
    expect(countOrphanI18nSql()).toContain("COUNT(*)");
  });
});
```

- [ ] **Step 2: Запустити — має впасти**

Run: `cd scanner && npx vitest run src/prune-rules.test.ts`
Expected: FAIL — `Cannot find module './prune-rules'`

- [ ] **Step 3: Реалізація**

```ts
// scanner/src/prune-rules.ts
/**
 * Що саме дозволено видалити з кеша.
 *
 * Одне правило важливіше за всі інші: рядок, який хоч комусь надсилали,
 * не видаляється НІКОЛИ. sent.job_id стоїть під ON DELETE CASCADE, тож
 * видалення такої вакансії тихо знесло б історію кабінету і зняло б захист
 * «не слати двічі» — а id при повторній вставці генерується заново
 * (repo.ts: crypto.randomUUID()), тому відновити зв'язок було б нічим.
 *
 * Ми не прибираємо каскад і не перебудовуємо таблицю. Ми просто не даємо
 * йому спрацювати.
 */

/** Модифікатор для datetime('now', ?). Окремо, щоб було що тестувати. */
export function cutoff(days: number): string {
  return `-${days} day`;
}

/**
 * Умова «мертвий і нічий». fetched_at оновлюється на кожному скані для
 * кожної живої вакансії (repo.ts upsert), тому старий fetched_at означає
 * саме «дошка більше його не віддає», а не «давно опубліковано».
 */
const STALE_AND_UNSENT = `
  fetched_at < datetime('now', ?)
  AND NOT EXISTS (SELECT 1 FROM sent s WHERE s.job_id = jobs_cache.id)`;

export function countStaleSql(): string {
  return `SELECT COUNT(*) AS n FROM jobs_cache WHERE ${STALE_AND_UNSENT}`;
}

/**
 * Пакетне видалення. DELETE ... LIMIT у SQLite доступний лише зі спеціальним
 * прапором збірки, тому обмежуємо підзапитом — це працює скрізь.
 */
export function deleteStaleSql(): string {
  return `DELETE FROM jobs_cache WHERE id IN (
            SELECT id FROM jobs_cache WHERE ${STALE_AND_UNSENT} LIMIT ?)`;
}

/**
 * job_i18n створена без FOREIGN KEY, тому каскад її не прибирає взагалі —
 * ні зараз, ні після чистки. Переклади мертвих вакансій лишились би в базі
 * назавжди, і це другий витік, окремий від самого кеша.
 */
const ORPHAN_I18N = `
  NOT EXISTS (SELECT 1 FROM jobs_cache j WHERE j.id = job_i18n.job_id)`;

export function countOrphanI18nSql(): string {
  return `SELECT COUNT(*) AS n FROM job_i18n WHERE ${ORPHAN_I18N}`;
}

export function deleteOrphanI18nSql(): string {
  return `DELETE FROM job_i18n WHERE job_id IN (
            SELECT job_id FROM job_i18n WHERE ${ORPHAN_I18N} LIMIT ?)`;
}
```

- [ ] **Step 4: Тест зелений**

Run: `cd scanner && npx vitest run src/prune-rules.test.ts`
Expected: 4 passed

---

### Task 3: Точка входу `prune.ts`

**Files:**
- Modify: `scanner/src/config.ts`
- Create: `scanner/src/prune.ts`

- [ ] **Step 1: Конфіг**

У `Config` додати `retentionDays: number; pruneBatch: number;`, у `loadConfig()`:

```ts
    // 30 діб. Добірка читає лише 3 (digest.ts), тож усе понад це — запас
    // на ручні розбори й на випадок, якщо вікно колись розширимо.
    retentionDays: num("RETENTION_DAYS", 30),
    pruneBatch: num("PRUNE_BATCH", 500),
```

- [ ] **Step 2: Реалізація**

```ts
// scanner/src/prune.ts
/**
 * Чистка кеша. Запускається окремим таймером, не в складі скану:
 * скан пише, чистка видаляє, і змішувати їх в одному прогоні означає
 * ділити з ними ліміт записів D1 у найгірший момент дня.
 *
 * PRUNE_DRY_RUN=1 — тільки порахувати й вийти. Перший прогін проти живої
 * бази робити саме так.
 */
import { loadConfig } from "./config.js";
import { D1Client } from "./d1.js";
import { countStaleSql, deleteStaleSql, countOrphanI18nSql, deleteOrphanI18nSql, cutoff } from "./prune-rules.js";

async function count(d1: D1Client, sql: string, params: unknown[]): Promise<number> {
  return (await d1.query<{ n: number }>(sql, params))[0]?.n ?? 0;
}

/** Видаляє пакетами, поки є що. Стеля кроків — щоб не крутитись вічно. */
async function drain(
  d1: D1Client, sql: string, params: unknown[], batch: number, expected: number,
): Promise<number> {
  let done = 0;
  const maxRounds = Math.ceil(expected / batch) + 2;
  for (let i = 0; i < maxRounds && done < expected; i++) {
    await d1.execute(sql, [...params, batch]);
    done += batch;
  }
  return Math.min(done, expected);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const d1 = new D1Client({ accountId: cfg.cfAccountId, databaseId: cfg.cfDatabaseId, token: cfg.cfApiToken });
  const age = cutoff(cfg.retentionDays);

  const total = await count(d1, "SELECT COUNT(*) AS n FROM jobs_cache", []);
  const stale = await count(d1, countStaleSql(), [age]);
  const orphans = await count(d1, countOrphanI18nSql(), []);

  // Скільки старих рядків ми лишаємо саме тому, що їх комусь надсилали.
  const kept = await count(d1,
    `SELECT COUNT(*) AS n FROM jobs_cache
      WHERE fetched_at < datetime('now', ?)
        AND EXISTS (SELECT 1 FROM sent s WHERE s.job_id = jobs_cache.id)`, [age]);

  console.log(
    `Кеш: ${total} вакансій. Старших за ${cfg.retentionDays} діб і нікому не надісланих: ${stale}. ` +
    `Старих, але надісланих (лишаємо назавжди): ${kept}. Осиротілих перекладів: ${orphans}.`);

  if (process.env.PRUNE_DRY_RUN) {
    console.log("PRUNE_DRY_RUN — нічого не видалено.");
    return;
  }

  const deleted = stale ? await drain(d1, deleteStaleSql(), [age], cfg.pruneBatch, stale) : 0;
  // Переклади чистимо ПІСЛЯ вакансій: щойно видалені рядки теж стають сиротами.
  const orphansNow = await count(d1, countOrphanI18nSql(), []);
  const i18n = orphansNow ? await drain(d1, deleteOrphanI18nSql(), [], cfg.pruneBatch, orphansNow) : 0;

  const left = await count(d1, "SELECT COUNT(*) AS n FROM jobs_cache", []);
  console.log(`Видалено ${deleted} вакансій і ${i18n} перекладів. У кеші лишилось ${left}.`);
}

await main();
```

- [ ] **Step 3: Скрипт у `package.json`**

```json
    "prune": "node dist/prune.js",
```

- [ ] **Step 4: Тайпчек і тести**

Run: `cd scanner && npx tsc --noEmit && npm test`
Expected: 0 errors, усі тести зелені

---

### Task 4: systemd-таймер

Неділя 04:00. Скан не працює у вихідні, тому в неділю вранці база стоїть і чистка ні з чим не змагається за ліміт записів D1.

**Files:**
- Create: `scanner/deploy/nextrole-prune.service`
- Create: `scanner/deploy/nextrole-prune.timer`
- Modify: `scanner/deploy/README.md`

- [ ] **Step 1: Юніти**

```ini
# nextrole-prune.service
[Unit]
Description=NextRole — чистка кеша вакансій
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/nextrole-scanner
EnvironmentFile=/etc/nextrole-scanner.env
ExecStart=/usr/bin/node dist/prune.js
StandardOutput=journal
StandardError=journal
MemoryMax=512M
TimeoutStartSec=1800
```

```ini
# nextrole-prune.timer
[Unit]
Description=Щотижнева чистка кеша вакансій

[Timer]
# Неділя, коли скан не працює: чистка ні з ким не ділить ліміт записів D1.
OnCalendar=Sun *-*-* 04:00:00
Persistent=true
Unit=nextrole-prune.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Перший прогін — обов'язково вхолосту**

Run (на VPS): `cd /opt/nextrole-scanner && set -a && . /etc/nextrole-scanner.env && set +a && PRUNE_DRY_RUN=1 node dist/prune.js`
Expected: рядок із чотирма числами. **Звірити очима:** «старих, але надісланих» має бути помітно менше за «нікому не надісланих». Якщо навпаки — зупинитись і розібратись, це означало б, що умова відбору читає не те.

- [ ] **Step 3: Справжній прогін і ввімкнення таймера**

Run: `node dist/prune.js` → далі `systemctl enable --now nextrole-prune.timer`
Expected: `systemctl list-timers nextrole-prune.timer` показує наступну неділю

---

### Task 5: Половина добірки — рідному місту

Зараз місто дає `+3` і програє віддаленим вакансіям. Квота робить обіцянку явною: до половини місць віддаємо місцевим, **якщо такі взагалі є** — незаповнені місця повертаються загальному добору, а не лишаються порожніми.

**Files:**
- Modify: `scanner/src/match.ts:313-349`
- Modify: `scanner/src/match.test.ts`

- [ ] **Step 1: Тест**

```ts
// доповнення до scanner/src/match.test.ts
describe("міський баланс", () => {
  const kyivite = { /* профіль: spheres ["engineering"], location "Kyiv",
                      remoteMode "remote_or_city", country "UA" */ };

  it("віддає половину місць місцевим, коли їх вистачає", () => {
    // 10 віддалених із вищим балом + 5 київських
    const top = pickTop(mixed, kyivite, 5);
    expect(top.filter((j) => isLocal(j, kyivite)).length).toBe(2);
  });

  it("не тримає місця порожніми, коли місцевих нема", () => {
    const top = pickTop(remoteOnlyPool, kyivite, 5);
    expect(top).toHaveLength(5);
  });

  it("квота не діє для тих, хто сказав «тільки віддалено»", () => {
    // Місто в профілі є (звідти беремо країну й пояс), але офіс людині не потрібен.
    const strict = { ...kyivite, remoteMode: "remote_only" };
    expect(wantsLocalMix(strict)).toBe(false);
  });

  it("одна роль на компанію лишається сильнішою за квоту", () => {
    const top = pickTop(sameCompanyLocals, kyivite, 5);
    expect(new Set(top.map((j) => j.companyKey)).size).toBe(top.length);
  });
});
```

- [ ] **Step 2: Запустити — має впасти**

Run: `cd scanner && npx vitest run src/match.test.ts`
Expected: FAIL — `isLocal is not exported`

- [ ] **Step 3: Реалізація**

```ts
/**
 * «Своя» вакансія: місто людини в тексті локації або дошка її країни.
 *
 * Країну беремо теж, а не саме місто: національні дошки дають вакансії по
 * всій країні, і людині з Києва львівська позиція ближча за сан-франциську.
 */
export function isLocal(job: CandidateJob, p: Profile): boolean {
  if (p.location && job.location?.toLowerCase().includes(p.location.toLowerCase())) return true;
  return !!(job.country && p.country && job.country === p.country);
}

/**
 * Квота діє лише тоді, коли людина і назвала місто, І готова на офіс.
 * У профілі «тільки віддалено» місто теж заповнене — з нього виводиться
 * країна й часовий пояс, — але офісні вакансії там небажані за визначенням.
 */
export function wantsLocalMix(p: Profile): boolean {
  return !!p.location && !remoteOnly(p.remoteMode);
}
```

У `pickTop`, між колом сфер і колом за балом:

```ts
  // Коло півтора: половина місць — рідному місту.
  //
  // Без нього місто це лише +3, а віддалена робота набирає більше, тож
  // людина з Києва системно не бачила київських вакансій узагалі. Квота
  // МʼЯКА: беремо стільки місцевих, скільки є, і залишок віддаємо балу.
  // Коло сфер лишається першим — різноманітність сфер це сильніша
  // обіцянка, ніж географія, і саме її ми чинили минулого разу.
  if (wantsLocalMix(p)) {
    const target = Math.floor(limit / 2);
    for (const job of scored) {
      if (picked.length >= limit) break;
      if (picked.filter((j) => isLocal(j, p)).length >= target) break;
      if (picked.includes(job) || !isLocal(job, p)) continue;
      take(job);
    }
  }
```

- [ ] **Step 4: Тест зелений**

Run: `cd scanner && npx vitest run src/match.test.ts`
Expected: усі зелені

---

### Task 6: Пропустити місцеві вакансії у вікно кандидатів

Квота з Task 5 нічого не дасть, якщо місцева вакансія не дійшла до оцінювання. Вікно це `LIMIT 1200` з порядком `on_topic DESC, posted_at DESC` — місцева позиція без збігу за темою випадає рівно так само, як колись випадали вузькі сфери (коментар №6 у `digest.ts`).

**Files:**
- Modify: `scanner/src/digest.ts:790-812`

- [ ] **Step 1: Додати `is_local` у вибірку й порядок**

У `SELECT` поруч із `${topic.sql} AS on_topic`:

```sql
       CASE WHEN ? <> '' AND lower(j.location) LIKE '%' || lower(?) || '%' THEN 1
            WHEN j.country IS NOT NULL AND j.country = ? THEN 1
            ELSE 0 END AS is_local,
```

Порядок: `ORDER BY on_topic DESC, is_local DESC, posted_at DESC, fetched_at DESC`.

Тема лишається першою: місцева вакансія не з тієї сфери людині не потрібна.

- [ ] **Step 2: Параметри**

Було: `[...topic.params, u.id, u.id, u.country]`
Стало: `[...topic.params, u.location ?? "", u.location ?? "", u.country, u.id, u.id, u.country]`

`CASE` стоїть у списку `SELECT`, тобто **перед** `WHERE` — його параметри йдуть одразу за `topic.params`. Переплутати порядок тут означає тихо зламати відбір, а не отримати помилку.

- [ ] **Step 3: Переписати коментар №4**

Він зараз стверджує протилежне тому, що робить система:

```
    // 4. Тільки те, що ми бачили на дошці нещодавно. Мертві вакансії лежать
    //    у кеші до 30 діб (їх прибирає prune.ts), але у вікно не заходять:
    //    три доби — запас на випадок, якщо скан упав на день. Сама чистка
    //    ніколи не чіпає рядки, згадані в sent, тому каскад sent.job_id не
    //    спрацьовує і повторно надіслати вакансію неможливо.
```

- [ ] **Step 4: Тести й тайпчек**

Run: `cd scanner && npm test && npx tsc --noEmit`
Expected: зелено, 0 помилок

---

### Task 7: Видно в адмінці

**Files:**
- Modify: `web/src/app/(app)/admin/page.tsx:248`

- [ ] **Step 1: Плитка «мертвих у кеші»**

Поруч із `liveJobs` показати, скільки в кеші рядків старших за 30 діб. Якщо після ввімкнення таймера це число не падає в понеділок — чистка не працює, і це має бути видно без входу на VPS.

```sql
(SELECT COUNT(*) FROM jobs_cache WHERE fetched_at < datetime('now','-30 day')) staleJobs
```

- [ ] **Step 2: Деплой web**

Run: `cd web && npm run build` окремо, потім деплой окремою командою — `cf:deploy` одним кроком блокує класифікатор auto-mode.

---

## Перевірка після всього

- [ ] `PRUNE_DRY_RUN=1 node dist/prune.js` двічі поспіль дає однакові числа (нічого не видалилось вхолосту)
- [ ] Після справжнього прогону: `SELECT COUNT(*) FROM sent` **не змінився**. Це головна перевірка плану — саме її ламає каскад
- [ ] Кабінет живої людини (`/dashboard`) показує ту саму історію, що й до чистки
- [ ] `/go/<id>` для старої вакансії з історії все ще веде на оголошення
- [ ] Головна сторінка показує менше число вакансій, ніж до чистки — і це правильне число
- [ ] Наступна ранкова добірка людині з містом містить 2 місцеві з 5, якщо місцеві є в кеші

## Що свідомо НЕ робимо

- **Не прибираємо `ON DELETE CASCADE` з `sent.job_id`.** Перебудова таблиці в SQLite це create/copy/drop/rename із відновленням чотирьох індексів, проти живої бази, заради нуля користі: умова `NOT EXISTS (... FROM sent ...)` дає той самий захист без жодного ризику.
- **Не додаємо знімок вакансії в `sent`** (title/company/url копією). Це знадобилось би, тільки якби ми справді видаляли надіслані рядки. Ми їх не видаляємо.
- **Не перевіряємо 200 OK за посиланням** у момент добірки. Це окреме питання (вакансія, зняту одразу після скану, людина може отримати ще майже три доби) і воно не про розмір бази. Окремий план, якщо взагалі.
- **Не міняємо `RETENTION_DAYS` на менше за 30.** Добірці вистачає 3, але 30 лишає запас на ручні розбори й на розширення вікна без втрати даних.
