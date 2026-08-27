-- Черга запитів «дай ще зараз».
--
-- Кнопка «Ще п'ять» у боті обіцяла добірку за кілька хвилин, але нічого її
-- не виконувало: сайт на Workers не може дотягнутись до сканера на сервері.
-- Тому запит кладеться сюди, а сервер розбирає чергу щогодини разом із доставкою.
CREATE TABLE IF NOT EXISTS delivery_requests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    handled_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_delivery_requests_open
    ON delivery_requests(handled_at, requested_at);
