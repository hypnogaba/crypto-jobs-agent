-- Навчання на відповідях людини.
--
-- Досі кнопка «Не те, що треба» писала рядок у feedback, а бот відповідав
-- «Дякую, врахую. Завтрашня добірка буде точнішою». Це була неправда:
-- реакція нікуди не впливала.
--
-- Тепер бот питає ЧОМУ, і причина міняє вагу відповідного правила саме для
-- цієї людини. Скарга на рівень робить розрив у рівні дорожчим; скарга на
-- локацію — невідповідність локації; скарга на зарплату перетворює м'який
-- пріоритет на жорсткий поріг.
ALTER TABLE feedback ADD COLUMN reason TEXT;
ALTER TABLE feedback ADD COLUMN note TEXT;      -- якщо людина написала своїми словами

-- Ваги правил на конкретну людину. Одиниця — як у всіх; кожна скарга додає
-- пів бала, стеля — три. Без стелі одна роздратована людина зробила б
-- добірку порожньою.
CREATE TABLE IF NOT EXISTS user_tuning (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    seniority_weight REAL NOT NULL DEFAULT 1.0,
    location_weight  REAL NOT NULL DEFAULT 1.0,
    salary_weight    REAL NOT NULL DEFAULT 1.0,
    -- Скільки разів людина сказала «не та сфера». Вагою це не лікується —
    -- це привід запропонувати перезібрати профіль.
    sphere_complaints INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
