-- «Ніколи не слати те саме двічі» — за змістом, а не лише за рядком у базі.
--
-- Досі виключення йшло тільки за job_id. Коли компанія перевиставляє вакансію
-- під новим URL, це новий рядок і новий id — і людина отримувала ту саму роль
-- удруге. У кеші просто зараз 398 груп таких дублікатів.
--
-- dedupe_key це «компанія|назва ролі». Денормалізуємо його в sent, щоб перевірка
-- лишалась одним NOT IN без join на кожного користувача щогодини.
ALTER TABLE sent ADD COLUMN dedupe_key TEXT;

-- Заповнюємо історію: те, що вже надіслано, теж не має повторитись.
UPDATE sent
   SET dedupe_key = (SELECT j.dedupe_key FROM jobs_cache j WHERE j.id = sent.job_id)
 WHERE dedupe_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_sent_dedupe ON sent(user_id, dedupe_key);
