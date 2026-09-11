# «Де працювати»: місто означає це місто. План реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** офіс лише в названому місті, віддалені лише не закриті в чужій країні, «переїзд» прибрано, живі профілі переведено, люди отримують нові добірки сьогодні.

**Architecture:** рішення «чи доходить вакансія» живе в `reachable()` сканера; порядок у `pickTop()`; вікно кандидатів у `fetchCandidateRows()`. Словник режимів дубльовано у `web/src/lib/vocab.ts` і в `scanner/src/match.ts` (сканер не імпортує web). Старі id читаються як синоніми в обох місцях, тож деплої сканера, сайту й міграція бази незалежні за порядком.

**Tech Stack:** TypeScript, vitest, Cloudflare D1, Next (web на Workers), сканер на VPS (build + rsync).

Специфікація: `docs/superpowers/specs/2026-09-11-city-strict-where-design.md`.

---

### Task 1: режими й міста в сканері

**Files:** Modify `scanner/src/match.ts` (верх файлу, `reachable`, `scoreJob` географія, `pickTop` коло нульове, `explainLocally`). Test `scanner/src/match.test.ts`.

- [ ] Тести (падають): `describe("місто означає це місто")` з профілем `{ remoteMode: "remote,city", location: "Paris", locationEn: "Paris", country: "FR" }`:
  - `reachable(office("Paris, France"))` true; `office("Lyon, France")` false; `office("Tokyo, Japan")` false; `office(null)` false; `office("Wallingford, Oxfordshire")` false; `office("La Défense, Île-de-France")` true; `office("Boulogne-Billancourt")` true.
  - `remote("Remote")` true; `remote("Remote, Europe")` true; `remote("Remote, France")` true; `remote("Remote, Japan")` false; `remote("Tokyo")` false.
  - лише `city`: `remote("Remote")` false, `remote("Paris (Remote)")` true.
  - лише `remote`: офіс без локації true (правило 03.09 лишається), `office("Paris")` false.
  - кілька міст: `location: "Bratislava, Vienna"` → `office("Vienna, Austria")` true, `office("Graz, Austria")` false.
  - місто-як-країна: `location: "France"` → `office("Lyon, France")` true, `office("Berlin")` false.
  - синоніми: `remote_only` = `remote`; `remote_or_city` і `relocate` = `remote,city`.
  - `pickTop`: 3 сильні паризькі + 5 сильніших віддалених → паризькі перші в результаті; паризька слабша за найкращу на >6 не бере місце.
- [ ] Реалізація:
  - `modesOf(raw): Set<"remote"|"city">` із `LEGACY_MODES`; порожнє → `remote`.
  - `citiesOf(p)`: `cityText(p)` ріжеться за `,;/|` і сполучниками; шматок, що є назвою країни/регіону (`isCountryOrRegion` з `places.ts`), містом не є.
  - `SAME_CITY` групи (екзоніми + передмістя Парижа); `inCity(location, cities)` порівнює без діакритики, дефіс = пробіл, межі слів.
  - `reachable`: `city && inMyCity` → true; `remote && job.remote` → `placeFit !== "miss"`; лише `remote` і локації немає → true; інакше false.
  - `scoreJob`: бонус міста +4 як був; прибрати `willRelocate`; `onsite −6` лише для «тільки віддалено».
  - `pickTop`: якщо є міста — коло нульове бере вакансії з міста (з межею `strong`) без стелі 2; інакше старий резерв країни. Кінцевий порядок: спершу з міста, далі за балом.
- [ ] Переписати тести, що закріплювали старе («Wallingford проходить», `relocate` у `scoreJob`), з поясненням.
- [ ] `cd scanner && npx vitest run && npx tsc --noEmit` зелене. Коміт.

### Task 2: вікно кандидатів ставить місто вперед

**Files:** Modify `scanner/src/digest.ts` (`fetchCandidateRows`), новий `citySql` поруч з `roleSql`. Test `scanner/src/digest.test.ts`.

- [ ] Тест: `citySql` для Парижа дає `LOWER(j.location) LIKE ?` з `%paris%` і передмістями; без `city` → `{ sql: "0", params: [] }`.
- [ ] `SELECT j.*, role AS by_role, city AS by_city, ROW_NUMBER() OVER (PARTITION BY j.company_key ORDER BY role DESC, city DESC, posted_at DESC, fetched_at DESC)`; зовнішній `ORDER BY by_role DESC, by_city DESC, posted_at DESC, fetched_at DESC`. Параметри: `[...role, ...city, ...role, ...city, ...topic, ...mine, userId, userId]`.
- [ ] Тести зелені. Коміт.

### Task 3: словник, анкета, бот

**Files:** `web/src/lib/vocab.ts`, `web/src/app/profile-form.tsx`, `web/src/app/actions.ts`, `web/src/lib/parse.ts`, `web/src/lib/bot.ts`, `web/src/lib/bot-onboarding.ts`, `web/src/lib/i18n.ts` + їхні тести.

- [ ] `REMOTE_MODES` = `remote` («Віддалено»), `city` («В офісі в моєму місті»), 4 мови. `parseModes` розгортає `LEGACY`; `toggleMode` без виключності; `needsCity` = є `city`.
- [ ] Форма: скрипт без виключності, `need` = обрано `city`; підказка «Офіси шукаємо лише в цьому місті. Можна кілька через кому.»
- [ ] Бот: питання міста «У якому місті офіс? Прийдуть лише вакансії з цього міста. Можна кілька через кому.»; «Інше місце» додає `city`; замовчування `remote` (усі п'ять місць з `"remote_only"`).
- [ ] `parse.ts`: переїзд → `remote,city`; віддалено → `remote`; промпт моделі описує `remote` і `city`; відповідь моделі проходить через `parseModes`.
- [ ] Тести web оновлено; `cd web && npx vitest run && npx tsc --noEmit` зелене. Коміт.

### Task 4: міграція профілів

**Files:** Create `db/migrations/0046_remote_mode_remote_city.sql`.

- [ ] `UPDATE profiles SET remote_mode = CASE … END` за таблицею специфікації (порівняння по наборах: будь-який рядок із `remote_or_city` чи `relocate` → `remote,city`; лише `remote_only` → `remote`; уже нові лишаються).
- [ ] Коміт.

### Task 5: деплой і прогін

- [ ] `git fetch`; злити `origin/main`, якщо рушив; усі тести.
- [ ] Прогін ДО (`replay.js --json was.json`) зі старим `dist` на VPS.
- [ ] Сканер: `npm run build`, rsync `dist/` у `/opt/nextrole-scanner/dist` (зберегти `dist.bak.<ts>`).
- [ ] Резервна копія `profiles(user_id, remote_mode, location)` у файл; міграція 0046 на живій базі.
- [ ] Web: звірити прод із `main`, `cf:deploy`.
- [ ] Прогін ПІСЛЯ з `--baseline was.json`: 0 вакансій з чужих країн і з інших міст; окремо профіль зі скаргою.
- [ ] Злиття в `main`, push.
