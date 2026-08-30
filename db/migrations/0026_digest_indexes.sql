-- Індекси під шортліст добірки.
--
-- Один запит добірки читав 164 180 рядків D1. При ста людях це 16 млн рядків
-- на добу — 328% денного безкоштовного ліміту, тобто сервіс просто спинявся б
-- посеред дня. Разом із переписаним запитом (NOT EXISTS замість NOT IN і
-- доречність як умова, а не як порядок сортування) виходить близько 35 000
-- рядків на добірку.
--
-- idx_jobs_rank прибирає сортування у ROW_NUMBER() OVER (PARTITION BY
-- company_key ORDER BY posted_at DESC): 108 391 рядка → 82 306.
CREATE INDEX IF NOT EXISTS idx_jobs_rank ON jobs_cache(company_key, posted_at DESC, fetched_at DESC);

-- Друга умова «не слати те саме за змістом» шукає по парі (user_id,
-- dedupe_key). Пара (user_id, job_id) вже покрита UNIQUE, а ця — ні, і без
-- індексу NOT EXISTS по ній деградував у перебір.
CREATE INDEX IF NOT EXISTS idx_sent_dedupe ON sent(user_id, dedupe_key);
