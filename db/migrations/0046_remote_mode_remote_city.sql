-- «Де працювати»: два сумісні пункти замість трьох (11.09.2026).
--
-- Було: remote_only | remote_or_city | relocate (набір через кому).
-- Стало: remote | city (набір через кому).
--
--   remote_only                -> remote
--   remote_or_city (з будь-чим) -> remote,city
--   relocate (з будь-чим)       -> remote,city
--   порожньо чи невідоме        -> remote
--
-- «Переїзд» став «віддалено + місто» за рішенням власника: людина була
-- відкрита до широкого, тож не звужуємо її до одного міста.
--
-- Порівняння по наборах, а не рівністю рядка: у стовпці кома-список, і
-- «remote_or_city,relocate» не дорівнює жодному окремому значенню.
-- Рядки, уже записані новими id, лишаються як є.
UPDATE profiles
SET remote_mode = CASE
  WHEN ',' || remote_mode || ',' LIKE '%,remote_or_city,%'
    OR ',' || remote_mode || ',' LIKE '%,relocate,%'      THEN 'remote,city'
  WHEN ',' || remote_mode || ',' LIKE '%,remote_only,%'   THEN 'remote'
  ELSE remote_mode
END
WHERE remote_mode NOT IN ('remote', 'city', 'remote,city');

UPDATE profiles SET remote_mode = 'remote'
WHERE remote_mode NOT IN ('remote', 'city', 'remote,city');

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0046_remote_mode_remote_city.sql');
