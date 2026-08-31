# Розгортання скану

Скан живе на власному сервері під systemd, а не на Cloudflare Workers.
Безкоштовний тариф Workers дає 10 мс CPU і 50 зовнішніх запитів на виклик,
а один прогін драбини робить тисячі запитів і парсить мегабайти JSON.

## Перше встановлення

Локально збираємо й копіюємо на сервер:

```bash
cd scanner
npm ci && npm run build
rsync -av --delete --exclude .env --exclude src --exclude node_modules \
  ./package.json ./package-lock.json ./dist <host>:/opt/nextrole-scanner/
```

Створюємо `/etc/nextrole-scanner.env` зі змінними з `.env.example`.
Файл тримає живий токен Cloudflare, тому закриваємо його:

```bash
chmod 600 /etc/nextrole-scanner.env
chown root:root /etc/nextrole-scanner.env
```

Ставимо юніти. Список нижче — ПОВНИЙ: у ньому сім таймерів, і кожен із них
живе на сервері зараз. Раніше тут стояло чотири, тож розгортання за цією
інструкцією мовчки лишало систему без самоперегляду й обох розвідок — тобто
без усього, що вона міняє в собі сама.

```bash
cp deploy/*.service deploy/*.timer /etc/systemd/system/
install -m 755 deploy/discover-window.sh /opt/nextrole-scanner/discover-window.sh
systemctl daemon-reload
systemctl enable --now \
  nextrole-scan.timer nextrole-watchdog.timer \
  nextrole-digest.timer nextrole-requests.timer \
  nextrole-review.timer nextrole-discover.timer nextrole-twitter.timer
```

| Таймер | Коли | Що робить |
|---|---|---|
| `nextrole-scan` | Пн–Пт 05:00 | обхід джерел, наповнення кеша |
| `nextrole-watchdog` | Пн–Пт 08:00 | судить учорашній скан, за потреби повторює |
| `nextrole-digest` | щогодини о :05 | розсилка в годину людини |
| `nextrole-requests` | кожні 2 хв | черга «Ще п'ять» |
| `nextrole-review` | Нд 06:00 | самоперегляд → пропозиції в панель |
| `nextrole-discover` | Нд 04:00 | розвідка колекцій Getro по рухомому вікну |
| `nextrole-twitter` | Нд 07:00 | пошук дошок під країни, де є люди |

`nextrole-discover` запускає не `node` напряму, а `discover-window.sh`: він
веде курсор у `/var/lib/nextrole/discover-cursor` і щотижня бере наступні 300
колекцій по колу.

## Перевірка

```bash
systemctl list-timers 'nextrole-*'
systemctl start nextrole-scan.service
journalctl -u nextrole-scan.service -n 50 --no-pager
```

Лог закінчується доказом роботи: рядок на кожен рівень драбини з тим, що він
додав і які джерела були недоступні, потім підсумок.

## Разова розвідка нових колекцій Getro

```bash
node dist/discover.js 900 1500 1
```

Перебирає id, знаходить живі колекції й забирає з них компанії з прямими
ATS-посиланнями в постійний список. Getro тротлить, тому перебір повільний —
це нормально.

## Разове дозаповнення вилки зарплат

```bash
node dist/backfill-salary.js --dry-run        # лише порахувати
node dist/backfill-salary.js                  # записати
node dist/backfill-salary.js --refetch 200    # плюс повний текст для 200 свіжих (Greenhouse/Rippling/SmartRecruiters)
```

Проходить `jobs_cache` пакетами по 500 і витягує вилку з `summary`
(`src/salary.ts`). Витяг — ≤240 символів про роль, а не про гроші, тому
знаходить мало; далі вилка ловиться сама: сканер бере її з повного тексту в
момент запису, добірка — при поштучному довантаженні опису. Друкує лічильники.

## Переклад картки

З `ANTHROPIC_API_KEY` у `/etc/nextrole-scanner.env` назва й опис вакансії
перекладаються мовою людини (uk/fr/ru) моделлю `claude-haiku-4-5-20251001`,
одним запитом на добірку, і кешуються в `job_i18n` (міграція
`db/migrations/0013_job_i18n.sql` — накотити перед деплоєм). Без ключа
добірка байт у байт як раніше. Компанія не перекладається ніколи.

## Оновлення

```bash
npm run build
rsync -av --delete --exclude .env --exclude src --exclude node_modules \
  ./package.json ./package-lock.json ./dist <host>:/opt/nextrole-scanner/
```

Перезапуск не потрібен: усі юніти типу `oneshot` і запускаються таймерами.

`nextrole-digest.timer` ходить щогодини й шле планові добірки (пн–пт у поясі
людини, одна на день). `nextrole-requests.timer` ходить кожні дві хвилини й
обслуговує лише кнопку «Ще п'ять» — без відкритих запитів це один SELECT.
