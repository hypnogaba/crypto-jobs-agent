-- NextRole — канонічна схема бази.
-- Замінює web/migrations/0001_init.sql (згенерований Prisma, ніколи не застосований).
-- Застосовується до Cloudflare D1 "crypto-jobs-agent".

-- ─────────────────────────────────────────────────────────────
-- ЛЮДИ
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id                   TEXT PRIMARY KEY,
    -- Основна особа акаунту. Людина, що почала в боті й потім відкрила сайт,
    -- потрапляє в цей самий профіль, а не в новий.
    telegram_chat_id     TEXT UNIQUE,
    -- Заповнений лише для тих, хто реєструвався на сайті.
    email                TEXT UNIQUE,
    password_hash        TEXT,
    -- Одноразовий токен підключення Telegram, живе 15 хвилин.
    connect_token        TEXT UNIQUE,
    connect_expires_at   TEXT,
    locale               TEXT NOT NULL DEFAULT 'en',   -- en | fr | ru | uk
    timezone             TEXT NOT NULL DEFAULT 'UTC',  -- визначається автоматично
    delivery_hour        INTEGER NOT NULL DEFAULT 9,   -- 0–23 за часом людини
    status               TEXT NOT NULL DEFAULT 'active', -- active | paused | deleted
    -- Для автопаузи через 14 днів повної тиші.
    last_interaction_at  TEXT,
    paused_reason        TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_delivery ON users(status, delivery_hour);
CREATE INDEX IF NOT EXISTS idx_users_idle     ON users(status, last_interaction_at);

-- Вебсесії. Потрібні кроку 3 — зараз аутентифікації немає взагалі.
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Відповіді на чотири питання онбордингу.
CREATE TABLE IF NOT EXISTS profiles (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode            TEXT NOT NULL,          -- freetext | cv
    raw_input       TEXT,                   -- що людина написала своїми словами
    cv_text         TEXT,                   -- розібраний текст CV; сам файл не зберігаємо
    -- Питання 1: сфери. JSON-масив, напр. ["engineering","devrel"]
    spheres         TEXT NOT NULL DEFAULT '[]',
    -- Теги індустрій — окремо від сфер, щоб web3 лишався нішею всередині IT
    industries      TEXT NOT NULL DEFAULT '[]',
    -- Питання 2
    seniority       TEXT,                   -- junior | middle | senior | lead
    -- Питання 3
    remote_mode     TEXT NOT NULL DEFAULT 'remote_only', -- remote_only | remote_or_city | relocate
    location        TEXT,
    -- Питання 4 — м'який пріоритет, не жорсткий фільтр
    salary_min      INTEGER,
    salary_currency TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────
-- ВАКАНСІЇ
-- ─────────────────────────────────────────────────────────────

-- Спільний кеш. Один скан обслуговує всіх; персональне лише ранжування.
CREATE TABLE IF NOT EXISTS jobs_cache (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL UNIQUE,
    company      TEXT NOT NULL,
    company_key  TEXT NOT NULL,             -- без юридичних суфіксів, для підрахунку компаній
    title        TEXT NOT NULL,
    location     TEXT,
    remote       INTEGER NOT NULL DEFAULT 0,
    salary_min   INTEGER,
    salary_max   INTEGER,
    salary_currency TEXT,
    source       TEXT NOT NULL,             -- напр. ashby:deepl або aggregator:remotive
    -- Теги для маршрутизації за нішами: успадковані від джерела + витягнуті з назви
    tags         TEXT NOT NULL DEFAULT '[]',
    -- Компанія + роль без локації: так геоклони схлопуються в один рядок
    dedupe_key   TEXT NOT NULL,
    posted_at    TEXT,
    fetched_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_dedupe  ON jobs_cache(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs_cache(company_key);
CREATE INDEX IF NOT EXISTS idx_jobs_fetched ON jobs_cache(fetched_at);

-- Що кому відправлено. Захищає від повторів і тримає історію кабінету.
CREATE TABLE IF NOT EXISTS sent (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id     TEXT NOT NULL REFERENCES jobs_cache(id) ON DELETE CASCADE,
    digest_id  TEXT NOT NULL,               -- одна ранкова добірка = один digest_id
    why_fits   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
    sent_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_sent_user   ON sent(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sent_digest ON sent(digest_id);

-- Реакція на добірку цілком. Дві кнопки, не оцінка кожної вакансії.
CREATE TABLE IF NOT EXISTS feedback (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    digest_id  TEXT NOT NULL,
    reaction   TEXT NOT NULL,               -- not_relevant | more
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- ДЖЕРЕЛА
-- ─────────────────────────────────────────────────────────────

-- Головний актив системи. Росте сам: кожна знайдена фірма лишається назавжди.
CREATE TABLE IF NOT EXISTS companies (
    slug            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    ats_provider    TEXT,                   -- greenhouse | lever | ashby | workable | smartrecruiters | workday
    ats_slug        TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    discovered_via  TEXT,                   -- seed | getro | slug_guess | manual
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    last_scanned_at TEXT,
    last_fit_at     TEXT,                   -- коли востаннє дала комусь збіг
    dry_scans       INTEGER NOT NULL DEFAULT 0
);

-- Ротація: щодня свіжі, раз на тиждень решта, давно порожні — рідше
CREATE INDEX IF NOT EXISTS idx_companies_rotation ON companies(last_fit_at, last_scanned_at);

-- Здоров'я джерел. Недоступне ніколи не рахується як порожнє.
CREATE TABLE IF NOT EXISTS sources_state (
    source_name           TEXT PRIMARY KEY,
    status                TEXT NOT NULL DEFAULT 'ok', -- ok | degraded | deprecated
    last_ok_at            TEXT,
    consecutive_fail_days INTEGER NOT NULL DEFAULT 0,
    last_error            TEXT,
    jobs_last_run         INTEGER NOT NULL DEFAULT 0,
    checked_at            TEXT
);

-- Ключі, введені в адмінці. Вставив токен — джерело ожило, без деплою.
CREATE TABLE IF NOT EXISTS source_keys (
    source_name TEXT PRIMARY KEY,
    key_value   TEXT NOT NULL,
    note        TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Історія прогонів. Watchdog судить день за цим, і адмінка показує деградацію.
CREATE TABLE IF NOT EXISTS scan_runs (
    id                 TEXT PRIMARY KEY,
    started_at         TEXT NOT NULL,
    finished_at        TEXT,
    distinct_companies INTEGER NOT NULL DEFAULT 0,
    jobs_found         INTEGER NOT NULL DEFAULT 0,
    ladder_reached     TEXT,
    status             TEXT NOT NULL DEFAULT 'running', -- running | ok | short | failed
    notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at);
