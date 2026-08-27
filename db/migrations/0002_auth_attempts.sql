-- Обмеження спроб входу. Без нього пароль можна підбирати нескінченно:
-- реєстрація й вхід були єдиними ендпоінтами без жодного гальма.
CREATE TABLE IF NOT EXISTS auth_attempts (
    key          TEXT PRIMARY KEY,   -- 'login:<email>' або 'register:<ip>'
    attempts     INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    blocked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_window ON auth_attempts(window_start);
