-- Вільний відгук із сайту.
--
-- Таблиця feedback — це реакції на добірку, дві кнопки. Тут інше: людина пише
-- своїми словами. Тримаємо окремо, бо в них різний життєвий цикл: реакція
-- живе рівно стільки, скільки акаунт, а відгук власник має прочитати навіть
-- після того, як людина пішла.
CREATE TABLE IF NOT EXISTS site_feedback (
    id         TEXT PRIMARY KEY,
    -- Не FK: відгук має пережити видалення акаунту. Хто саме написав —
    -- питання другорядне, важливо що саме.
    user_id    TEXT,
    contact    TEXT,                          -- як відповісти, якщо людина лишила
    locale     TEXT NOT NULL DEFAULT 'en',
    page       TEXT,                          -- звідки надіслано
    message    TEXT NOT NULL,
    handled_at TEXT,                          -- власник розібрався
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_feedback_open
    ON site_feedback(handled_at, created_at);
