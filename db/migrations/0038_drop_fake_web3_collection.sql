-- Колекція «Curated jobs in Web3» містить Leidos, а не web3.
--
-- Міграція 0036 увімкнула її разом із десятьма справжніми крипто-фондами,
-- і підставою була НАЗВА: `web3.getro.com`, «Curated jobs in Web3». Вибірка
-- після першого ж скану показала вміст: Leidos (оборонний підрядник),
-- London Stock Exchange Group, CyberArk, Zerto, Starfish Space, Jump
-- Trading. Крипта там трапляється рівно одна — BitDeer.
--
-- Ціна помилки була найбільшою з усіх: 1561 вакансія з 1798 доданих, тобто
-- 87% приросту виявились не тим, за що ми їх видали.
--
-- Це та сама помилка, яку 0037 виправила для jobstash, і зроблена вона тим
-- самим способом: довіра до вивіски замість перевірки вмісту. Різниця лише
-- в тому, що там вивіску написала чужа дошка, а тут — Getro.
--
-- Решту десять перевірено вибіркою окремо, і вони справжні:
--   Blockchain Association  Stellar, OKX, Morpho, Bullish, 0x, Fireblocks
--   Blockchain Capital      Matter Labs, Aave, Kraken, Bitwise, Ripple
--   Paradigm                Lightspark, OP Labs, Symbiotic, MoonPay
--   Variant                 Morpho Labs, Blockaid, Provable
--   Coinbase                Katana, Astar Foundation, CertiK
--   Delphi                  Flowdesk, GRVT, Zero Gravity
-- Вони лишаються ввімкненими.
UPDATE getro_collections SET enabled = 0, tags = '[]' WHERE collection_id = '1513';

-- Рядки лишаються в кеші, доки не випадуть із вікна свіжості (видаляти їх
-- не можна: на sent.job_id тримається каскад). Тому знімаємо з них хибний
-- тег зараз, а не чекаємо, поки вони підуть самі.
UPDATE jobs_cache
   SET tags = REPLACE(REPLACE(REPLACE(tags, '"web3",', ''), ',"web3"', ''), '"web3"', '')
 WHERE source = 'getro:1513' AND tags LIKE '%web3%';

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0038_drop_fake_web3_collection.sql');
