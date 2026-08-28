-- Опис вакансії та стан подачі.
--
-- summary — готовий витяг ≤240 символів, НЕ сирий текст оголошення. Опис
-- вакансії однаковий для всіх людей, тому рахується один раз і лежить у
-- спільному кеші. summary_at дає змогу перерахувати старі рядки, якщо
-- витяг колись покращимо.
ALTER TABLE jobs_cache ADD COLUMN summary    TEXT;
ALTER TABLE jobs_cache ADD COLUMN summary_at TEXT;

-- Стан вакансії в кабінеті. Досі sent знав лише pending|sent|failed —
-- це про доставку, а не про те, що людина з вакансією зробила.
ALTER TABLE sent ADD COLUMN applied_at TEXT;
ALTER TABLE sent ADD COLUMN hidden_at  TEXT;

-- Причини збігу структуровано. Сканер пише ідентифікатори зі словника,
-- сайт розкриває їх у назви за локаллю: пакети окремі й спільного коду
-- не мають, тому контракт — це саме JSON.
ALTER TABLE sent ADD COLUMN match_facts TEXT NOT NULL DEFAULT '[]';
