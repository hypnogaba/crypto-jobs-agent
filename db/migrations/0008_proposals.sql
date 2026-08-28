-- Пропозиції тижневого самоперегляду.
--
-- Раз на тиждень система дивиться на власні дані й пише, що варто змінити.
-- Власник читає й тисне «Застосувати» або «Відхилити» — розбиратися в SQL
-- не треба.
--
-- Головне правило: пропозиція існує лише тоді, коли систему НАВЧЕНО її
-- застосувати. Інакше кнопка була б декоративною, а таких у цьому проєкті
-- вже було досить.
CREATE TABLE IF NOT EXISTS proposals (
    id          TEXT PRIMARY KEY,
    -- Що саме зробити. Кожен вид має свій виконавець в адмінці:
    --   deprecate_source · revive_source · drop_company · notice
    kind        TEXT NOT NULL,
    -- Над чим. Порожньо для notice — воно лише повідомляє.
    target      TEXT,
    title       TEXT NOT NULL,
    detail      TEXT NOT NULL,
    -- Чому так вирішено: числа, на які можна подивитись самому.
    evidence    TEXT,
    -- Наскільки це важливо: high | medium | low
    severity    TEXT NOT NULL DEFAULT 'medium',
    status      TEXT NOT NULL DEFAULT 'open',   -- open | applied | dismissed
    run_id      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_open ON proposals(status, severity, created_at);

-- Та сама пропозиція не повторюється, доки попередня відкрита.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_unique_open
    ON proposals(kind, COALESCE(target, '')) WHERE status = 'open';
