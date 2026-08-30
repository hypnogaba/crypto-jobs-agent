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
| Агрегатори без ключа | 10 | Широке, ринкове |
| RSS | 4 | Резервне, стійке до блокувань |
| З безкоштовним ключем | 6 | Обсяг по країнах |
| Web3 | 2 + sitemap-обхід | Ніша |

**Разом 31 робоче джерело** без жодної платної підписки, і ATS-шар росте сам із кожним
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

- `board:global-web3career` стояв увімкненим зі стрічкою `https://web3.career/` —
  це головна сторінка, нуль елементів. Вимкнено. У §5 це вже було записано
  («Web3.career: RSS немає»), але в базу воно все одно потрапило.
- У власній стрічці **Remote3** лежать тестові записи їхньої команди —
  `__probe_job__ at undefined`, `__xsschain_job__`, посилання на
  `/remote-jobs/null`. Два з них доїхали до нашого кеша й були видимі людині.
  Звідси `isJunk()` у `boards.ts`.
- Remote3 пише компанію двічі: `… at Bybit at Bybit`. Поділ по ПЕРШОМУ ` at `
  давав компанію «Bybit at Bybit» — п'ять таких рядків лежали в кеші. Тепер
  ділимо по останньому, як і по останньому « в » для DOU.
