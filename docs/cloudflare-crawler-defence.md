# Захист від краулерів — що робиться в дашборді Cloudflare

Код цього не вміє. Worker відповідає **після** того, як запит уже прийнято й порахо­вано,
тому єдине місце, де краулера можна зупинити безкоштовно, — край мережі, до Worker.

Зона: `nextrole.info` (`e0a383837102d6e83d62c8a1ffe60c10`), план **Free**.

---

## Чому саме так

Перевірено в документації Cloudflare:

| Тип запиту | Рахується як Worker-запит | Наслідок |
|---|---|---|
| Заблокований на WAF | **ні** | краулер коштує $0 |
| Статичний файл із assets | **ні** — «free and unlimited» | людина коштує $0 |
| Влучив у кеш перед Worker | **так** (CPU=0) | кеш ріже CPU, але не кількість запитів |
| SSR | так | найдорожче |

Тобто кешування **не рятує** від ботошторму — рятує тільки блокування на краю
або віддача статикою. Нижче — перше.

---

## 0. Спершу з'ясувати тариф Workers

Dashboard → Workers & Pages → Plans.

- **Free** — стеля 100 000 запитів/добу, після неї сайт віддає помилку 1027.
  Тоді все нижче терміново.
- **Paid** — стелі немає, платимо за запити. Тоді все нижче — про рахунок, не про доступність.

Через API з наявним токеном це не читається (бракує прав на `subscriptions`), тому очима.

---

## 1. Редирект www → apex

Rules → Redirect Rules → Create rule.

```
Ім'я:     www to apex
Умова:    (http.host eq "www.nextrole.info")
Дія:      Dynamic redirect
Вираз:    concat("https://nextrole.info", http.request.uri.path)
Код:      301
Preserve query string: так
```

Спрацьовує на краю й Worker не будить. `www.nextrole.info` лишається в `wrangler.jsonc`
як custom domain — інакше сертифікат на нього перестане випускатись і редирект
віддаватиме помилку TLS замість 301.

---

## 2. WAF custom rules

Security → WAF → Custom rules. На Free доступно **5**. Порядок має значення —
правила виконуються згори вниз.

### Правило 1 — пропустити справжні пошукові системи (ОБОВ'ЯЗКОВО ПЕРШИМ)

```
Ім'я:     verified search bots
Вираз:    (cf.client.bot)
Дія:      Skip → All remaining custom rules
```

`cf.client.bot` — це **звірений** список Cloudflare: перевірка йде через reverse-DNS,
а не через рядок User-Agent. Тому одне правило і пропускає справжнього Googlebot,
і не пропускає того, хто просто підписався його ім'ям.

> Якщо це правило не буде першим, наступні заблокують Googlebot,
> і сайт вилетить з індексу. Це головний ризик усієї роботи.

### Правило 2 — блокувати збирачів вмісту

```
Ім'я:     content freeloaders
Дія:      Block
Вираз:
(any(lower(http.user_agent)[*] contains "gptbot")) or
(lower(http.user_agent) contains "ccbot") or
(lower(http.user_agent) contains "claudebot") or
(lower(http.user_agent) contains "anthropic-ai") or
(lower(http.user_agent) contains "bytespider") or
(lower(http.user_agent) contains "ahrefsbot") or
(lower(http.user_agent) contains "semrushbot") or
(lower(http.user_agent) contains "mj12bot") or
(lower(http.user_agent) contains "dotbot") or
(lower(http.user_agent) contains "dataforseobot") or
(lower(http.user_agent) contains "blexbot") or
(lower(http.user_agent) contains "petalbot") or
(lower(http.user_agent) contains "barkrowler")
```

Простіший еквівалент, якщо редактор виразів опирається — один рядок:

```
lower(http.user_agent) matches "(gptbot|ccbot|claudebot|anthropic-ai|bytespider|ahrefsbot|semrushbot|mj12bot|dotbot|dataforseobot|blexbot|petalbot|barkrowler)"
```

Дублює `robots.txt` навмисно: файл лише просить, правило змушує.

### Правило 3 — порожній User-Agent

```
Ім'я:     no user agent
Умова:    (http.user_agent eq "" and not starts_with(http.request.uri.path, "/api/telegram/"))
Дія:      Managed Challenge
```

Не Block: порожній UA буває в кривих, але законних клієнтів.

> **Виняток для Telegram обов'язковий.** Telegram не гарантує User-Agent у
> webhook-запитах, а Managed Challenge на POST — це тиха смерть бота: Telegram
> отримає HTML замість 200, почне ретраїти, потім відключить webhook. Симптом
> був би «бот замовк», і на WAF ніхто б не подумав.

### Правило 4 — API тільки для Telegram

```
Ім'я:     api surface
Умова:    (starts_with(http.request.uri.path, "/api/") and not starts_with(http.request.uri.path, "/api/telegram/"))
Дія:      Block
```

Перевірено: під `/api/` живе рівно один маршрут — `web/src/app/api/telegram/webhook/route.ts`.
Інших ендпойнтів немає, тож правило нічого не ламає.

Правило 5 лишити порожнім: буде потрібне, коли з'являться категорійні сторінки.

---

## 3. Rate limiting

Security → WAF → Rate limiting rules. На Free — **одне** правило.

```
Ім'я:      page flood
Умова:     (not cf.client.bot and not starts_with(http.request.uri.path, "/api/telegram/"))
Лічильник: за IP
Поріг:     60 запитів за 10 секунд
Дія:       Managed Challenge, на 10 хвилин
```

Поріг навмисно високий: мета — зрізати шторм, а не заважати людині,
яка швидко клацає. `not cf.client.bot` тримає пошукові системи поза лічильником,
а виняток для `/api/telegram/` — Telegram: усі його запити приходять з невеликого
пулу IP, і ранкова розсилка легко дала б сплеск з однієї адреси.

---

## 4. Managed robots.txt для AI-краулерів

Security → Settings → **Block AI bots** (або Bots → Managed robots.txt).
Доступно на всіх планах, вмикається перемикачем.

Cloudflare дописує свої `Disallow` **перед** нашим `robots.txt`, не замінюючи його,
тож наші правила лишаються чинними.

---

## 5. Вимкнути workers.dev

Це вже в коді (`web/wrangler.jsonc`, `workers_dev: false`) і застосується наступним деплоєм.

Причина не в дублі контенту, а в тому, що `nextrole.workers.dev` іде **повз зону**:
жодне правило з пунктів 1–4 на нього не діє. Тобто краулер, якого ми блокуємо на
власному домені, спокійно заходив там.

Після деплою перевірити: `curl -sI https://nextrole.workers.dev/` має перестати відповідати.

Перевірено, що це безпечно: webhook Telegram зареєстровано на
`https://nextrole.info/api/telegram/webhook`, тобто на власному домені, а не на
`workers.dev` (`getWebhookInfo`, 2026-08-29). Якби він висів на workers.dev,
вимкнення вбило б бота.

---

## 6. Search Console і Bing

- Google Search Console → додати **Domain property** `nextrole.info` (покриває і www,
  і всі підпапки). Верифікація — TXT-запис у DNS; зона вже в Cloudflare, тож це
  найнадійніший спосіб і він переживає деплої.
- Подати `https://nextrole.info/sitemap.xml`.
- Bing Webmaster Tools → імпорт із GSC.

---

## Перевірка після застосування

Найважливіше — переконатися, що WAF не б'є по Googlebot:

1. Search Console → URL Inspection → **Test live URL** на `https://nextrole.info/`
   і на `https://nextrole.info/faq`. Має бути «URL is available to Google».
   Якщо Googlebot отримає challenge — сайт вилетить з індексу швидше,
   ніж йому шкодили всі три вихідні баги разом.
2. Security → Events → відфільтрувати за `Bot category: Verified Bot`.
   Заблокованих там бути не повинно.
3. `curl -sI https://www.nextrole.info/` → `301`, `location: https://nextrole.info/`
4. Analytics → Workers: записати кількість запитів/добу **до** змін, щоб було
   з чим порівнювати.
