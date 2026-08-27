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

Ставимо юніти:

```bash
cp deploy/*.service deploy/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nextrole-scan.timer nextrole-watchdog.timer
```

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

## Оновлення

```bash
npm run build
rsync -av --delete --exclude .env --exclude src --exclude node_modules \
  ./package.json ./package-lock.json ./dist <host>:/opt/nextrole-scanner/
```

Перезапуск не потрібен: обидва юніти типу `oneshot` і запускаються таймерами.
