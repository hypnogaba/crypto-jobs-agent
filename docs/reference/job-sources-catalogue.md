# Каталог джерел вакансій

Усі ендпоінти нижче **перевірені живими запитами 2026-08-27**. Колонка «Статус» — це
реальний код відповіді того дня, не припущення.

Правило каталогу: **джерело, яке не працює, не викидається — воно замінюється.**
Для кожного заблокованого джерела в §6 записано, чим саме ми його перекриваємо.

Умовні позначення:
`✅` працює без ключа · `🔑` працює, потрібен безкоштовний ключ · `⚠️` API існує, треба валідний ідентифікатор компанії · `❌` заблоковано

---

## 1. ATS-API компаній — головний шар

Найцінніший шар. Дає **пряме посилання до роботодавця**, без посередника, з живою
формою подачі. Один запит = усі вакансії однієї компанії.

| Провайдер | Ендпоінт | Статус | Нотатки |
|---|---|---|---|
| **Greenhouse** | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false` | ✅ 200 | Перевірено на `anthropic`, `stripe`, `discord`. `content=true` додає опис |
| **Lever** | `GET api.lever.co/v0/postings/{slug}?mode=json` | ✅ 200 | Заголовок вакансії в полі `text`, **не** `title` |
| **Ashby** | `GET api.ashbyhq.com/posting-api/job-board/{slug}` | ✅ 200 | Посилання в `jobUrl`. Перевірено на `elevenlabs`, `ramp` |
| **SmartRecruiters** | `GET api.smartrecruiters.com/v1/companies/{slug}/postings` | ✅ 200 | Bosch віддав 4839 вакансій. Пагінація `limit`/`offset` |
| **Workday** | `POST {tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | ✅ 200 | NVIDIA — 2000 вакансій. Тіло: `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}`. Розблоковує великий ентерпрайз |
| **Workable** | `GET apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | ✅ 200 | Ендпоінт живий; порожній масив = у компанії немає відкритих позицій |
| **Breezy HR** | `GET {slug}.breezy.hr/json` | ✅ 200 | |
| **Personio** | `GET {slug}.jobs.personio.de/xml` | ✅ 200 | XML, не JSON. Сильний для DACH-ринку |
| **Rippling** | `GET api.rippling.com/platform/api/ats/v1/board/{slug}/jobs` | ✅ 200 | |
| **Recruitee** | `GET {slug}.recruitee.com/api/offers/` | ⚠️ | Схема відома, жоден із трьох пробних слагів не збігся — треба брати слаг зі сторінки кар'єри компанії |
| **Teamtailor** | `GET {slug}.teamtailor.com/jobs.rss` | ⚠️ | Те саме. Публічний JSON API вимагає токен компанії |
| **Comeet** | `GET comeet.co/careers-api/2.0/company/{uid}/positions` | ⚠️ | Потрібен UID компанії |
| **Pinpoint** | `GET {slug}.pinpointhq.com/postings.json` | ⚠️ | |

**Як росте цей список.** Компанія, знайдена через агрегатор і підтверджена через власний
ATS, автоматично додається у постійний список і надалі опитується прямо. Список джерел
розширює себе сам.

---

## 2. Агрегатори з відкритим API — без ключа

| Джерело | Ендпоінт | Статус | Нотатки |
|---|---|---|---|
| **Arbeitnow** | `GET arbeitnow.com/api/job-board-api` | ✅ 200 | ~1.5 МБ відповіді. Сильний для Європи/Німеччини |
| **Remotive** | `GET remotive.com/api/remote-jobs` | ✅ 200 | **Вимагає атрибуції** й живого лінка назад |
| **RemoteOK** | `GET remoteok.com/api` | ✅ 200 | **Перший елемент масиву — юридична нотатка, не вакансія.** Вимагає атрибуції |
| **Jobicy** | `GET jobicy.com/api/v2/remote-jobs?count=50&geo=&industry=` | ✅ 200 | Є фільтри по гео й індустрії прямо в API |
| **Himalayas** | `GET himalayas.app/jobs/api?limit=50&offset=0` | ✅ 200 | Курсорна пагінація |
| **Working Nomads** | `GET workingnomads.com/api/exposed_jobs/` | ✅ 200 | Простий масив |
| **Landing.jobs** | `GET landing.jobs/api/v1/jobs` | ✅ 200 | Європа, переважно IT. Є `currency_code`, зарплати |
| **The Muse** | `GET themuse.com/api/public/jobs?category=Software%20Engineering&page=1` | ✅ 200 | 20 488 сторінок. Категорії як фільтр |
| **Welcome to the Jungle** | `GET api.welcometothejungle.com/api/v1/organizations` | ✅ 200 | Франція та ЄС |
| **a16z speedrun talent network** | `GET speedrun-talent-network.com/api/v1/jobs?scope=everywhere&sort=new&page=N&source=nextrole` | ✅ 200 | Єдине джерело з ВЛАСНОЮ специфікацією OpenAPI і MCP-сервером. 48 159 ролей, 15 070 із вилкою, 800 компаній. Подробиці — §10 |
| **Hacker News «Who is hiring»** | `GET hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring` → `items/{id}` | ✅ 200 | Коментарі у форматі `Компанія \| лінк \| ролі \| локація` |

---

## 3. RSS-стрічки — стабільні й не блокуються

RSS часто виживає там, де HTML під захистом. Дешевий і надійний шар.

| Джерело | Стрічка | Статус |
|---|---|---|
| **We Work Remotely** | `weworkremotely.com/remote-jobs.rss` | ✅ 200 |
| **Jobspresso** | `jobspresso.co/?feed=job_feed` | ✅ 200 |
| **NoDesk** | `nodesk.co/remote-jobs/index.xml` | ✅ 200 |
| **CryptocurrencyJobs** | `cryptocurrencyjobs.co/index.xml` | ✅ 200 |
| **Remote.co** | `remote.co/remote-jobs/feed/` | ⏳ таймаут | Повільний, потрібен довший тайм-аут або пропуск |

---

## 4. Потрібен безкоштовний ключ

Варті реєстрації — вони дають обсяг, який безключові джерела не дають.

| Джерело | Що дає | Ліміт безкоштовного тарифу |
|---|---|---|
| **Adzuna** | Агрегує 16+ країн, у т.ч. інвентар Indeed | ~250 запитів/добу, ключ миттєво |
| **Reed.co.uk** | Британський ринок, великий обсяг | Безкоштовний ключ |
| **Jooble** | 70+ країн | Ключ через форму |
| **Findwork.dev** | IT-специфічний | Безкоштовний токен |
| **USAJobs** | Держсектор США | Безкоштовний ключ |
| **Careerjet** | Партнерський API, 90 країн | Партнерський ID |

---

## 5. Web3 / екосистемні борди

| Джерело | Ендпоінт | Статус | Нотатки |
|---|---|---|---|
| **Getro** | `POST api.getro.com/api/v2/collections/{id}/search/jobs` | ✅ 200 | **Обов'язковий заголовок `Accept: application/json`, інакше 406.** Solana = колекція 858. Кожен фонд/екосистема має свій id — їх треба зібрати окремо |
| **CryptocurrencyJobs** | `cryptocurrencyjobs.co/index.xml` | ✅ 200 | |
| **CryptoJobsList** | `cryptojobslist.com/feed.xml` | ❌ 403 | Перекривається Getro + CryptocurrencyJobs |
| **Web3.career** | RSS немає | ❌ 404 | Але `web3.career/sitemap.xml` віддає 200 — обхід через sitemap |

> **Важлива нотатка про Getro.** Раніше це джерело вважалося мертвим саме через 406.
> Причина була не в блокуванні, а у відсутньому заголовку `Accept`. Не «виправляти» назад.

---

## 6. Заблоковані — і чим ми їх перекриваємо

Жодного скрапінгу HTML із-під захисту. Для кожного — заміна.

| Джерело | Що саме | Чим перекриваємо |
|---|---|---|
| **LinkedIn** | HTML без API, агресивний блок | Компанію бачимо будь-де → вакансію беремо з її **власного ATS**. Лінк тільки живий, ніколи не вигаданий |
| **Indeed** | 403, API закрито у 2023 | **Adzuna** перепродає значну частину того самого інвентарю |
| **Glassdoor** | 403 | Публічного API не існує в принципі. Не заміняємо — це не джерело вакансій, а відгуків |
| **Dice** | 403 | Adzuna + The Muse покривають ринок США |
| **Wellfound (AngelList)** | Тільки JS-рендер | Getro + YC-екосистема + HN покривають стартапи |
| **Otta** | За логіном | Те саме |
| **Startup.jobs** | 403 | HN «Who is hiring» + Getro |
| **YC Work at a Startup** | 406 на `companies.json` | HN-тред YC-компаній + прямі ATS цих компаній |
| **Arbeitsagentur (DE)** | 403 на публічному ключі | Arbeitnow + Personio закривають DACH |
| **EURES (ЄС)** | Ендпоінти 404, API перебудували | Landing.jobs + Welcome to the Jungle + Arbeitnow |

---

## 7. Скільки це дає разом

| Шар | Робочих джерел | Тип покриття |
|---|---|---|
| ATS-API | 9 працюють + 4 з ідентифікатором | Пряме, по компаніях, необмежено зростає |
| Агрегатори без ключа | 11 | Широке, ринкове |
| RSS | 4 | Резервне, стійке до блокувань |
| З безкоштовним ключем | 6 | Обсяг по країнах |
| Web3 | 2 + sitemap-обхід | Ніша |

**Разом 32 робочі джерела** без жодної платної підписки, і ATS-шар росте сам із кожним
знайденим роботодавцем.

---

## 8. Правила роботи з джерелами

1. **Зламане джерело ≠ порожнє джерело.** Коди 401/402/403/404/406/410/429 і
   Cloudflare-заглушка означають «недоступне». Такий день ніколи не рахується як «вакансій
   немає».
2. **Два дні поспіль недоступне → позначається `deprecated` і замінюється.**
3. **Ніякого HTML-скрапінгу з-під захисту.** Якщо джерело закрите — шукаємо API,
   RSS, sitemap або альтернативу.
4. **Тільки живі посилання.** Рядок без робочого URL викидається до того, як його побачить
   людина.
5. **Атрибуція там, де її вимагають** (RemoteOK, Remotive) — інакше доступ ріжуть.

---

## 9. Розвідка по твіттеру, 2026-08-30

Джерела шукались не питанням «які є дошки», а хештегами живих оголошень
(`#hiring`, `#jobs`, `#remotejobs`, ще 21). Причина: перше дає треди-поради,
друге — посилання на дошки, якими справді користуються. Зібрано 3 531 твіт зі
120 запитів, розгорнуто 3 562 скорочення `t.co`, отримано 505 доменів.

**Дві пастки самого API 6551.** Порожня відповідь означає ліміт частоти, а не
«нічого не знайшлось»: той самий запит через секунди віддає 50 рядків. І
`t.co` віддає чесний `301` лише не-браузерному клієнту — браузерному він
показує сторінку з `location.replace()`, тож `urllib` повертає ту саму
`t.co`-адресу, і в першому прогоні всі 1 040 «доменів» були `t.co`.

### Додано (перевірено `scanner/src/probe-board.js`)

| Дошка | Стрічка | Кому | Дала при перевірці |
|---|---|---|---|
| **GermanTechJobs** | `germantechjobs.de/rss` | DE | 751 із 753 |
| **Startups North** | `startupsnorth.ca/feed.xml` | CA | 50 із 50 |
| **Remotech** | `remotech.ai/jobs/rss.xml` | всім | 100 із 100 |
| **Remote Backend Jobs** | `remotebackendjobs.com/feed.xml` | всім | 50 із 50 |
| **Hireeing** | `hireeing.com/rss.xml` | всім | 50 із 50 |
| **We Love Product** | `weloveproduct.co/feed.xml` | всім | 32 із 32 |

Дві з них зажадали нових взірців заголовка (див. `parseBoardTitle`):
`Роль @ Компанія [60.000 - 85.000 €]` і `Роль job by Компанія | Місто | Дошка`.
До цього GermanTechJobs давав 53 рядки, у яких компанією ставала половина
назви посади, — а не 751.

### Відхилено, з причиною

| Джерело | Чому |
|---|---|
| `dynamitejobs.com`, `greatwork.jobs`, `itjobpro.com` | стрічка блогу, не вакансій. За числами виглядали здоровими: 138 елементів, 37 «розібрано» |
| `vuejobs.com`, `reed.co.uk`, `remotewoman.com`, `servicedesignjobs.com`, `careersingovernment.com` | у заголовку немає компанії — розбір дає нуль |
| `remoteornothing.com`, `pmrecruitment.co.za`, `vacancymail.co.zw` | не наші сфери: сантехніки, оцінювачі нерухомості |
| `findweb3.com`, `itjobs.pt` | `403` — правило 3 §8 |
| `infosec-jobs.net/api/jobs`, `unchaindata.xyz/api/jobs`, `skillcareerhub.com/api/jobs` | живий JSON, але `fetchBoard` читає лише RSS. Варті `kind='api'`, коли він з'явиться |
| `app.careerarc.com` | не дошка, а сервіс розсилки оголошень |
| `*.web.app`, `*.vercel.app`, `*.manus.space` | разові сторінки під один твіт |

### Знайдено побічно

- `board:global-web3career` спершу здався мертвим і був вимкнений — **помилково**.
  Перевіряч пробував лише RSS, а ця дошка читається розміткою JobPosting
  (`kind='jsonld'`, додано паралельно в 0019). RSS-шлях і мусив віддати нуль.
  Дошку ввімкнено назад, вона дає 18 вакансій. Звідси `--kind` у
  `probe-board.ts`: «нуль» означає «нуль у цьому форматі», а не «дошка мертва».
- У власній стрічці **Remote3** лежать тестові записи їхньої команди —
  `__probe_job__ at undefined`, `__xsschain_job__`, посилання на
  `/remote-jobs/null`. Два з них доїхали до нашого кеша й були видимі людині.
  Звідси `isJunk()` у `boards.ts`.
- Remote3 пише компанію двічі: `… at Bybit at Bybit`. Поділ по ПЕРШОМУ ` at `
  давав компанію «Bybit at Bybit» — п'ять таких рядків лежали в кеші. Тепер
  ділимо по останньому, як і по останньому « в » для DOU.

---

## 10. Мережа талантів a16z speedrun — джерело, яке саме себе документує

`speedrun-talent-network.com`. **Усе нижче перевірено живими запитами 05.09.2026.**

Перше джерело в каталозі, до якого не довелось шукати підхід: у нього є сторінка
`/developers`, версійований REST `/api/v1`, повна специфікація **OpenAPI 3.1** за
адресою `/api/v1/openapi.json` і **власний MCP-сервер**. Без ключа, без реєстрації,
відкритий CORS, відповіді кешуються на межі 1–5 хвилин. Ми не обходимо захист і не
розбираємо верстку — читаємо задокументований інтерфейс.

### Що там лежить

| Скільки | Чого |
|---|---|
| 48 159 | ролей у `scope=everywhere` (портфель a16z — 18 502, сам speedrun — 153) |
| 15 070 | ролей із **названою вилкою** — у нашому кеші вилку має заледве кожна сьома |
| 800 | компаній: 281 `a16z`, 480 `market`, 39 `speedrun` |
| 52 | куровані колекції: галузі, міста, інвестори, сигнали |

### Ендпоінти

| Ендпоінт | Що віддає |
|---|---|
| `GET /api/v1/jobs` | Пошук ролей: `q, fn, sen, emp, loc, remote, comp, portfolio, cohort, company, stealth, scope, sort, page`. Плюс лічильники фасетів і `total` |
| `GET /api/v1/jobs/{id}` | Одна роль: `description_text` цілком і **`apply.url` — адреса справжнього ATS роботодавця** |
| `GET /api/v1/companies` | Усі роботодавці з відкритими ролями, по 100 на сторінку |
| `GET /api/v1/companies/{slug}` | Профіль компанії плюс усі її живі ролі |
| `GET /api/v1/collections` · `/{slug}` | Колекції й ранжовані компанії в них |
| `GET /api/v1/stats/hiring` | Зведення: попит за функціями, вилки p25/median/p75, частка віддалених, топ міст |
| `GET /api/v1/openapi.json` | Специфікація |

MCP: `https://mcp.speedrun-talent-network.com/mcp` (streamable HTTP, без авторизації),
десять інструментів — від `search_jobs` до `join_network`. Сканеру він не потрібен —
REST дає те саме, — але для роботи руками підключається одним рядком:
`claude mcp add --transport http speedrun-talent https://mcp.speedrun-talent-network.com/mcp`.

### Як ми це читаємо

**Щодня, `aggregator:speedrun`** (`scanner/src/sources/speedrun.ts`). Розмір сторінки
жорсткий — 50, параметра немає взагалі; `page` не більше 200, тобто 10 000 ролей на
запит. Нам стільки не треба: при `sort=new` свіжі чотирнадцять днів займають **35
сторінок**. Гортання спиняє дата, а не стеля — щойно хвіст сторінки старший за межу,
далі буде лише старіше.

Живий прогін 05.09: **1 750 ролей за 44 с → 1 576 після свіжості й дедупу, з них 36%
із вилкою, 191 різна компанія.**

**Щотижня, `discover-speedrun.ts`** — головний виграш. У списку ролей посилання ведуть
на сам борд, але деталь ролі віддає `apply.url`, і це вже `job-boards.greenhouse.io/…`
чи `jobs.ashbyhq.com/…`. Тобто компанія, знайдена тут один раз, далі опитується прямо
й віддає ВСІ свої вакансії, а не лише ті, що потрапили в чужу добірку.

Врожай виміряно на трьох вибірках по сорок компаній кожного рівня:

| Рівень | Компаній | Точний ATS | Що в промахах |
|---|---|---|---|
| `a16z` | 281 | **40 із 40** — ashby 23, greenhouse 14, lever 3 | нічого |
| `market` | 480 | 19 із 40 | 20 — Workday (Walmart, CVS, P&G), 1 — власний сайт |
| `speedrun` | 39 | 0 із 40 | подача йде на самому борді |

Нуль на рівні `speedrun` — не поразка, а знахідка: **для цих тридцяти дев'яти компаній
мережа не передрук, а ОРИГІНАЛ**, як DOU для України. Їхніх ролей більше немає ніде,
і беремо ми їх щоденним `aggregator:speedrun`.

Для порівняння: R4 вгадує слаг із назви компанії й влучає в 45 випадках зі ста.

Запускається руками або таймером на VPS (юніти живуть там, не в репо — як і решта
`nextrole-*`), поруч із недільною розвідкою Getro:

```
npm run build && npm run discover-speedrun          # бюджет за замовчуванням — 300 компаній
node dist/discover-speedrun.js 800                  # весь список за раз
```

Бюджет — це скільки НЕВІДОМИХ нам компаній перевірити за прогін; два запити на кожну.
Уже відомі пропускаються без жодного запиту.

### Ніша компанії

Мітки галузей у них свої, не Getro-ві, тому й перелік свій (`mapSpeedrunIndustries`).
Звірено з **повним словником усіх 800 компаній** — 38 різних міток, і кожна, яка НЕ дає
тегу, теж закріплена тестом. Дає нішу 459 компаніям: ai 207, fintech 145, health 105,
web3 37, games 13, ecommerce 3, defence 1.

Свідомо не мапиться **«American Dynamism»** (126 компаній): це власна рубрика a16z, і
оборона в ній лише частина — туди ж потрапляють виробництво, енергія, освіта й житло.
Тег усім ста двадцяти шести був би тим самим правдоподібним правилом, яке ми вже двічі
викидали. Справжню оборону дає колекція `defense` — там її десять, названих поіменно.

### Пастки, кожна коштувала б мовчазної поразки

1. **Деталь ролі загорнута в `job`, а список — ні.** Перша версія читала верхній рівень
   і на двадцяти живих компаніях поспіль повертала «ATS невідомий» при тому, що адреса
   Greenhouse була в кожній відповіді. Зелені юніт-тести цього не бачили.
2. **`comp_period` буває чотирьох видів**, і всі чотири трапляються: `null` у 561 рядку
   з 600, `hour` у 21, `year` у 16, `month` у 2. Порожній означає рік — і це не здогад
   за величиною: серед 156 порожніх найменша сума 71 000, найбільша 400 000, і жодної
   нижче дванадцяти тисяч. Усі малі числа приходять із чесно названим `hour`. Без
   множника «24 USD/hour» стало б вакансією на 24 долари на рік.
3. **`workplace_type` пишеться і `OnSite`, і `Onsite`.** Плюс один рядок із 600 має
   `remote: true` при `workplace_type: "OnSite"` — коли джерело сперечається саме з
   собою, перемагає конкретніше поле.
4. **Дата приходить у двох виглядах одночасно**: `…-04:00` і `…298Z`, обидва в одній
   відповіді.
5. **`scope=everywhere` у свіжому вікні дорівнює `portfolio`** — сторінки 0, 20 і 34
   збіглися id-в-id. Усі 29 657 ролей «поза портфелем» опубліковані давніше за наші
   чотирнадцять днів. Ширина зараз нічого не додає й нічого не коштує.
6. **Приховані компанії (`stealth`)** мають замасковану назву й компанію «Stealth».
   Параметра, що знімає маску, немає й не передбачено — такі рядки відкидаємо.

### Атрибуція

`?source=nextrole` передається на кожному запиті: вони про це просять, і параметр
ставить `utm_source=nextrole&utm_medium=agent` на кожне посилання ролі. Тому utm ми
**не зрізаємо** — це правило 5 §8, те саме, що для RemoteOK і Remotive.

### Запас, якщо API колись закриють

`speedrun-talent-network.com/jobs.rss` — сто найновіших ролей у заголовках виду
«Роль at Компанія». Перевірено нашим власним читачем: **100 зі 100 розібрано без
жодного рядка коду**, достатньо рядка в `country_boards` з `kind='rss'`. Плюс
`/sitemaps/jobs.xml` (18 502 адреси) і `/sitemaps/companies.xml` (800), а на кожній
сторінці ролі лежить розмітка `JobPosting` — тобто наш `kind='jsonld'` теж підходить.

---

## 11. Крипто-покриття для NextCryptoJob, 2026-09-13

Кеш спільний: NextCryptoJob читає з `jobs_cache` лише рядки з тегом `web3`. Усе нижче
перевірено живими запитами 13.09.2026; код у `scanner/src/crypto-sources.ts`, дані в
міграції `0047_ncj_crypto_sources.sql` (генерується з того ж файлу).

### Що змінилось у скані

| Що | Як | Вимикач |
|---|---|---|
| Вікно свіжості для `web3` | 30 днів замість 14 (`prepare`). NextRole тримає свої 14 на читанні: `nextrole-window.ts`, та сама умова, що була на записі | `CRYPTO_FRESHNESS_DAYS=14` |
| Вилка з полів ATS | Greenhouse `pay_transparency=true`, Ashby `includeCompensation=true`, Lever `salaryRange` будь-якого періоду, Recruitee `salary`, Getro `compensation_*`. Період у річний: `pay.ts` | `ATS_PAY=0` |
| Getro | Щоденний скан Getro не читає. Щотижня (`nextrole-getro-ats`, Нд 05:00) з колекцій береться лише посилання на ATS роботодавця, вакансії йдуть з API самого ATS | `GETRO_MODE=hybrid` або `jobs` |
| speedrun | Крипто-компанії мережі (галузь «Crypto/Web3» плюс колекція `crypto-web3`, 36 компаній) дістають тег `web3` і читаються з вікном 30 днів через `/companies/{slug}` | `SPEEDRUN_CRYPTO=0` |
| Європейський Lever | провайдер `lever_eu` (`api.eu.lever.co`): Aave Labs, Kaiko | |
| `extractAts` | крапка й `%20` у слагу Ashby (`kraken.com`, `Sui%20Foundation`), вбудована форма Greenhouse `?for=`, Recruitee, `jobs.eu.lever.co` | |

### Getro: чому лише розвідка

Умови Getro (https://www.getro.com/terms, версія 3.1, червень 2025) поширюються на
«any job board operated by Getro» і забороняють те, що «“Crawls,” “scrapes,” or “spiders”
any page, data, or portion of or relating to the Services or Content». `api.getro.com/robots.txt`
віддає `Disallow: /`, а борди на curl відповідають пропозицією платного API (api@getro.com).

Режим `discover` зменшує звернення до Getro вп'ятеро (раз на тиждень замість щодня) і не
кладе в кеш жодної вакансії, взятої з Getro. Ризик не нульовий: тижневий збір посилань теж
читає колекції. Нуль звернень: не вмикати `nextrole-getro-ats.timer` і вимкнути
`nextrole-discover.timer` (перебір id колекцій); компанії, уже зібрані з Getro, лишаються в
`companies` і далі читаються з їхнього ATS.

Скільки коштує `discover` (скан насухо 13.09, ті самі живі відповіді):
- з 518 крипто-рядків Getro 360 (70%) приходять тими самими вакансіями з ATS роботодавця;
  решта веде на LinkedIn (65), Notion (13), Workday (12), Phenom (Circle), Pinpoint, Comeet,
  власні сайти;
- для NextRole по всіх нішах: з 1 288 рядків Getro через ATS приходять 473; втрачається
  близько 790 унікальних вакансій на скан (3,6% його видимого пулу), переважно з
  не-крипто колекцій (Munich Re 163, Workday 108, LinkedIn 100, FIS 68, ізраїльські сайти);
- `hybrid` повертає майже все (втрата 65 унікальних), але читає Getro щодня, як і раніше.

Помилка 11.09 (колекції Coinbase 1625 і Electric 1640 зникли з кешу): 429 посеред гортання
викидав усе прочитане, а 429 за правилом не записується як падіння, тож у панелі обидві
стояли «ok». Тепер прочитане лишається, між сторінками пауза 250 мс.

### Умови інших дощок (перевірено 13.09)

| Дошка | Рішення | Підстава |
|---|---|---|
| crypto-careers.com | **вимкнено** (0047) | https://www.crypto-careers.com/terms: «you will not reproduce, duplicate, copy, crawl, scrape…», «Conduct any systematic or automated data collection… without… express written consent». RSS немає. За весь час не дала жодного рядка |
| remote3.co | лишається, лише RSS | https://www.remote3.co/terms забороняє «automated searches, requests, or queries»; ми читаємо їхній власний `/api/rss` (8 позицій). Не мертва: 8 позицій старші за 14 днів і відсіювались; з вікном 30 днів повертаються |
| cryptocurrencyjobs.co | лишається, лише RSS; **ризик** | https://cryptocurrencyjobs.co/terms/ забороняє «scrape», «crawl» і «Republish in bulk any information derived from use of our Website»; RSS `/index.xml` вони пропонують самі. Рішення за власником |
| web3.career | лишається як є; **ризик** | Сторінка умов за Cloudflare, прочитати не вдалось. Офіційний шлях: безкоштовний Web3 Jobs API з токеном (https://web3.career/web3-jobs-api, документація docs.bondex.app), умова: посилання `apply_url` без змін і без nofollow. З вікном 30 днів наша дошка гортає глибше (717 крипто-рядків на скан проти 398). Рекомендація: отримати токен і перейти на API, там же рольові стрічки (`tag=`): DevRel, community, KOL |
| web3.career рольові сторінки | **не додано** | умови не підтверджені; той самий вміст дає офіційний API |
| cryptojobslist.com | **не додано** | https://cryptojobslist.com/terms (копія Wayback 01.02.2026): «Republish in bulk», «scrape», «crawl» заборонені; RSS є, але без дат. Із 100 позицій RSS 90 від компаній, які ми вже читаємо з їхнього ATS |
| Superteam Earn | **не додано в спільний кеш** | Умови не забороняють (8.1.7 забороняє ботів лише для збору імен і пошт), robots запрошує агентів до API. Але це баунті, а не вакансії: у спільному кеші вони пішли б і в добірки NextRole. Краще читати напряму в NextCryptoJob як окремий тип |
| JobStash | лишається | умови порожні, robots `Allow: /`. Вилка на картках це ринкова статистика (`medianMonthlyUsd`, `sampleCount`), а не зарплата вакансії, тому її свідомо не беремо |
| Consider (Pantera, Hashed; дані a16z crypto і Paradigm) | **не додано** | https://consider.com/legal/terms (l): «use any robot, spider, scraper, or other automated means… without our express written permission»; API за CSRF. Портфель a16z доступний через speedrun API |
| speedrun-talent-network.com | лишається, розширено | https://speedrun-talent-network.com/developers: «Reads are open and unauthenticated», `?source=` і посилання на їхній `url` |

### Роботодавці (0047)

82 дошки на публічних ATS, кожна звірена з сайтом компанії: екосистеми й фундації
(Ethereum Foundation, Optimism Foundation, Sui Foundation, Aptos Foundation, NEAR, Cosmos
Labs, Starknet Foundation, Celestia, Injective Labs, Sei Labs, Hyperliquid Labs, Aztec,
Hashgraph, Tools for Humanity, World Foundation, Monad Foundation), біржі й інфраструктура
(Kraken, Galaxy Digital, Tether, Gate, Nexo, Bitvavo, Uphold, Luno, SatoshiLabs, Lightning
Labs, Ether.fi, Aave Labs, Lido), аналітика й комплаєнс (TRM Labs, Chainalysis Government
Solutions, Merkle Science), аудит (Trail of Bits, Halborn, Sigma Prime, Hexens, Quantstamp),
маркет-мейкери (B2C2, Flowdesk, Auros, Selini, QCP, Presto Labs, Caladan, Amber Group, Jump
Crypto) та інші. Повний список з доказом для кожної: `crypto-sources.ts`.

Мертві слаги, які старий збір посилань різав на крапці, замінено: `kraken` → `kraken.com`,
`monad` → `monad.foundation`, `lido` → `lido.fi`, `sui` → `Sui%20Foundation`, `tools` →
`Tools%20for%20Humanity`, `asymmetric` → `asymmetric.re`, `dourolabs` → `dourolabs.xyz`,
`li` → `li.fi`, `nexus` → `nexus.xyz`, `sound` → `sound.xyz`; `trmlabs` → `ashby:trm-labs`.

**Однофамільці, яких не брати** (усі перевірено): `rippling:kraken-robotics-inc` (морська
робототехніка), `ashby:cantina` (відеозастосунок; аудит-фірма Cantina наймає через Loxo),
`ashby:circle` (circle.so; Circle з USDC на Phenom), `lever:safe` (Safe Security),
`greenhouse:galaxy` (монтаж охорони), `ashby:base` (консьєрж-сервіс; Base від Coinbase це
`greenhouse:basejobs`), `ashby:compound`, `ashby:espresso` (Espresso AI), `ashby:ramp`,
`ashby:casa`, `ashby:mantle`, `ashby:swan`, `ashby:render`, `ashby:maple`, `ashby:gelato`,
`ashby:jump`, `greenhouse:axiom`, `greenhouse:orca`, `greenhouse:status`, `greenhouse:grayscale`
(тестова дошка), `personio:kaiko` і `personio:scroll` (демо з lorem ipsum),
`smartrecruiters:binance` (підозрілі оголошення; справжній `lever:binance`). З трьох перших
тег `web3` знято в 0047.

**Не на публічному ATS** (записано, щоб не шукати вдруге): Solana Foundation (лише борд
екосистеми й Google Forms), TON, StarkWare, Jupiter, Backpack і Zellic (Notion), Flashbots
(Notion), Circle (Phenom), Cantina/Spearbit (Loxo), dYdX → Arcus (Gem), Berachain (Polymer),
Bitget, KuCoin, HTX, MEXC (власні сайти), Bullish (Workday), Blockaid і Hypernative (Comeet),
Crossmint (Teamtailor, є RSS), VALR і Mythical (HiBob), Chainlink Labs (дошка Ashby жива, але
її posting API віддає 404).

### Результат (скан насухо 13.09, пул NextCryptoJob за його ж правилами)

| | До | Після |
|---|---|---|
| Пул (web3, не з не-крипто списку, роль у назві) | 1 462 | 2 048 |
| Унікальні компанія + назва | 1 128 | 1 705 |
| З вилкою (унікальні) | 404 (35,8%) | 772 (45,3%) |
| Компаній | 342 | 417 |
| Записів D1 за скан (оцінка) | 45 203 | 45 437 |

DevRel лишився нулем: серед 2 373 крипто-рядків скану немає жодної посади Developer
Relations. Цю роль закриває лише рольова стрічка web3.career (через їхній API).
