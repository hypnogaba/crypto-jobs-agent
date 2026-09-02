-- Гуртовий тег для jobstash.xyz був завищенням, і його треба зняти.
--
-- Міграція 0035 позначила крипто-нішею п'ять дошок. Для чотирьох це правда:
-- web3.career, cryptocurrencyjobs.co, crypto-careers.com і remote3.co інших
-- вакансій не тримають. Вибірка з web3.career дала LayerZero, OKX, Parity,
-- Polymarket, NEAR Foundation, FalconX, BCB Group — крипту в кожному рядку.
--
-- Для jobstash.xyz — ні. Вибірка з нього дала поруч Ava Labs, Chainalysis,
-- Bitdeer і Mem Protocol з одного боку та Optiver, PayPay, EQT Ventures,
-- Upvest і Northern Data з іншого. Це дошка «web3 і фінанси», і гуртовий тег
-- брехав би приблизно на третині її 1651 рядка.
--
-- Правильне джерело відповіді — сама дошка. У її записі лежать власні теги
-- («Web3», «Trading»), підписи картки й опис організації, який пише прямо:
-- «WalletConnect operates crypto and stablecoin payment infrastructure».
-- Тепер це читає `nicheOf` у boards.ts, по кожній вакансії окремо. На живій
-- сторінці: 7 із 10 визнано криптою, Lovable (AI-редактор) — ні.
UPDATE country_boards SET tags = '[]' WHERE name = 'board:global-jobstash';

-- Знімаємо `web3` з УСІХ рядків jobstash, а не з частини.
--
-- Наближати правило з tags.ts засобами SQL не варто: LIKE-набір із двадцяти
-- слів розійдеться з регуляркою на першій же правці, і ми отримаємо тиху
-- розбіжність замість чесної порожнечі. Скан, запущений одразу після цієї
-- міграції, перезаписує теги цілком і ставить нішу поштучно — і ті рядки,
-- що мали тег завжди, і ті, що заслуговують його за описом організації.
--
-- Три REPLACE, а не один: `web3` може стояти першим, останнім або єдиним
-- елементом масиву, і кома в кожному випадку стоїть у різному місці.
UPDATE jobs_cache
   SET tags = REPLACE(REPLACE(REPLACE(tags, '"web3",', ''), ',"web3"', ''), '"web3"', '')
 WHERE source = 'board:global-jobstash'
   AND tags LIKE '%web3%';

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0037_jobstash_niche_per_job.sql');
