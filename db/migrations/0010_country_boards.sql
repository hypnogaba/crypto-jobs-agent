-- Національні дошки, країна людини, облік витрат.
--
-- Досі всі джерела були глобально-англомовними, тож людина з України
-- отримувала американські віддалені вакансії. Українських дошок ми не читали.
--
-- Ключова відмінність, на якій усе тримається: агрегатор передруковує
-- вакансію, оригінал якої лежить на дошці роботодавця, — його викидаємо.
-- Національний борд на кшталт DOU — єдине місце, де вакансія існує взагалі,
-- бо «оригіналу на Greenhouse» в неї немає. Різниця не в домені, а в тому,
-- чи є де-інде оригінал.

-- Борд як рядок, а не як код: у сканері вже є універсальний читач RSS, тож
-- дошка з RSS додається адресою й не потребує деплою. kind='api' потребує
-- власного коду (перший такий буде France Travail) — тому колонка є одразу.
CREATE TABLE IF NOT EXISTS country_boards (
    id        TEXT PRIMARY KEY,
    country   TEXT NOT NULL,               -- ISO-3166 alpha-2: UA, FR
    name      TEXT NOT NULL UNIQUE,        -- board:dou-ua-engineering
    label     TEXT NOT NULL,               -- як показувати людині: «DOU»
    feed_url  TEXT NOT NULL,
    kind      TEXT NOT NULL DEFAULT 'rss', -- rss | api
    enabled   INTEGER NOT NULL DEFAULT 1,
    added_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_boards_country ON country_boards(country, enabled);

-- Країна вакансії. Порожня означає «глобальна» — таку бачать усі.
-- Заповнена означає «лише людям із цієї країни»: київська вакансія в
-- офісі нікому за межами України не потрібна.
ALTER TABLE jobs_cache ADD COLUMN country TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs_cache(country);

-- Країна людини. Виводиться, а не питається окремим питанням: спершу з
-- написаної локації, потім із часового поясу, який ми й так збираємо на
-- сайті й досі не використовували. Незнайомий пояс лишає порожнє —
-- здогадуватись гірше, ніж не знати.
ALTER TABLE profiles ADD COLUMN country TEXT;

-- Витрати. Anthropic зараз коштує нуль, бо ключа в проді немає й обидва
-- місця виклику мовчки переходять на ключові слова. Таблиця з'являється
-- зараз, щоб тієї миті, коли ключ додадуть, історія почалася з першого
-- виклику, а не з дня, коли хтось згадав про облік.
CREATE TABLE IF NOT EXISTS api_usage (
    id            TEXT PRIMARY KEY,
    at            TEXT NOT NULL DEFAULT (datetime('now')),
    service       TEXT NOT NULL,               -- anthropic
    operation     TEXT NOT NULL,               -- parse_profile | match_reason
    model         TEXT,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    ok            INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_usage_at ON api_usage(at);
