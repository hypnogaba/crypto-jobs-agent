-- Облік застосованих міграцій.
--
-- Двадцять девʼять файлів у db/migrations і жодного сліду в базі про те, які
-- з них накотили. Питання «чи застосована 0029?» досі мало лише один спосіб
-- відповіді: піти й перевірити наслідок руками — стовпець, дані, індекс. Для
-- частини міграцій наслідок узагалі не видно (0029 правила два РЯДКИ, а не
-- схему), тож відповіді не існувало.
--
-- Ціна помилки тут не теоретична: пропущена міграція ламає не збірку, яку
-- видно одразу, а живий запит у проді — тобто виявляється найпізніше.
--
-- Таблиця свідомо дурна: імʼя файлу й час. Жодних контрольних сум і жодного
-- відкату — інструмент, який ми не запускаємо щодня, мусить бути таким, щоб
-- його не треба було вивчати наново.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Усе, що вже живе в базі на 2026-08-31, записуємо як застосоване: схему
-- звірено з кодом — усі таблиці, які читає код, у базі існують, — тож заднім
-- числом це факт, а не припущення. Список згенеровано з самої теки, не з
-- памʼяті: перша спроба написати його руками дала пʼять неіснуючих імен.
INSERT OR IGNORE INTO schema_migrations (name) VALUES
  ('0001_schema.sql'),
  ('0002_auth_attempts.sql'),
  ('0003_requests.sql'),
  ('0004_site_feedback.sql'),
  ('0005_sent_dedupe_key.sql'),
  ('0006_bot_state.sql'),
  ('0007_custom_role.sql'),
  ('0008_proposals.sql'),
  ('0009_learning.sql'),
  ('0010_country_boards.sql'),
  ('0011_job_summary_and_match_state.sql'),
  ('0012_wishes_and_custom.sql'),
  ('0013_job_i18n.sql'),
  ('0014_webhook_updates.sql'),
  ('0015_cost_backfill.sql'),
  ('0016_onboarding_draft.sql'),
  ('0017_cv_highlights.sql'),
  ('0018_telegram_names_and_source_intake.sql'),
  ('0019_getro_collections_and_jsonld.sql'),
  ('0020_drop_seniority_question.sql'),
  ('0021_profile_english.sql'),
  ('0022_getro_collection_tags.sql'),
  ('0023_sent_score.sql'),
  ('0024_board_salary_period.sql'),
  ('0025_bot_activity.sql'),
  ('0026_digest_indexes.sql'),
  ('0027_source_stats.sql'),
  ('0028_draft_refined.sql'),
  ('0029_salary_monthly.sql'),
  ('0030_schema_migrations.sql');
