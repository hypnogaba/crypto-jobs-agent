# Розмовний онбординг у боті — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.
> Кроки позначені `- [ ]`.

**Мета:** три головні питання анкети в Telegram стають відкритими, у рамці
«що ти шукаєш», з підтвердженням і трьома справжніми вакансіями; кнопки
лишаються запасним виходом.

**Архітектура:** крок отримує режим (`ask` → `confirm` → `pick`) у новій
колонці `bot_state.mode`. Відкрита відповідь читається наявним
`parseProfile`. Приклади вакансій дає новий модуль `role-samples.ts` за
навмисно простим правилом. `pick` — теперішня поведінка без змін.

**Стек:** Next.js на Cloudflare Workers, D1, Vitest. Усе в `web/`.

Специфікація: `docs/superpowers/specs/2026-09-03-conversational-onboarding-design.md`

---

## Файли

| Файл | Відповідальність |
|---|---|
| `db/migrations/0041_bot_state_mode.sql` | нова колонка режиму |
| `web/src/lib/role-samples.ts` (новий) | значущі слова ролі + вибірка трьох вакансій |
| `web/src/lib/role-samples.test.ts` (новий) | тести на слова й на форму вибірки |
| `web/src/lib/bot-onboarding.ts` | тексти в рамці наміру, клавіатури `ask` і `confirm`, текст підтвердження |
| `web/src/lib/bot-onboarding.test.ts` | тести на рамку й на нові клавіатури |
| `web/src/lib/bot.ts` | машина станів: збереження режиму, обробка тексту й кнопок |
| `web/src/lib/bot-onboarding-flow.test.ts` (новий) | переходи режимів |

---

### Задача 1: Колонка режиму

**Файли:** Create `db/migrations/0041_bot_state_mode.sql`; Modify `web/src/lib/bot.ts:117-135`

- [ ] **Крок 1: Міграція**

```sql
-- Режим кроку анкети: ask (відкрите питання) | confirm (що зрозуміли) | pick (кнопки).
--
-- Досі крок мав лише назву теми, бо форма була одна — клавіатура. Тепер та
-- сама тема питається трьома різними способами, і без окремої колонки режим
-- довелось би кодувати всередині `step`. Це мовчки зламало б
-- `STEPS.includes(row.step)`, який перевіряється в кількох місцях bot.ts.
ALTER TABLE bot_state ADD COLUMN mode TEXT NOT NULL DEFAULT 'ask';
INSERT INTO schema_migrations (name) VALUES ('0041_bot_state_mode.sql');
```

Перед накочуванням звірити з базою, а не з пам'яттю:
`npx wrangler d1 execute crypto-jobs-agent --remote --command "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3"`

- [ ] **Крок 2: Тип і збереження**

У `bot.ts`:

```ts
export type Mode = "ask" | "confirm" | "pick";
interface StateRow { step: string; draft: string; message_id: number | null; mode: string }

async function saveState(
  chatId: number, step: Step, draft: Draft, messageId: number | null, mode: Mode = "ask"
): Promise<void> {
  await run(
    `INSERT INTO bot_state (chat_id,step,draft,message_id,mode,updated_at)
     VALUES (?,?,?,?,?,datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       step=excluded.step, draft=excluded.draft, mode=excluded.mode,
       message_id=COALESCE(excluded.message_id, bot_state.message_id),
       updated_at=datetime('now')`,
    String(chatId), step, JSON.stringify(draft), messageId, mode);
}
```

Усі `SELECT ... FROM bot_state` дописати `mode`.

- [ ] **Крок 3:** `npx tsc --noEmit` у `web/`. Очікування: без помилок.
- [ ] **Крок 4:** Коміт `git commit -m "Крок анкети дістав режим"`

---

### Задача 2: Приклади вакансій

**Файли:** Create `web/src/lib/role-samples.ts`, `web/src/lib/role-samples.test.ts`

- [ ] **Крок 1: Тест, який падає**

```ts
import { describe, expect, it } from "vitest";
import { meaningfulWords, pickSamples } from "./role-samples";

describe("meaningfulWords", () => {
  it("відкидає загальні слова", () => {
    expect(meaningfulWords("senior community manager")).toEqual(["community"]);
  });
  it("лишає порожньо, коли значущого немає", () => {
    expect(meaningfulWords("head of")).toEqual([]);
  });
  it("не ламається на порожньому", () => {
    expect(meaningfulWords(null)).toEqual([]);
  });
});

describe("pickSamples", () => {
  const rows = [
    { title: "Community Manager", company: "Polygon" },
    { title: "Head of Community", company: "Polygon" },
    { title: "Community Lead", company: "Aave" },
    { title: "Community Growth", company: "Rarible" },
  ];
  it("не більше однієї вакансії на компанію", () => {
    expect(pickSamples(rows, 3).map((r) => r.company)).toEqual(["Polygon", "Aave", "Rarible"]);
  });
  it("порожній вхід дає порожній вихід", () => {
    expect(pickSamples([], 3)).toEqual([]);
  });
});
```

- [ ] **Крок 2:** `npx vitest run src/lib/role-samples.test.ts` → FAIL, модуля немає.

- [ ] **Крок 3: Реалізація**

```ts
import { query } from "./db";

export interface JobSample { title: string; company: string }

/**
 * Слова назви посади, за якими взагалі варто шукати.
 *
 * «manager» і «senior» стоять майже в кожній другій назві: за ними приклад
 * буде правдивий, але безглуздий, бо покаже випадкову вакансію. Список
 * навмисно короткий і живе тут, а не в сканері: тут він обслуговує лише
 * приклади й не має права розійтися з підбором, бо нічого йому не обіцяє.
 */
const GENERIC = new Set([
  "senior", "junior", "lead", "head", "chief", "principal", "staff",
  "manager", "specialist", "director", "officer", "intern",
  "of", "and", "the", "for",
]);

export function meaningfulWords(role: string | null | undefined): string[] {
  if (!role) return [];
  return role.toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((w) => w.length > 2 && !GENERIC.has(w));
}

/** Одна вакансія на компанію: три рядки від одного роботодавця нічого не показують. */
export function pickSamples(rows: JobSample[], limit: number): JobSample[] {
  const seen = new Set<string>();
  const out: JobSample[] = [];
  for (const r of rows) {
    const key = r.company.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Три справжні вакансії за словами людини.
 *
 * Правило навмисно простіше за підбір: свіжий рядок, значуще слово в назві.
 * Точну логіку збігу (синоніми, межі слів) має сканер, і дублювати її сюди
 * означало б завести друге джерело правди. Тому ми показуємо приклади, а не
 * число: приклад не обіцяє обсягу, тож розбіжність із добіркою не бреше.
 */
export async function sampleJobs(role: string | null, limit = 3): Promise<JobSample[]> {
  const words = meaningfulWords(role).slice(0, 2);
  if (words.length === 0) return [];
  const where = words.map(() => "LOWER(j.title) LIKE ?").join(" OR ");
  const rows = await query<JobSample>(
    `SELECT j.title, j.company FROM jobs_cache j
      WHERE j.fetched_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 day')
        AND (${where})
      ORDER BY j.posted_at DESC
      LIMIT ?`,
    ...words.map((w) => `%${w}%`), limit * 5);
  return pickSamples(rows, limit);
}
```

Звірити ім'я експорту `query` з тим, що справді є в `web/src/lib/db.ts`.

- [ ] **Крок 4:** `npx vitest run src/lib/role-samples.test.ts` → PASS.
- [ ] **Крок 5:** Коміт `git commit -m "Приклади вакансій за словами людини"`

---

### Задача 3: Тексти в рамці наміру

**Файли:** Modify `web/src/lib/bot-onboarding.ts:117-180`, `web/src/lib/bot-onboarding.test.ts`

- [ ] **Крок 1: Тест на рамку, який падає**

```ts
import { ASK_FRAME_BANNED, questionText } from "./bot-onboarding";

describe("питання стоять у рамці пошуку, а не минулого", () => {
  const locales = ["en", "uk", "fr", "ru"] as const;
  for (const l of locales) {
    it(`${l}: жодне питання не питає, ким людина є`, () => {
      for (const step of ["spheres", "industries", "where"] as const) {
        const t = questionText(step, l).toLowerCase();
        for (const bad of ASK_FRAME_BANNED) expect(t).not.toContain(bad);
      }
    });
  }
});
```

- [ ] **Крок 2:** `npx vitest run src/lib/bot-onboarding.test.ts` → FAIL.

- [ ] **Крок 3: Переписати `ASK`**

```ts
/**
 * Слова, якими анкета питала про МИНУЛЕ.
 *
 * Продукт шукає роботу, а питання звучало «яка твоя роль» — тобто ким людина
 * є. Той, хто змінює напрям, чесно відповідав про роботу, від якої йде, і
 * отримував добірку туди ж. Список експортовано заради тесту: рамку легко
 * зламати назад однією правкою тексту.
 */
export const ASK_FRAME_BANNED = ["твоя роль", "your role", "votre poste", "твоя роль",
  "ким ти працюєш", "what do you do"];
```

`ASK.spheres` → «1 з 3 · Яку роботу шукаєш?\nНапиши назвою посади. Наприклад:
комуніті менеджер, Solana developer, продуктовий дизайнер.» (і три інші мови).
`ASK.industries` → «2 з 3 · У якій галузі хочеш працювати?\nНеобов'язково.
Наприклад: web3, фінтех, ігри.»
`ASK.where` → «3 з 3 · Де шукаєш роботу?\nНаприклад: тільки віддалено · офіс у
Берліні або віддалено · готовий переїхати в ЄС.»
`ASK.cv` → «Що з досвіду варто згадати?\nЦе уточнює, чому вакансія тобі
підходить. Або пропусти.»
`ASK.wishes` → «Що ще важливо в наступній роботі?\nНапиши або пропусти.»
`WORD.fSpheres` → «Посада» / "Position" / "Poste" / «Должность».

- [ ] **Крок 4:** `npx vitest run src/lib/bot-onboarding.test.ts` → PASS.
- [ ] **Крок 5:** Коміт `git commit -m "Анкета питає про пошук, а не про минуле"`

---

### Задача 4: Клавіатури «ask» і «confirm»

**Файли:** Modify `web/src/lib/bot-onboarding.ts`, `web/src/lib/bot-onboarding.test.ts`

- [ ] **Крок 1: Тест, який падає**

```ts
import { OPEN_STEPS, askKeyboard, confirmKeyboard } from "./bot-onboarding";

describe("клавіатура відкритого питання", () => {
  it("посада має лише вихід до списку", () => {
    const rows = askKeyboard("spheres", "uk");
    expect(rows.flat().map((b) => b.callback_data)).toEqual(["ob:spheres:__list"]);
  });
  it("галузь необов'язкова, тож має ще й «Пропустити»", () => {
    expect(askKeyboard("industries", "uk").flat().map((b) => b.callback_data))
      .toEqual(["ob:industries:__next", "ob:industries:__list"]);
  });
  it("відкритих питань рівно три", () => {
    expect(OPEN_STEPS).toEqual(["spheres", "industries", "where"]);
  });
});

describe("клавіатура підтвердження", () => {
  it("дві кнопки: далі й виправити", () => {
    expect(confirmKeyboard("spheres", "uk").flat().map((b) => b.callback_data))
      .toEqual(["ob:spheres:__yes", "ob:spheres:__no"]);
  });
});
```

- [ ] **Крок 2:** Прогін → FAIL.
- [ ] **Крок 3:** Реалізувати `OPEN_STEPS`, `askKeyboard`, `confirmKeyboard` і слова
  `showList`, `yesNext`, `notRight` у чотирьох мовах.
- [ ] **Крок 4:** Прогін → PASS.
- [ ] **Крок 5:** Коміт `git commit -m "Клавіатури відкритого питання й підтвердження"`

---

### Задача 5: Текст підтвердження

**Файли:** Modify `web/src/lib/bot-onboarding.ts`, `web/src/lib/bot-onboarding.test.ts`

- [ ] **Крок 1: Тест, який падає**

```ts
import { confirmText } from "./bot-onboarding";

describe("підтвердження", () => {
  const draft = { ...emptyDraft(), customRole: "комуніті менеджер", spheres: ["devrel"] };
  it("показує слова людини й виведений напрям", () => {
    const t = confirmText("spheres", draft, [], "uk");
    expect(t).toContain("комуніті менеджер");
    expect(t).toContain("DevRel");
  });
  it("вставляє приклади вакансій", () => {
    const t = confirmText("spheres", draft,
      [{ title: "Community Manager", company: "Polygon" }], "uk");
    expect(t).toContain("Community Manager");
    expect(t).toContain("Polygon");
  });
  it("порожні приклади дають чесний рядок, а не мовчання", () => {
    const t = confirmText("spheres", { ...draft, customRole: "зззз" }, [], "uk");
    expect(t).toContain("нічого немає");
  });
});
```

- [ ] **Крок 2:** Прогін → FAIL.
- [ ] **Крок 3:** Реалізувати `confirmText(step, draft, samples, locale)`.
- [ ] **Крок 4:** Прогін → PASS.
- [ ] **Крок 5:** Коміт `git commit -m "Бот показує, що зрозумів"`

---

### Задача 6: Машина станів у bot.ts

**Файли:** Modify `web/src/lib/bot.ts`; Create `web/src/lib/bot-onboarding-flow.test.ts`

- [ ] **Крок 1: Тест переходів, який падає**

```ts
import { nextMode } from "./bot.js";

describe("режими кроку", () => {
  it("текст у ask веде до confirm", () => {
    expect(nextMode("ask", { parsedSomething: true })).toBe("confirm");
  });
  it("порожній розбір веде в кнопки, а не в порожнє підтвердження", () => {
    expect(nextMode("ask", { parsedSomething: false })).toBe("pick");
  });
  it("«Не те» веде в кнопки", () => {
    expect(nextMode("confirm", { rejected: true })).toBe("pick");
  });
  it("текст у confirm — це виправлення, знову підтвердження", () => {
    expect(nextMode("confirm", { parsedSomething: true })).toBe("confirm");
  });
});
```

- [ ] **Крок 2:** Прогін → FAIL.
- [ ] **Крок 3:** Реалізувати чисту `nextMode` і підключити її:
  - `handleOnboardingText`: у `ask`/`confirm` для `OPEN_STEPS` розбирати
    `parseProfile`, брати `sampleJobs(draft.customRole)` і показувати
    `confirmText`; при порожньому розборі — `pick` плюс рядок «Не впізнав».
  - `handleOnboardingButton`: `__list` → `pick`; `__yes` → `advance`;
    `__no` → `pick`.
  - `advance`: скидати режим у `ask` і для `OPEN_STEPS` малювати відкрите
    питання з `askKeyboard`, для решти — як зараз.
- [ ] **Крок 4:** Прогін усіх тестів `web/` → PASS.
- [ ] **Крок 5:** Коміт `git commit -m "Анкета веде розмову, кнопки лишились запасним виходом"`

---

### Задача 7: Перевірка на живих даних

**Файли:** Create `web/scripts/check-parse.mjs` (одноразовий, не комітиться)

- [ ] **Крок 1:** Вивантажити 18 справжніх `custom_role` із бази.
- [ ] **Крок 2:** Прогнати кожен через `parseProfile` і надрукувати
      таблицю «написано → виведена сфера → приклади вакансій».
- [ ] **Крок 3:** Звірити руками. «Комуніті менеджер» має дати `devrel`,
      а не `engineering`. Кожен рядок без прикладів — окремо перевірити чому.
- [ ] **Крок 4:** Хиби, знайдені прогоном, полагодити й дописати тест на кожну.

**Чому це окрема задача.** Зелені тести вже двічі пропускали хиби, які знайшов
лише прогін на справжніх рядках
(`feedback_nextrole_verify_parsers_against_live_feeds`).

---

### Задача 8: Деплой

- [ ] `git fetch origin && git merge-base --is-ancestor origin/main HEAD`
- [ ] Накотити `0041`, звіривши `schema_migrations` перед тим
- [ ] `npm run cf:deploy` у `web/`
- [ ] Пройти анкету в живому боті від `/start` до кінця, обома шляхами:
      текстом і через «Показати список»
