-- Одинадцять крипто-колекцій лежали вимкненими.
--
-- Розвідка щонеділі знаходить живі колекції Getro й записує їх `enabled=0`.
-- Так і має бути: у беклозі виміряно, що 20 колекцій коштують 2,5–5 хвилин
-- скану, тож вмикати всі 571 гуртом не можна.
--
-- Але вибірка «які саме вмикати» досі робилась навмання, і серед вимкнених
-- лежали Paradigm, Variant, Placeholder, Blockchain Capital, Delphi,
-- Framework, Outlier і Spartan. Це верхній ешелон крипто-фондів, тобто рівно
-- та ніша, по яку прийшли 16 профілів із 24.
--
-- Увімкнено 11, а не всі знайдені: F-Prime, Greenfield Partners, Maven
-- Ventures, JumpStart, Enid Regional і Women's Impact Alliance теж збіглися
-- з пошуком, але крипто-фондами не є — збіг був за словом «capital» чи
-- «alliance». Тег ставиться лише тим, хто справді нішевий, інакше `web3`
-- перестане щось означати.
--
-- Ціна: 11 колекцій це приблизно півтори хвилини до щоденного скану. Приз
-- перевірятиметься наступним прогоном; якщо якась колекція дасть нуль два
-- тижні поспіль, `review.ts` сам запропонує її вимкнути.
UPDATE getro_collections
   SET enabled = 1,
       tags = '["web3"]'
 WHERE collection_id IN (
   '944',   -- Paradigm
   '1508',  -- Variant Fund
   '922',   -- Placeholder
   '815',   -- Blockchain Capital
   '1440',  -- Delphi Ventures
   '1127',  -- Framework Ventures
   '1524',  -- Outlier Ventures
   '1179',  -- Spartan Group
   '1625',  -- Coinbase
   '869',   -- Blockchain Association
   '1513'   -- Curated jobs in Web3 (web3.getro.com)
 );

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0036_more_crypto_collections.sql');
