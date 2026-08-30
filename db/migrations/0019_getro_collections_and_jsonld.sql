-- Колекції Getro — рядками, а не масивом у коді.
--
-- Getro тримає борди екосистем фондів: jobs.solana.com, jobs.avax.network,
-- jobs.dragonfly.xyz — усе це Getro під своїм доменом. Для нас це головний
-- постачальник НЕВІДОМИХ компаній, бо 80% посилань там ведуть просто в ATS
-- роботодавця.
--
-- Досі список жив масивом у scan.ts, тобто нову колекцію можна було додати
-- лише правкою коду й деплоєм сканера. Власник дав список бордів і не мав
-- жодного способу їх увімкнути. Тепер це рядок: адмінка впізнає борд Getro за
-- сторінкою й додає його сама.
CREATE TABLE IF NOT EXISTS getro_collections (
    id            TEXT PRIMARY KEY,
    collection_id INTEGER NOT NULL UNIQUE,
    label         TEXT NOT NULL,               -- «Solana», «Dragonfly»
    url           TEXT,                        -- звідки взяли, щоб було видно
    enabled       INTEGER NOT NULL DEFAULT 1,
    added_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- П'ятнадцять, що були зашиті в scan.ts. Мітки в них немає: їх знайшли
-- переліком id, а не за назвою борда, і вигадувати назву заднім числом
-- означало б написати неправду.
INSERT OR IGNORE INTO getro_collections (id, collection_id, label, url) VALUES
  (lower(hex(randomblob(16))),  100, 'колекція 100',  NULL),
  (lower(hex(randomblob(16))),  150, 'колекція 150',  NULL),
  (lower(hex(randomblob(16))),  200, 'колекція 200',  NULL),
  (lower(hex(randomblob(16))),  250, 'колекція 250',  NULL),
  (lower(hex(randomblob(16))),  300, 'колекція 300',  NULL),
  (lower(hex(randomblob(16))),  400, 'колекція 400',  NULL),
  (lower(hex(randomblob(16))),  550, 'колекція 550',  NULL),
  (lower(hex(randomblob(16))),  800, 'колекція 800',  NULL),
  (lower(hex(randomblob(16))),  950, 'колекція 950',  NULL),
  (lower(hex(randomblob(16))), 1000, 'колекція 1000', NULL),
  (lower(hex(randomblob(16))), 1100, 'колекція 1100', NULL),
  (lower(hex(randomblob(16))), 1200, 'колекція 1200', NULL),
  (lower(hex(randomblob(16))), 1300, 'колекція 1300', NULL),
  (lower(hex(randomblob(16))), 1500, 'колекція 1500', NULL);

-- Ці шість знайдені за посиланнями власника: id узятий зі сторінки борда
-- (`__NEXT_DATA__` → `network.id`), і кожен перевірений живцем — усі шість
-- віддали вакансії. 858 уже був у списку, але тепер він з назвою.
INSERT OR IGNORE INTO getro_collections (id, collection_id, label, url) VALUES
  (lower(hex(randomblob(16))),   858, 'Solana',          'https://jobs.solana.com/jobs'),
  (lower(hex(randomblob(16))), 10223, 'Avalanche',       'https://jobs.avax.network/jobs'),
  (lower(hex(randomblob(16))),  1118, 'Dragonfly',       'https://jobs.dragonfly.xyz/jobs'),
  (lower(hex(randomblob(16))),   203, 'Polychain',       'https://jobs.polychain.capital/jobs'),
  (lower(hex(randomblob(16))),  1640, 'Electric Capital','https://jobs.electriccapital.com/jobs'),
  (lower(hex(randomblob(16))),   390, 'Multicoin',       'https://jobs.multicoin.capital/jobs');

UPDATE getro_collections SET label = 'Solana', url = 'https://jobs.solana.com/jobs'
 WHERE collection_id = 858;

-- Дошка, яка віддає вакансії розміткою JobPosting.
--
-- `kind` у country_boards уже існує ('rss' | 'api') — додаємо третє значення
-- 'jsonld'. Це не милиця під один сайт: JobPosting — стандарт schema.org, і
-- дошки ставлять його самі, щоб потрапити в Google Jobs. web3.career віддає
-- так вісімнадцять вакансій на сторінку, не маючи ні RSS, ні ATS-посилань.
--
-- Схему це не змінює: колонка та сама, значення нове.

-- Що робити з посиланням, яке не взялось.
--
-- Досі журнал казав «не розпізнано» — і на цьому все. Це не діагноз, а
-- відмова: власник бачив вісім однакових рядків і не мав жодної підказки,
-- чому саме сайт не взявся й чи можна щось вдіяти. А сайти в тому списку —
-- пряма наша аудиторія.
--
-- Тепер поруч із причиною лежить наступний крок людською мовою.
ALTER TABLE source_intake ADD COLUMN fix TEXT;
