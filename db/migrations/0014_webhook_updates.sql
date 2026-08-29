-- Побачені update_id вебхука Telegram: кожне оновлення обробляється один раз.
-- Захист від повтору перехопленого тіла запиту й від подвійної обробки, коли
-- Telegram надсилає те саме оновлення ще раз.
CREATE TABLE IF NOT EXISTS webhook_updates (
    update_id INTEGER PRIMARY KEY,
    seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_updates_seen ON webhook_updates(seen_at);
