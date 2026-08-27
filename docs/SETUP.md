# Що потрібно від власника

Система працює. Три речі лишаються за тобою — кожна вмикає окремий шматок.

## 1. Токен Telegram-бота → вмикає доставку

Створити бота: `@BotFather` → `/newbot` → назва **NextRole** → юзернейм **mynextrole_bot**.

Потім три команди (токен **не вставляй у чат**, лише в термінал):

```bash
cd web
npx wrangler secret put TELEGRAM_BOT_TOKEN        # вставити токен від BotFather
npx wrangler secret put TELEGRAM_BOT_USERNAME     # mynextrole_bot, без @
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # вигадати довгий випадковий рядок
```

Зареєструвати вебхук тим самим секретом:

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -d "url=https://nextrole.hypnogaba.workers.dev/api/telegram/webhook" \
  -d "secret_token=<ТОЙ САМИЙ СЕКРЕТ>"
```

Токен також потрібен на сервері, де крутиться доставка:

```bash
ssh root@<сервер> "echo 'TELEGRAM_BOT_TOKEN=<ТОКЕН>' >> /etc/nextrole-scanner.env"
```

**Вебхук закритий за замовчуванням.** Поки секрет не заданий, він відповідає 401
на будь-який запит. Це навмисно: інакше на свіжому деплої хтось міг би слати
оновлення від імені Telegram.

## 2. Токен Cloudflare із правом на зони → вмикає домен

Наявний OAuth-логін wrangler уміє D1 і Workers, але **зони лише читає**.
Потрібен Custom Token:

```
dash.cloudflare.com → My Profile → API Tokens → Create Custom Token
  Account · Zone · Edit          ← саме це дає право створювати зони
  Zone    · DNS  · Edit
  Zone    · Zone · Edit
```

Далі я створю зону `nextrole.info`, візьму видані Cloudflare nameserver'и
й пропишу їх на Porkbun через API — доступ до Porkbun уже є й перевірений.

### ⚠ Важливо про той самий токен

Сканер на сервері зараз працює на **тимчасовому OAuth-токені wrangler**, який
живе близько години. Він **перестане працювати сам собою**. Custom Token із
правом `D1 · Edit` треба покласти в `/etc/nextrole-scanner.env` замість нього —
API-токени не протухають.

## 3. Ключ Anthropic → покращує якість

Продукт працює й без нього: розбір профілю та підбір **детерміновані**.
Ключ лише робить пояснення «чому підходить» людськішими.

```bash
cd web && npx wrangler secret put ANTHROPIC_API_KEY
ssh root@<сервер> "echo 'ANTHROPIC_API_KEY=<КЛЮЧ>' >> /etc/nextrole-scanner.env"
```

Вартість: ранжування на Haiku ≈ $0.10 на людину в місяць.

## Хто адмін

Адмінка бачить того, хто **зареєструвався першим**. Якщо треба інакше:

```bash
cd web && npx wrangler secret put ADMIN_EMAIL
```

## Що вже працює без тебе

| Частина | Стан |
|---|---|
| Сайт | https://nextrole.hypnogaba.workers.dev |
| База | 10 таблиць у D1, наповнена |
| Скан | будні 05:00, таймер увімкнено |
| Watchdog | будні 08:00, таймер увімкнено |
| Добірка | щогодини, бере тих, у кого зараз їхня година |
| Реєстрація й вхід | працює |
| Онбординг | працює, розбір без жодного ключа |
| Адмінка | працює |
| Матчинг | працює, скоринг детермінований |
| Чотири мови | EN, UK, FR, RU |
