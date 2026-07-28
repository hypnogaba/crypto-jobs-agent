# Crypto Hiring Agent — Фаза 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Розгорнути хмарну щоденну рутину (`/schedule` → Claude Code cloud routine), яка моніторить X на hiring-сигнали серед списку crypto-акаунтів і надсилає готові чернетки DM у Telegram — без сайту й окремого Anthropic API ключа.

**Architecture:** Хмарна CCR-рутина (інструмент `RemoteTrigger`) на моделі `claude-sonnet-5`, що клонує приватний GitHub-репозиторій `hypnogaba/crypto-jobs-agent`, читає/оновлює файли стану (список акаунтів, dedup) у цьому репо, викликає 6551.io Twitter API та Telegram Bot API напряму через `curl` у Bash-тулі (токени вбудовані буквально в текст промпту рутини — рутина не має доступу до локальних env-змінних чи локальних skills), і комітить+пушить оновлений стан назад у репозиторій наприкінці кожного запуску.

**Tech Stack:** Claude Code cloud routines (`RemoteTrigger` tool), 6551.io Twitter API (raw HTTPS/curl, Plus-тариф, 20,080 повідомлень доступно), Telegram Bot API (raw HTTPS/curl), git/GitHub для персистентного стану, звичайні JSON-файли для даних.

---

## Відомі обмеження й ризики (звірено заздалегідь)

- Хмарна рутина **не бачить локальних файлів, env-змінних чи skills** — усе, що їй потрібне, має або приїхати в git-репозиторії, або бути буквально вписане в текст промпту рутини (секрети).
- Секрети (X API токен, Telegram bot токен) зберігатимуться **в тексті промпту рутини** на сервері claude.ai (видимі тільки тобі через дашборд), **не в git**. Це прийнятний компроміс для MVP-тесту; перед Фазою 2 — ротувати ключі.
- Мінімальний інтервал хмарної рутини — 1 година; щоденний запуск (раз на добу) — без проблем.
- Рутини не видаляються через API — тільки через https://claude.ai/code/routines.
- Free-квота 6551.io (80/день) замінена на Plus (20,080 повідомлень) — перевірки 200 акаунтів/день вистачає з запасом.

---

## File Structure

- `data/accounts.json` — список X-акаунтів для моніторингу (screen_name + метадані)
- `data/seen_tweets.json` — dedup: ID уже оброблених твітів + час останнього прогону
- `docs/routine-prompt.md` — версійований текст промпту рутини (з плейсхолдерами `<TWITTER_TOKEN>`, `<TELEGRAM_BOT_TOKEN>`, `<TELEGRAM_CHAT_ID>` замість реальних секретів — підставляються тільки в момент створення рутини через `RemoteTrigger`, у сам файл секрети ніколи не пишуться)
- `docs/routine-notes.md` — як переглядати/керувати рутиною, ротація ключів, відомі обмеження
- `README.md` — короткий опис проєкту й поточного статусу

---

### Task 1: Зібрати початковий список crypto-акаунтів

**Files:**
- Create: `data/accounts.json`

- [ ] **Step 1: Зібрати кандидатів через пошук по ключових словах**

Виконати серію запитів через 6551.io API (токен уже підтверджений робочим):

```bash
for kw in "we're hiring web3" "hiring solana engineer" "web3 job opening" "crypto protocol hiring" "join our team web3"; do
  curl -s -X POST "https://ai.6551.io/open/twitter_search" \
    -H "Authorization: Bearer $TWITTER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"keywords\": \"$kw\", \"maxResults\": 30, \"product\": \"Latest\"}" \
    | jq -r '.data[].userScreenName'
done | sort -u > /tmp/candidate_accounts.txt
wc -l /tmp/candidate_accounts.txt
```

Очікуваний результат: файл з унікальними `screen_name`, зазвичай 60-150 з п'яти запитів.

- [ ] **Step 2: Додати відомі протоколи/фаундерів вручну для повноти списку**

Додати до `/tmp/candidate_accounts.txt` акаунти великих протоколів і фаундерів, яких пошук міг не спіймати (список ручної курації, ~30-50 імен: наприклад великі L1/L2 протоколи, відомі crypto VC, HR-акаунти великих бірж). Ця дія виконується агентом у сесії — не потребує коду, лише знання предметної області.

- [ ] **Step 3: Сформувати `data/accounts.json`**

```bash
mkdir -p /Users/hypnogaba/Projects/crypto-jobs-agent/data
```

Структура файлу:

```json
{
  "last_updated": "2026-07-28",
  "accounts": [
    {"screen_name": "example_protocol", "source": "keyword_search"},
    {"screen_name": "example_founder", "source": "manual_curation"}
  ]
}
```

Обмежити список до ~150-200 найрелевантніших (фаундери, протоколи, офіційні HR/рекрутинг-акаунти; виключити чисто трейдингові/мем-акаунти).

- [ ] **Step 4: Перевірити файл**

```bash
cat data/accounts.json | jq '.accounts | length'
cat data/accounts.json | jq empty && echo "valid JSON"
```

Очікується: число в межах 100-200, "valid JSON" без помилок.

- [ ] **Step 5: Commit**

```bash
git add data/accounts.json
git commit -m "Add initial X account list for hiring signal monitoring"
git push
```

---

### Task 2: Створити Telegram-бота і дізнатись chat_id

**Files:** немає (секрети не комітяться)

- [ ] **Step 1: Користувач створює бота**

Дії користувача в Telegram: `@BotFather` → `/newbot` → дати ім'я й username → отримати токен виду `123456789:ABC-DEF...`.

- [ ] **Step 2: Користувач пише боту будь-яке повідомлення**

Наприклад "hi" — потрібно, щоб `getUpdates` повернув chat_id.

- [ ] **Step 3: Отримати chat_id**

Коли токен відомий (підставити в команду нижче):

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
```

Очікується: числове значення chat_id (наприклад `123456789`).

- [ ] **Step 4: Перевірити відправку тестового повідомлення**

```bash
curl -s -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage" \
  -d "chat_id=<TELEGRAM_CHAT_ID>" \
  --data-urlencode "text=Тестове повідомлення від crypto-jobs-agent"
```

Очікується: повідомлення приходить у Telegram, відповідь містить `"ok":true`.

Токен і chat_id тримати під рукою для Task 3 і Task 5 (не записувати у файли репозиторію).

---

### Task 3: Написати self-contained промпт щоденної рутини

**Files:**
- Create: `docs/routine-prompt.md`

- [ ] **Step 1: Написати повний текст промпту**

```markdown
Ти виконуєш щоденну перевірку hiring-сигналів у X для crypto/web3 job-search агента.

Репозиторій вже клоновано в поточну директорію. Файли стану:
- `data/accounts.json` — список X-акаунтів для моніторингу
- `data/seen_tweets.json` — ID твітів, які вже оброблені раніше (може не існувати при першому запуску — тоді вважай список порожнім)

Виконай по кроках:

1. Прочитай `data/accounts.json`. Якщо `data/seen_tweets.json` існує — прочитай і його, інакше вважай, що жоден твіт ще не оброблено.

2. Для кожного акаунта зі списку виклич через Bash tool:
```bash
curl -s -X POST "https://ai.6551.io/open/twitter_user_tweets" \
  -H "Authorization: Bearer <TWITTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"username": "SCREEN_NAME", "maxResults": 5, "product": "Latest"}'
```
Візьми тільки твіти за останні 24 години (поле `createdAt`).

3. Для кожного нового твіта (ID якого немає в `seen_tweets.json`) визнач, чи це hiring-сигнал: чи йдеться про найм на роль у web3/crypto-компанії. Ознаки: "hiring", "we're looking for", "join our team", вказана конкретна роль/посада, згадка компанії/проєкту в контексті найму.

4. Для кожного знайденого hiring-твіта витягни: назву ролі, компанію (якщо визначається з тексту), контактну особу — якщо твіт написаний особисто (не корпоративним акаунтом), контакт це автор твіта.

5. Згенеруй чернетку X DM (2-4 речення, англійською, розмовним тоном, без "as an AI" і канцеляриту), що представляє кандидата (крипто/web3 інженер, шукає роль) і посилається на конкретну роль/твіт.

6. Додай ID усіх оброблених твітів (і hiring, і non-hiring) до списку в `data/seen_tweets.json`, щоб не обробляти їх повторно завтра. Онови `last_run` на поточну дату.

7. Сформуй Telegram-повідомлення:
   - Якщо є hiring-твіти: окреме повідомлення на кожен твіт — оригінальний текст твіту, роль/компанія (якщо визначено), згенерована чернетка DM, посилання на твіт (`https://x.com/<screen_name>/status/<id>`).
   - Якщо hiring-твітів немає: одне коротке повідомлення "Сьогодні нічого нового. Перевірено N акаунтів." (N — кількість акаунтів зі списку).

8. Надішли кожне повідомлення через Telegram Bot API:
```bash
curl -s -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage" \
  -d "chat_id=<TELEGRAM_CHAT_ID>" \
  --data-urlencode "text=ТЕКСТ_ПОВІДОМЛЕННЯ"
```

9. Онови `data/seen_tweets.json` у робочій копії репозиторію, потім:
```bash
git add data/seen_tweets.json
git commit -m "chore: update seen tweets state $(date -u +%Y-%m-%d)"
git push
```

10. Якщо крок 2 (X API) або крок 8 (Telegram) впав через недоступність API — не зупиняй увесь запуск. Обробі те, що вдалось, зафіксуй помилку одним коротким Telegram-повідомленням ("Не вдалось перевірити частину акаунтів через помилку X API, спробую завтра знову"), і все одно виконай коміт того стану, що встиг обробити.
```

- [ ] **Step 2: Зберегти файл**

Записати вміст із Step 1 у `docs/routine-prompt.md` буквально (з плейсхолдерами `<TWITTER_TOKEN>`, `<TELEGRAM_BOT_TOKEN>`, `<TELEGRAM_CHAT_ID>` — не замінювати тут на реальні значення).

- [ ] **Step 3: Commit**

```bash
git add docs/routine-prompt.md
git commit -m "Add daily routine prompt template for Phase 1"
git push
```

---

### Task 4: De-risk spike — перевірити, що хмарна рутина може пушити в GitHub і робити зовнішні curl-запити

**Files:** немає (одноразовий тестовий запуск, не постійна рутина)

- [ ] **Step 1: Створити одноразову тестову рутину**

Викликати `RemoteTrigger` з `action: "create"`:

```json
{
  "name": "crypto-jobs-agent-spike-test",
  "run_once_at": "<UTC-час через ~10 хвилин від поточного, формат YYYY-MM-DDTHH:MM:SSZ>",
  "job_config": {
    "ccr": {
      "environment_id": "env_01Y4dwGSKduaSNk1RH5eHio2",
      "session_context": {
        "model": "claude-sonnet-5",
        "sources": [{"git_repository": {"url": "https://github.com/hypnogaba/crypto-jobs-agent"}}],
        "allowed_tools": ["Bash", "Read", "Write"],
        "events": [{"data": {
          "uuid": "<новий lowercase v4 uuid>",
          "session_id": "",
          "type": "user",
          "parent_tool_use_id": null,
          "message": {"content": "Створи файл data/spike_test.txt з текстом 'ok' і поточним UTC-часом, потім git add/commit/push з повідомленням 'spike test'. Після цього виконай curl -s -o /dev/null -w '%{http_code}' https://ai.6551.io/open/twitter_user_info і виведи код відповіді в текст як частину фінального повідомлення.", "role": "user"}
        }}]
      }
    }
  }
}
```

Перед створенням: **обов'язково спершу виконати `date -u +%Y-%m-%dT%H:%M:%SZ` через Bash**, щоб отримати точний поточний час, і розрахувати `run_once_at` від нього (не покладатись на час, вказаний у документації skill).

- [ ] **Step 2: Дочекатись виконання і перевірити результат**

```bash
sleep 600  # або більше залежно від запланованого часу
cd /Users/hypnogaba/Projects/crypto-jobs-agent && git pull
cat data/spike_test.txt
git log --oneline -3
```

Очікується: файл `data/spike_test.txt` з'явився і запушився з хмарної рутини (новий коміт від рутини, не від локальної сесії).

- [ ] **Step 3: Якщо push не спрацював — розібратись перед Task 5**

Якщо коміт не з'явився — перевірити через `RemoteTrigger {action: "get", trigger_id: ...}`, чи рутина взагалі виконалась, і чи є повідомлення про помилку доступу до git. Це блокер для Task 5, поки не вирішено.

- [ ] **Step 4: Прибрати тестовий файл**

```bash
git rm data/spike_test.txt
git commit -m "chore: remove spike test file"
git push
```

---

### Task 5: Створити щоденну рутину

**Files:** немає (створення через `RemoteTrigger`, конфігурація не зберігається окремим файлом — сам промпт уже версійовано в `docs/routine-prompt.md`)

- [ ] **Step 1: Підставити реальні секрети в текст промпту**

Взяти вміст `docs/routine-prompt.md`, замінити `<TWITTER_TOKEN>` на значення `$TWITTER_TOKEN` (з локального оточення), `<TELEGRAM_BOT_TOKEN>` і `<TELEGRAM_CHAT_ID>` — на значення з Task 2. Це відбувається тільки в пам'яті виклику (тіло запиту до `RemoteTrigger`), не записується у файл репозиторію.

- [ ] **Step 2: Розрахувати cron-вираз**

9:00 ранку за Києвом (EET, UTC+2 взимку / EEST, UTC+3 влітку — станом на кінець липня діє EEST, UTC+3) → `0 6 * * *` (6:00 UTC). Підтвердити з користувачем перед створенням, якщо з моменту останньої відповіді минув значний час.

- [ ] **Step 3: Викликати `RemoteTrigger` з `action: "create"`**

```json
{
  "name": "crypto-jobs-agent-daily",
  "cron_expression": "0 6 * * *",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "env_01Y4dwGSKduaSNk1RH5eHio2",
      "session_context": {
        "model": "claude-sonnet-5",
        "sources": [{"git_repository": {"url": "https://github.com/hypnogaba/crypto-jobs-agent"}}],
        "allowed_tools": ["Bash", "Read", "Write", "Edit"],
        "events": [{"data": {
          "uuid": "<новий lowercase v4 uuid>",
          "session_id": "",
          "type": "user",
          "parent_tool_use_id": null,
          "message": {"content": "<повний текст із docs/routine-prompt.md із підставленими секретами>", "role": "user"}
        }}]
      }
    }
  }
}
```

- [ ] **Step 4: Зберегти routine ID**

Відповідь містить ID рутини. Вивести користувачу посилання: `https://claude.ai/code/routines/{ROUTINE_ID}`.

---

### Task 6: Перевірити перший реальний запуск

- [ ] **Step 1: Запустити рутину негайно, не чекаючи розкладу**

```
RemoteTrigger {action: "run", trigger_id: "<ROUTINE_ID_з_Task_5>"}
```

- [ ] **Step 2: Перевірити результат**

Дочекатись кілька хвилин, перевірити:
1. Прийшло повідомлення в Telegram (або з hiring-твітами, або "сьогодні нічого").
2. У репозиторії з'явився новий коміт зі змінами в `data/seen_tweets.json`:
```bash
git pull
git log --oneline -3
cat data/seen_tweets.json | jq '.seen | length'
```

- [ ] **Step 3: Якщо щось не спрацювало — діагностика**

Перевірити через `RemoteTrigger {action: "get", trigger_id: ...}` статус останнього запуску. Типові проблеми: невірний токен (перевірити ще раз через `curl` вручну), git push відхилено (перевірити права доступу репозиторію), Telegram chat_id невірний (повторити Step 3 з Task 2).

---

### Task 7: Документація для керування і ротації

**Files:**
- Create: `docs/routine-notes.md`
- Create: `README.md`

- [ ] **Step 1: Написати `docs/routine-notes.md`**

```markdown
# Керування щоденною рутиною

- Перегляд і керування: https://claude.ai/code/routines
- Видалення рутини можливе тільки через веб-інтерфейс (API не підтримує delete)
- Секрети (X API токен, Telegram bot токен) вписані буквально в текст промпту рутини на сервері — НЕ в git. Якщо потрібно ротувати ключ: оновити рутину через `RemoteTrigger {action: "update"}` з новим текстом промпту.
- Дедуп-стан: `data/seen_tweets.json` у репозиторії, оновлюється й пушиться самою рутиною щодня.
- Список акаунтів: `data/accounts.json`, редагується вручну за потреби (додати/прибрати акаунти).
- Відомий ліміт: 6551.io Plus-тариф, ~20,000 повідомлень/місяць.
```

- [ ] **Step 2: Написати `README.md`**

```markdown
# Crypto Jobs Agent

MVP-тест: щоденний моніторинг hiring-сигналів у X для crypto/web3, чернетки DM у Telegram.

Статус: Фаза 1 (X-only тест, без сайту). Деталі — `docs/superpowers/specs/2026-07-28-crypto-hiring-agent-mvp-design.md`.

Керування рутиною — `docs/routine-notes.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/routine-notes.md README.md
git commit -m "Add routine management docs and project README"
git push
```

---

## Self-Review

**Spec coverage:** усі пункти дизайн-спеки (`docs/superpowers/specs/2026-07-28-crypto-hiring-agent-mvp-design.md`) покриті: збір акаунтів (Task 1), Telegram (Task 2), класифікація+чернетка+дедуп+вивід (Task 3), обробка помилок (Task 3 Step 10), частота і час (Task 5 Step 2), перевірка (Task 6), документація (Task 7).

**Заглушки:** відсутні — усі кроки містять конкретний код/команди. Плейсхолдери `<TWITTER_TOKEN>` тощо — свідомі, замінюються реальними значеннями лише в момент виклику `RemoteTrigger` (Task 5 Step 1), ніколи не потрапляють у файли репозиторію.

**Узгодженість імен:** `data/accounts.json` (Task 1) і `data/seen_tweets.json` (Task 3) використовуються послідовно в усіх задачах, що на них посилаються.
