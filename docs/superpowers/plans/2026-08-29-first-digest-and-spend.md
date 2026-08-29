# Перша добірка «по домовленості» + витрати в доларах — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Після онбордингу людина бачить, коли саме прийде перша планова добірка (робочі дні, її година, її зона — «понеділок, 1 вересня, 09:00»), може натиснути «Прислати 5 зараз» і отримати справжню добірку за профілем із поясненням «ось так працює бот, далі — як домовилися»; адмінка показує витрати на модель у доларах.

**Architecture:** Три незалежні шматки. (1) Ціни: одна таблиця «$ за 1M токенів» у web і в scanner (репо свідомо не імпортує між пакетами — дублюємо, як `digest-copy.ts` дублює `bot-copy.ts`), `cost_usd` пишеться при кожному логуванні, старі рядки дораховуються одноразовим SQL. (2) Дата наступної доставки: чиста функція `nextDelivery(tz, hour, now)` (робочий день ≥ зараз) + `formatWhen()` через Intl — у web (`digest-time.ts`) і в scanner (`digest-copy.ts`). (3) Перша добірка: автозамовлення після онбордингу прибираємо (бот `requestFirstDigest`, сайт `persistProfile`); замість нього — повідомлення з датою + кнопки «Прислати 5 зараз» / «Чекатиму». Сканер, доставляючи на запит людині, у якої ще не було жодної доставленої добірки, дописує рядок «Ось так працює бот…».

**Tech Stack:** Next.js 15 на Cloudflare Workers + D1 (web/), Node + TypeScript сканер під systemd (scanner/), vitest в обох. Тести: `cd web && npm test`, `cd scanner && npm test`. Тайпчек: `npx tsc --noEmit`. Коміти від `hypnogaba <hypnogaba@gmail.com>`, без Co-Authored-By.

**Поточний стан, який план змінює (перевірено 2026-08-29):**
- `web/src/lib/usage.ts:31` і `scanner/src/digest.ts:403-413` пишуть `cost_usd=0`.
- `web/src/app/admin/page.tsx:650-662` показує токени, не долари.
- `web/src/lib/bot.ts:145-151 requestFirstDigest` і `web/src/app/actions.ts:196-206` замовляють першу добірку автоматично, а `bot-onboarding.ts:223-228 ready` / `i18n.ts first.soon, dash.queued, telegram.lede, telegram.doneLede, dash.empty, tg.p2d` кажуть «протягом години» — це вже неправда (запити виконуються за 2 хв; планова — лише Пн–Пт).
- `scanner/src/digest.ts deliverTo` уже знає `onRequest` і має `recent` (рядки `sent` за 2 доби) — але «перша добірка взагалі» звідти не видно.

---

## Файли

| Файл | Дія | Відповідальність |
|---|---|---|
| `web/src/lib/pricing.ts` | створити | таблиця цін, `costUsd()` |
| `web/src/lib/pricing.test.ts` | створити | |
| `web/src/lib/usage.ts` | змінити | писати `cost_usd` |
| `scanner/src/pricing.ts`, `pricing.test.ts` | створити | копія таблиці для сканера |
| `scanner/src/digest.ts` `logUsage` | змінити | писати `cost_usd` |
| `db/migrations/0014_cost_backfill.sql` | створити | дорахувати старі рядки |
| `web/src/app/admin/page.tsx` | змінити | плитки в доларах |
| `web/src/lib/digest-time.ts`, `.test.ts` | змінити | `nextDelivery`, `formatWhen` |
| `web/src/lib/bot-onboarding.ts` | змінити | текст готовності з датою |
| `web/src/lib/bot-copy.ts` | змінити | фрази `firstNow`, `firstWait`, `firstQueued`, `firstAgreed` |
| `web/src/lib/bot.ts` | змінити | кнопки після онбордингу, `handleFirstButton`, прибрати автозапит |
| `web/src/app/api/telegram/webhook/route.ts` | змінити | підключити `handleFirstButton` |
| `web/src/app/actions.ts` | змінити | прибрати автозапит, `requestFirstFive` |
| `web/src/app/dashboard/page.tsx`, `web/src/app/telegram/page.tsx`, `web/src/lib/i18n.ts` | змінити | дата + кнопка на сайті |
| `scanner/src/digest-copy.ts` | змінити | `nextDelivery`/`formatWhen` (копія) + фраза `trialFooter` |
| `scanner/src/digest.ts` `deliverTo`, `formatDigest` | змінити | футер тестової добірки |

---

### Task 1: Таблиця цін і `cost_usd` у web

**Files:**
- Create: `web/src/lib/pricing.ts`
- Create: `web/src/lib/pricing.test.ts`
- Modify: `web/src/lib/usage.ts:28-36`

- [ ] **Step 1: Тест**

```ts
// web/src/lib/pricing.test.ts
import { describe, it, expect } from "vitest";
import { costUsd, PRICES } from "./pricing";

describe("costUsd", () => {
  it("рахує haiku за 1$/5$ на мільйон", () => {
    expect(costUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
    expect(costUsd("claude-haiku-4-5", 500, 700)).toBeCloseTo(0.0005 + 0.0035, 9);
  });
  it("розуміє snapshot-суфікси й невідомі моделі", () => {
    expect(costUsd("claude-opus-5", 1_000_000, 0)).toBe(5);
    expect(costUsd(null, 1000, 1000)).toBe(0);
    expect(costUsd("gpt-whatever", 1000, 1000)).toBe(0);
  });
  it("таблиця має всі моделі, що згадуються в коді", () => {
    for (const m of ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]) expect(PRICES[m]).toBeDefined();
  });
});
```

- [ ] **Step 2: Запустити — має впасти**

Run: `cd web && npx vitest run src/lib/pricing.test.ts`
Expected: FAIL — `Cannot find module './pricing'`

- [ ] **Step 3: Реалізація**

```ts
// web/src/lib/pricing.ts
/**
 * Ціни Anthropic за мільйон токенів, USD (перевірено 2026-08-29).
 *
 * Дублікат у scanner/src/pricing.ts — пакети свідомо не імпортують один
 * одного. Змінюєш тут — зміни і там.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5":  { input: 2, output: 10 },
  "claude-opus-5":    { input: 5, output: 25 },
};

/** "claude-haiku-4-5-20251001" → "claude-haiku-4-5". */
function family(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/** Долари за один виклик. Невідома модель — 0, а не вигадана ставка. */
export function costUsd(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const p = PRICES[family(model)];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
```

- [ ] **Step 4: Тест зелений**

Run: `cd web && npx vitest run src/lib/pricing.test.ts`
Expected: 3 passed

- [ ] **Step 5: `usage.ts` пише вартість**

У `web/src/lib/usage.ts` додати `import { costUsd } from "./pricing";` і замінити INSERT:

```ts
export async function logUsage(u: Usage): Promise<void> {
  try {
    await run(
      `INSERT INTO api_usage (id,service,operation,model,input_tokens,output_tokens,cost_usd,ok)
       VALUES (?,'anthropic',?,?,?,?,?,?)`,
      crypto.randomUUID(), u.operation, u.model, u.inputTokens, u.outputTokens,
      costUsd(u.model, u.inputTokens, u.outputTokens), u.ok ? 1 : 0);
  } catch { /* журнал не важливіший за роботу */ }
}
```

Оновити коментар шапки файлу (рядки 10-13): замість «Записуємо ТОКЕНИ, а не гроші…» — «Долари рахуємо за таблицею pricing.ts у момент запису; невідома модель дає 0».

- [ ] **Step 6: Перевірка й коміт**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: усе зелене (110 + 3).

```bash
git add web/src/lib/pricing.ts web/src/lib/pricing.test.ts web/src/lib/usage.ts
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Облік: долари за таблицею цін, а не нуль (web)"
```

---

### Task 2: Те саме в сканері

**Files:**
- Create: `scanner/src/pricing.ts` (побайтова копія `web/src/lib/pricing.ts`, без імпортів)
- Create: `scanner/src/pricing.test.ts` (копія тесту з Task 1, імпорт `./pricing.js`)
- Modify: `scanner/src/digest.ts:403-413`

- [ ] **Step 1: Скопіювати файл і тест**

```bash
cp web/src/lib/pricing.ts scanner/src/pricing.ts
sed 's#"./pricing"#"./pricing.js"#' web/src/lib/pricing.test.ts > scanner/src/pricing.test.ts
```

- [ ] **Step 2: Тест зелений**

Run: `cd scanner && npx vitest run src/pricing.test.ts`
Expected: 3 passed

- [ ] **Step 3: `logUsage` у digest.ts**

Додати `import { costUsd } from "./pricing.js";` і замінити тіло:

```ts
async function logUsage(
  d1: D1Client, operation: string, u: { model: string; inputTokens: number; outputTokens: number; ok: boolean },
): Promise<void> {
  try {
    await d1.execute(
      `INSERT OR IGNORE INTO api_usage (id,service,operation,model,input_tokens,output_tokens,cost_usd,ok)
       VALUES (?,'anthropic',?,?,?,?,?,?)`,
      [crypto.randomUUID(), operation, u.model, u.inputTokens, u.outputTokens,
       costUsd(u.model, u.inputTokens, u.outputTokens), u.ok ? 1 : 0]);
  } catch { /* журнал не важливіший за доставку */ }
}
```

- [ ] **Step 4: Перевірка й коміт**

Run: `cd scanner && npx tsc --noEmit && npm test`
Expected: зелено (204 + 3).

```bash
git add scanner/src/pricing.ts scanner/src/pricing.test.ts scanner/src/digest.ts
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Облік: долари за таблицею цін (scanner)"
```

---

### Task 3: Дорахувати старі рядки й показати долари в адмінці

**Files:**
- Create: `db/migrations/0014_cost_backfill.sql`
- Modify: `web/src/app/admin/page.tsx:189-197, 650-662`

- [ ] **Step 1: SQL дорахунку**

```sql
-- db/migrations/0014_cost_backfill.sql
-- Рядки api_usage, записані до появи таблиці цін, мають cost_usd=0.
-- Ставки — ті самі, що в web/src/lib/pricing.ts (USD за 1M токенів).
UPDATE api_usage SET cost_usd = (input_tokens * 1.0 + output_tokens * 5.0) / 1000000.0
 WHERE cost_usd = 0 AND model LIKE 'claude-haiku-4-5%';
UPDATE api_usage SET cost_usd = (input_tokens * 2.0 + output_tokens * 10.0) / 1000000.0
 WHERE cost_usd = 0 AND model LIKE 'claude-sonnet-5%';
UPDATE api_usage SET cost_usd = (input_tokens * 5.0 + output_tokens * 25.0) / 1000000.0
 WHERE cost_usd = 0 AND model LIKE 'claude-opus-5%';
```

- [ ] **Step 2: Запит в адмінці**

Замінити SELECT `spend` (рядки 191-201) на:

```ts
  const spend = await one<{ calls: number; callsWeek: number; usdToday: number; usdWeek: number;
    usdMonth: number; failed: number; boards: number; countries: number; boardJobs: number; localJobs: number }>(`
    SELECT (SELECT COUNT(*) FROM api_usage WHERE date(at)=date('now')) calls,
           (SELECT COUNT(*) FROM api_usage WHERE at >= datetime('now','-7 day')) callsWeek,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE date(at)=date('now')) usdToday,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE at >= datetime('now','-7 day')) usdWeek,
           (SELECT COALESCE(SUM(cost_usd),0) FROM api_usage WHERE at >= datetime('now','-30 day')) usdMonth,
           (SELECT COUNT(*) FROM api_usage WHERE ok=0 AND at >= datetime('now','-7 day')) failed,
           (SELECT COUNT(*) FROM country_boards WHERE enabled=1) boards,
           (SELECT COUNT(DISTINCT country) FROM country_boards WHERE enabled=1) countries,
           (SELECT COUNT(*) FROM jobs_cache WHERE source LIKE 'board:%') boardJobs,
           (SELECT COUNT(*) FROM jobs_cache WHERE country IS NOT NULL) localJobs`);
```

Оновити коментар над ним: «Витрати в доларах: cost_usd пишеться при кожному виклику за таблицею pricing.ts».

- [ ] **Step 3: Плитки**

Додати поруч із `num()` хелпер:

```ts
const usd = (n: number): string => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
```

Замінити блок `spend` (рядки 650-662):

```tsx
          <Block id="spend" title="Витрати"
                 lede="Долари за таблицею цін Anthropic; прогноз — середнє за тиждень × 30.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Tile n={usd(spend?.usdToday ?? 0)} label="сьогодні" />
              <Tile n={usd(spend?.usdWeek ?? 0)} label="за 7 днів" />
              <Tile n={usd(spend?.usdMonth ?? 0)} label="за 30 днів" />
              <Tile n={usd(((spend?.usdWeek ?? 0) / 7) * 30)} label="прогноз на місяць" />
              <Tile n={spend?.failed ?? 0} label="невдалих звернень" accent={(spend?.failed ?? 0) > 0} />
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              {(spend?.callsWeek ?? 0) === 0
                ? "За тиждень модель не викликалась."
                : `${num(spend?.calls ?? 0)} звернень сьогодні, ${num(spend?.callsWeek ?? 0)} за тиждень.`}
            </p>
          </Block>
```

- [ ] **Step 4: Перевірка, застосувати SQL, коміт**

Run: `cd web && npx tsc --noEmit && npm run lint 2>&1 | grep -v .open-next | grep -c error` → `0`

Застосувати дорахунок до живої бази (токен — див. `reference_nextrole_deploy_token`):
```bash
cd web && CLOUDFLARE_API_TOKEN=… npx wrangler d1 execute crypto-jobs-agent --remote --file ../db/migrations/0014_cost_backfill.sql
CLOUDFLARE_API_TOKEN=… npx wrangler d1 execute crypto-jobs-agent --remote --command "select round(sum(cost_usd),4) usd, count(*) n from api_usage"
```
Expected: `usd` > 0 (≈0.003 на кожну добірку з 5 вакансій).

```bash
git add db/migrations/0014_cost_backfill.sql web/src/app/admin/page.tsx
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Адмінка: витрати в доларах, старі рядки дораховано"
```

---

### Task 4: `nextDelivery` і `formatWhen` у web

**Files:**
- Modify: `web/src/lib/digest-time.ts` (додати в кінець)
- Modify/Create: `web/src/lib/digest-time.test.ts`

- [ ] **Step 1: Тести**

```ts
// web/src/lib/digest-time.test.ts (додати describe)
import { nextDelivery, formatWhen } from "./digest-time";

describe("nextDelivery", () => {
  // Субота 2026-08-29 13:00 Париж = 11:00Z
  const sat = new Date("2026-08-29T11:00:00Z");
  it("із суботи — понеділок о 9 за Парижем", () => {
    const d = nextDelivery("Europe/Paris", 9, sat);
    expect(d.toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });
  it("у робочий день до години — сьогодні", () => {
    const mon8 = new Date("2026-08-31T06:00:00Z"); // 08:00 Париж
    expect(nextDelivery("Europe/Paris", 9, mon8).toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });
  it("у робочий день після години — наступний робочий", () => {
    const fri10 = new Date("2026-08-28T08:00:00Z"); // п'ятниця 10:00 Париж
    expect(nextDelivery("Europe/Paris", 9, fri10).toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });
  it("Київ", () => {
    expect(nextDelivery("Europe/Kyiv", 9, sat).toISOString()).toBe("2026-08-31T06:00:00.000Z");
  });
});

describe("formatWhen", () => {
  const d = new Date("2026-08-31T07:00:00Z");
  it("uk", () => expect(formatWhen(d, "Europe/Paris", "uk")).toMatch(/понеділок, 31 серпня, 09:00/));
  it("en", () => expect(formatWhen(d, "Europe/Paris", "en")).toMatch(/Monday, 31 August, 09:00/));
  it("fr", () => expect(formatWhen(d, "Europe/Paris", "fr")).toMatch(/lundi 31 août, 09:00/));
});
```

- [ ] **Step 2: Впевнитись, що падає**

Run: `cd web && npx vitest run src/lib/digest-time.test.ts`
Expected: FAIL — `nextDelivery is not a function` (або import error)

- [ ] **Step 3: Реалізація** (додати в `web/src/lib/digest-time.ts`)

```ts
/** Частини локального часу в зоні: рік-місяць-день, година, день тижня 0..6 (нд=0). */
function partsIn(tz: string, at: Date): { y: number; m: number; d: number; h: number; wd: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, weekday: "short",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, wd };
}

/** Момент, коли в зоні tz настає локальна дата y-m-d о h:00. Ітерація по зсуву — без бібліотек. */
function zonedTime(tz: string, y: number, m: number, d: number, h: number): Date {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 3; i++) {
    const p = partsIn(tz, new Date(guess));
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h);
    const want = Date.UTC(y, m - 1, d, h);
    if (seen === want) break;
    guess += want - seen;
  }
  return new Date(guess);
}

/**
 * Найближча планова доставка: робочий день (Пн–Пт) у зоні людини о hour:00,
 * не раніше за now. Той самий алгоритм у scanner/src/digest-copy.ts.
 */
export function nextDelivery(tz: string, hour: number, now: Date): Date {
  const p = partsIn(tz, now);
  for (let add = 0; add < 8; add++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + add, 12));
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const at = zonedTime(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour);
    if (at.getTime() >= now.getTime()) return at;
  }
  return now;
}

/** «понеділок, 31 серпня, 09:00» мовою людини, у її зоні. */
export function formatWhen(at: Date, tz: string, locale: Locale): string {
  const day = new Intl.DateTimeFormat(intlOf(locale), { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return `${day}, ${time}`;
}
```

- [ ] **Step 4: Зелено**

Run: `cd web && npx vitest run src/lib/digest-time.test.ts`
Expected: усі passed. Якщо `fr` дає «lundi 31 août» без коми між днем тижня і числом — тест уже це враховує; якщо `uk` формат інший (наприклад «понеділок, 31 серпня») — підправити regex у тесті під фактичний вивід Node ICU, але зберегти день тижня + число + місяць + час.

- [ ] **Step 5: Коміт**

```bash
git add web/src/lib/digest-time.ts web/src/lib/digest-time.test.ts
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Дата найближчої планової добірки: робочий день у зоні людини"
```

---

### Task 5: Бот — після онбордингу дата + «Прислати 5 зараз»

**Files:**
- Modify: `web/src/lib/bot-copy.ts` (фрази)
- Modify: `web/src/lib/bot-onboarding.ts:223-228, 425` (`ready`, `readyText`)
- Modify: `web/src/lib/bot.ts:145-151, 415-425` (`requestFirstDigest`, кінець `finishOnboarding`), новий `handleFirstButton`
- Modify: `web/src/app/api/telegram/webhook/route.ts` (виклик `handleFirstButton` поруч із `handleStartButton`)
- Test: `web/src/lib/bot-onboarding.test.ts`

- [ ] **Step 1: Фрази в `bot-copy.ts`** (у той самий об'єкт, що й `moreQueued`; усі 4 мови)

```ts
  firstNow:    { en: "Send 5 now", uk: "Прислати 5 зараз", fr: "Envoyer 5 maintenant", ru: "Прислать 5 сейчас" },
  firstWait:   { en: "I’ll wait", uk: "Чекатиму", fr: "J’attendrai", ru: "Подожду" },
  firstQueued: {
    en: "Looking — five roles for your profile arrive in a couple of minutes, so you can see how the bot works. Then as agreed: {when}.",
    uk: "Шукаю — п'ять вакансій під твій профіль прийдуть за пару хвилин, щоб ти побачив, як працює бот. Далі — як домовилися: {when}.",
    fr: "Je cherche — cinq postes pour votre profil arrivent dans deux minutes, pour voir comment le bot fonctionne. Ensuite, comme convenu : {when}.",
    ru: "Ищу — пять вакансий под твой профиль придут через пару минут, чтобы ты увидел, как работает бот. Дальше — как договорились: {when}.",
  },
  firstAgreed: {
    en: "Agreed. See you {when}.",
    uk: "Домовились. До зустрічі {when}.",
    fr: "Entendu. À {when}.",
    ru: "Договорились. До встречи {when}.",
  },
```

- [ ] **Step 2: `ready` з датою** — у `bot-onboarding.ts` замінити текст `ready` і сигнатуру `readyText`:

```ts
  ready: {
    en: "You are set.\n\n✓ Profile saved\n○ Batches come on weekdays at {h} ({tz})\n● Next one: {when}\n\nWant to see how it looks right now?",
    uk: "Готово.\n\n✓ Профіль збережено\n○ Добірки приходять у робочі дні о {h} ({tz})\n● Найближча: {when}\n\nХочеш побачити, як це виглядає, вже зараз?",
    fr: "C'est prêt.\n\n✓ Profil enregistré\n○ Les sélections arrivent en semaine à {h} ({tz})\n● Prochaine : {when}\n\nVoir à quoi ça ressemble dès maintenant ?",
    ru: "Готово.\n\n✓ Профиль сохранён\n○ Подборки приходят в рабочие дни в {h} ({tz})\n● Ближайшая: {when}\n\nХочешь увидеть, как это выглядит, прямо сейчас?",
  },
```

```ts
export const readyText = (locale: Locale, v: { h: string; tz: string; when: string }): string =>
  TEXT.ready[locale].replace("{h}", v.h).replace("{tz}", v.tz).replace("{when}", v.when);
```
(`TEXT` — назва об'єкта, в якому зараз лежить `ready`; підставити фактичну.)

- [ ] **Step 3: Тест на `readyText`** (у `bot-onboarding.test.ts`)

```ts
it("readyText підставляє годину, зону й дату", () => {
  const s = readyText("uk", { h: "09:00", tz: "Париж", when: "понеділок, 31 серпня, 09:00" });
  expect(s).toContain("робочі дні о 09:00 (Париж)");
  expect(s).toContain("Найближча: понеділок, 31 серпня, 09:00");
});
```
Run: `cd web && npx vitest run src/lib/bot-onboarding.test.ts` → passed (після Step 2).

- [ ] **Step 4: `bot.ts` — прибрати автозапит, показати кнопки**

Видалити функцію `requestFirstDigest` (рядки 145-151) і її виклик у `finishOnboarding` (рядок 419). Замість `const done = …` (рядок 421):

```ts
  const zone = timezone;                    // те, що щойно записали в users.timezone
  const when = nextDelivery(zone, 9, new Date());
  const done = `${summary(draft, locale)}\n\n${readyText(locale, {
    h: "09:00", tz: zoneName(zone, locale), when: formatWhen(when, zone, locale) })}`;
  const keys = [[
    { text: say("firstNow", locale),  callback_data: "first:now" },
    { text: say("firstWait", locale), callback_data: "first:wait" },
  ]];
  if (messageId) await editKeyboard(env, chatId, messageId, done, keys);
  else await sendKeyboard(env, chatId, done, keys);
```
Імпорти: `nextDelivery, formatWhen` з `@/lib/digest-time`; `zoneName` уже є в `@/lib/tz`. Якщо `sendKeyboard` не існує — використати той самий хелпер, яким `startBotOnboarding` шле першу клавіатуру (у файлі є `send*` із `reply_markup`; взяти його). `9` — це `delivery_hour`, який `finishOnboarding` записує в `users`; якщо там змінна — підставити її.

- [ ] **Step 5: `handleFirstButton`** (поруч із `handleStartButton`, той самий стиль)

```ts
/** Кнопки під «Готово»: тестова добірка зараз або чекати планової. */
export async function handleFirstButton(
  env: Env, chatId: number, callbackId: string, data: string, locale: Locale,
): Promise<boolean> {
  if (!data.startsWith("first:")) return false;
  await ackButton(env, callbackId);
  const u = await one<{ id: string; timezone: string; delivery_hour: number }>(
    "SELECT id, timezone, delivery_hour FROM users WHERE telegram_chat_id=?", String(chatId));
  if (!u) return true;
  const when = formatWhen(nextDelivery(u.timezone, u.delivery_hour, new Date()), u.timezone, locale);
  if (data === "first:now") {
    await run(
      `INSERT INTO delivery_requests (id,user_id)
       SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=? AND handled_at IS NULL)`,
      uuid(), u.id, u.id);
    await sendText(env.TELEGRAM_BOT_TOKEN, chatId, sayF("firstQueued", locale, { when }));
  } else {
    await sendText(env.TELEGRAM_BOT_TOKEN, chatId, sayF("firstAgreed", locale, { when }));
  }
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", u.id);
  return true;
}
```
`sayF` — існуючий хелпер підстановки `{var}` у bot-copy (`tf`/`botCopyF`; взяти фактичну назву, як у `wishNoted`).

- [ ] **Step 6: Підключити у webhook** — там, де викликається `handleStartButton(...)`, додати наступним рядком за тим самим зразком `if (await handleFirstButton(env, chatId, cb.id, data, locale)) return ok();`.

- [ ] **Step 7: Перевірка й коміт**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: зелено.

```bash
git add web/src/lib/bot-copy.ts web/src/lib/bot-onboarding.ts web/src/lib/bot-onboarding.test.ts web/src/lib/bot.ts web/src/app/api/telegram/webhook/route.ts
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Бот: після анкети — дата найближчої добірки і кнопка «Прислати 5 зараз»"
```

---

### Task 6: Сканер — футер тестової добірки

**Files:**
- Modify: `scanner/src/digest-copy.ts` (фраза `trialFooter`, копія `nextDelivery`/`formatWhen`)
- Modify: `scanner/src/digest.ts` (`formatDigest` opts, `deliverTo`)
- Test: `scanner/src/digest.test.ts`

- [ ] **Step 1: Скопіювати `partsIn`, `zonedTime`, `nextDelivery`, `formatWhen` з Task 4 у `scanner/src/digest-copy.ts`** (експортувати `nextDelivery`, `formatWhen`; `intlOf` там уже є, `Locale` теж). Скопіювати і тести `nextDelivery`/`formatWhen` у `scanner/src/digest.test.ts` з імпортом із `./digest-copy.js`.

Run: `cd scanner && npx vitest run src/digest.test.ts` → passed.

- [ ] **Step 2: Фраза**

```ts
  trialFooter: {
    en: "That’s how the bot works — these are real roles for your profile. From now on, as agreed: weekdays, next one {when}.",
    uk: "Ось так працює бот — це справжні вакансії під твій профіль. Далі — як домовилися: у робочі дні, найближча {when}.",
    fr: "Voilà comment le bot fonctionne — ce sont de vrais postes pour votre profil. Ensuite, comme convenu : en semaine, la prochaine {when}.",
    ru: "Вот так работает бот — это настоящие вакансии под твой профиль. Дальше — как договорились: в рабочие дни, ближайшая {when}.",
  },
```

- [ ] **Step 3: Тест на футер**

```ts
it("тестова добірка закінчується поясненням", () => {
  const text = formatDigest(fiveJobs, "uk", { trialWhen: "понеділок, 31 серпня, 09:00" });
  expect(text).toMatch(/Ось так працює бот.*понеділок, 31 серпня, 09:00\.$/s);
});
it("звичайна — без нього", () => {
  expect(formatDigest(fiveJobs, "uk")).not.toContain("Ось так працює бот");
});
```
(`fiveJobs` — фікстура з 5 `DigestJob`, яка вже є в цьому тест-файлі; взяти її назву.)

Run → FAIL (`trialWhen` ігнорується).

- [ ] **Step 4: `formatDigest`** — розширити opts: `{ summaries?: boolean; capped?: boolean; trialWhen?: string }`. Перед `return lines.join(...)`:

```ts
  if (opts.trialWhen) {
    lines.push("─────────────");
    lines.push("");
    lines.push(escapeHtml(say(locale, "trialFooter").replace("{when}", opts.trialWhen)));
  }
```
`fitDigest` передає opts далі без змін (перевірити, що він не губить нові поля).

- [ ] **Step 5: `deliverTo`** — після обчислення `recent` (рядки ~462-465) додати:

```ts
  // Перша доставлена добірка взагалі — тестова: людина натиснула «Прислати 5
  // зараз» одразу після анкети. Дописуємо, коли прийде справжня.
  const everSent = await d1.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sent WHERE user_id=? AND status='sent'", [u.id]);
  const trialWhen = onRequest && (everSent[0]?.n ?? 0) === 0
    ? formatWhen(nextDelivery(u.timezone, u.delivery_hour, now), u.timezone, locale)
    : undefined;
```
і в місці, де формується свіжа добірка (`formatDigest(withWhy, locale, { capped })` або як воно зараз називається), передати `{ capped, trialWhen }`.

- [ ] **Step 6: Перевірка й коміт**

Run: `cd scanner && npx tsc --noEmit && npm test` → зелено.

```bash
git add scanner/src/digest-copy.ts scanner/src/digest.ts scanner/src/digest.test.ts
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Добірка: перша на запит підписана як тестова з датою справжньої"
```

---

### Task 7: Сайт — дата й кнопка замість «протягом години»

**Files:**
- Modify: `web/src/app/actions.ts:196-206` (прибрати автозапит), додати `requestFirstFive`
- Modify: `web/src/app/dashboard/page.tsx:58, 181-200` (`FirstRun`)
- Modify: `web/src/app/telegram/page.tsx:24` (`doneLede`)
- Modify: `web/src/lib/i18n.ts` — ключі `first.soon`, `first.daily`, `dash.queued`, `telegram.lede`, `telegram.doneLede`, `dash.empty`, `tg.p2d`; нові `first.next`, `first.now`, `first.testNote`

- [ ] **Step 1: i18n** (4 мови; uk наведено, en/fr/ru — за тим самим змістом)

```ts
  "first.soon":    "Добірки приходять у робочі дні о {h} ({tz})",
  "first.next":    "Найближча — {when}",
  "first.now":     "Прислати 5 зараз",
  "first.testNote":"П'ять вакансій під твій профіль прийдуть за пару хвилин — щоб побачити, як працює бот. Далі — за розкладом.",
  "dash.queued":   "Шукаю — прийде за пару хвилин.",
  "telegram.lede": "Натисни кнопку, потім Start у Telegram. Далі — дата першої добірки і кнопка «Прислати 5 зараз».",
  "telegram.doneLede": "Добірки приходять у робочі дні у твій час. Найближча — {when}.",
  "dash.empty":    "Поки порожньо. Найближча добірка — {when}.",
  "tg.p2d":        "Скажи, що не влучили, — і завтрашня ближче. Попроси ще п'ять — прийдуть за пару хвилин.",
```
Видалити ключ `first.daily` (більше не використовується) в усіх 4 локалях. Перевірити паритет ключів тестом `i18n` (у репо є тест на однакові набори ключів — він і зловить пропуски).

- [ ] **Step 2: `actions.ts`** — видалити INSERT у `delivery_requests` з `persistProfile` (рядки 196-206, разом із коментарем) і додати server action:

```ts
/** «Прислати 5 зараз» після анкети: один відкритий запит на людину. */
export async function requestFirstFive(): Promise<void> {
  const user = await requireUser();
  await run(
    `INSERT INTO delivery_requests (id,user_id)
     SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_requests WHERE user_id=? AND handled_at IS NULL)`,
    uuid(), user.id, user.id);
  await run("UPDATE users SET last_interaction_at=datetime('now') WHERE id=?", user.id);
  redirect("/dashboard?queued=1");
}
```

- [ ] **Step 3: `FirstRun`** — сигнатура `{ locale, hour, tz, connected }`; у `dashboard/page.tsx:58` передати `tz={me?.timezone ?? "UTC"}`. Тіло:

```tsx
function FirstRun({ locale, hour, tz, connected }: { locale: Locale; hour: number; tz: string; connected: boolean }) {
  const when = formatWhen(nextDelivery(tz, hour, new Date()), tz, locale);
  const rows = [
    { mark: "✓", text: t(locale, "first.profile"), done: true },
    { mark: "○", text: t(locale, "first.soon").replace("{h}", `${String(hour).padStart(2, "0")}:00`).replace("{tz}", zoneName(tz, locale)), done: false },
    { mark: "●", text: t(locale, "first.next").replace("{when}", when), done: false },
  ];
  return (
    <div className="card px-8 py-12">
      <p className="display text-2xl">{t(locale, "first.title")}</p>
      <ul className="mt-8 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.text} className="flex gap-3 text-sm" style={{ color: r.done ? "var(--ok)" : "var(--ink-2)" }}>
            <span className="mono">{r.mark}</span>{r.text}
          </li>
        ))}
      </ul>
      <div className="mt-9 flex flex-wrap items-center gap-4">
        <form action={requestFirstFive}><button className="btn" type="submit">{t(locale, "first.now")}</button></form>
        {!connected && <a href="/telegram" className="btn">{t(locale, "telegram.button")}</a>}
        <a href="/profile" className="link text-sm">{t(locale, "first.edit")}</a>
      </div>
      <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>{t(locale, "first.testNote")}</p>
    </div>
  );
}
```
Імпорти: `nextDelivery, formatWhen` з `@/lib/digest-time`, `zoneName` з `@/lib/tz`, `requestFirstFive` з `./../actions` (як імпортуються інші actions у цьому файлі). Аналогічно замінити `{when}` у `dash.empty` там, де він рендериться (рядок ~61), і в `telegram/page.tsx:24` (`doneLede`: там є `me` з `timezone`/`delivery_hour`? якщо ні — дістати `currentUser()` + `SELECT timezone, delivery_hour FROM users`).

- [ ] **Step 4: Перевірка, коміт**

Run: `cd web && npx tsc --noEmit && npm test && npm run lint 2>&1 | grep -v .open-next | grep -c " error" ` → тести зелені, `0`.

```bash
git add web/src/app/actions.ts web/src/app/dashboard/page.tsx web/src/app/telegram/page.tsx web/src/lib/i18n.ts
git -c user.name=hypnogaba -c user.email=hypnogaba@gmail.com commit -m "Сайт: дата першої добірки і «Прислати 5 зараз» замість «протягом години»"
```

---

### Task 8: Деплой і жива перевірка

- [ ] **Step 1: Push**
```bash
git push origin main
```

- [ ] **Step 2: Web**
```bash
cd web && CLOUDFLARE_API_TOKEN=… npm run cf:deploy 2>&1 | grep -E "Version ID|rror"
```

- [ ] **Step 3: Scanner**
```bash
cd scanner && npm run build && rsync -a --delete --exclude .env --exclude src --exclude node_modules ./package.json ./package-lock.json ./dist tradebot-vps:/opt/nextrole-scanner/
```
(Systemd-юніти не змінювались — перезапуск не потрібен; `nextrole-requests.timer` підхопить новий `dist` на наступному тику.)

- [ ] **Step 4: Жива перевірка**
1. Адмінка `/admin#spend`: плитки «сьогодні / 7 днів / 30 днів / прогноз» у `$`, значення > 0.
2. Тестовий чат: `/start` → «Почати заново» → пройти анкету → повідомлення містить «Добірки приходять у робочі дні о 09:00 (…)» і «Найближча: понеділок, 31 серпня, 09:00» + дві кнопки.
3. Натиснути «Прислати 5 зараз» → відповідь «Шукаю…» → за ≤2 хв добірка, останній рядок «Ось так працює бот — це справжні вакансії… найближча понеділок, 31 серпня, 09:00».
4. Сайт `/dashboard` новим акаунтом без добірок: три рядки з датою, кнопка «Прислати 5 зараз» → `?queued=1` → «Шукаю — прийде за пару хвилин».
5. `journalctl -u nextrole-requests --since "10 min ago"` — «надіслано 5 (на запит)», без помилок.

- [ ] **Step 5: Записати в пам'ять** (`project_nextrole_feedback_plan_2026_08_29.md`): «round 3 built+deployed: dollars in admin, first-digest opt-in with date, trial footer».

---

## Self-review

- **Покриття:** долари — Tasks 1-3; дата після онбордингу (бот і сайт) — 4, 5, 7; «Прислати 5 зараз» — 5 (бот), 7 (сайт); позначка «це були тестові» — 6. Автозамовлення прибрано в обох місцях (5, 7), інакше кнопка не мала б сенсу.
- **Типи:** `nextDelivery(tz: string, hour: number, now: Date): Date` і `formatWhen(at: Date, tz: string, locale: Locale): string` однакові у web і scanner; `readyText(locale, {h, tz, when})` — Task 5 Step 2 і Step 4 узгоджені; `formatDigest(jobs, locale, {summaries?, capped?, trialWhen?})` — Task 6 Steps 3-5.
- **Ризик:** формат `Intl` для `uk`/`fr` у Node на VPS може відрізнятися від Workers (різні ICU) — тести в Task 4/6 перевіряють вміст, не байти; якщо кома стоїть інакше, правити regex, не логіку.
- **YAGNI:** не вводимо колонку `kind` у `delivery_requests` — «тестова» визначається як «перша доставлена взагалі», цього досить.
