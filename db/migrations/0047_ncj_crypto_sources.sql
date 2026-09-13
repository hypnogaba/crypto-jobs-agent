-- Крипто-джерела для NextCryptoJob (13.09.2026).
--
-- ЗГЕНЕРОВАНО з scanner/src/crypto-sources.ts командою
--   cd scanner && npm run build && node dist/crypto-sources.js > ../db/migrations/0047_ncj_crypto_sources.sql
-- Правити треба той файл, а не цей: тест crypto-sources.test.ts звіряє їх.
--
-- Що робить: додає крипто-роботодавців із публічним ATS (тег web3),
-- виправляє хибні й мертві рядки компаній, знімає тег web3 з компаній, які
-- не крипто, вимикає мертві дошки й додає колекції Getro для щотижневого
-- збору посилань на ATS. Причини кожного рядка: у тому ж .ts і в
-- docs/reference/job-sources-catalogue.md.

-- coinbase: Coinbase: крипто-компанія без тегу web3 (перевірено 13.09, 218 вакансій)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1)) WHERE slug = 'coinbase';
-- uniswapfoundation: Uniswap Foundation: крипто-компанія без тегу web3 (перевірено 13.09, 0 вакансій)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1)) WHERE slug = 'uniswapfoundation';
-- coinhako: Coinhako: крипто-компанія без тегу web3 (перевірено 13.09, 9 вакансій)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1)) WHERE slug = 'coinhako';
-- skymavis: Sky Mavis: крипто-компанія без тегу web3 (перевірено 13.09, 6 вакансій)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1)) WHERE slug = 'skymavis';
-- sorare: Sorare: крипто-компанія без тегу web3 (перевірено 13.09, 3 вакансій)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1)) WHERE slug = 'sorare';
-- kraken: ashby:kraken мертвий (0 вакансій); Kraken живе на ashby:kraken.com
DELETE FROM companies WHERE slug = 'kraken';
-- monad: ashby:monad мертвий; справжня дошка ashby:monad.foundation
DELETE FROM companies WHERE slug = 'monad';
-- asymmetric: мертвий; справжня ashby:asymmetric.re
DELETE FROM companies WHERE slug = 'asymmetric';
-- dourolabs: мертвий; справжня ashby:dourolabs.xyz
DELETE FROM companies WHERE slug = 'dourolabs';
-- sui: ashby:sui мертвий; Sui Foundation на ashby:Sui%20Foundation
DELETE FROM companies WHERE slug = 'sui';
-- lido: ashby:lido мертвий; справжня ashby:lido.fi
DELETE FROM companies WHERE slug = 'lido';
-- tools: ashby:tools мертвий; Tools for Humanity на ashby:Tools%20for%20Humanity
DELETE FROM companies WHERE slug = 'tools';
-- li: ashby:li мертвий; справжня ashby:li.fi
DELETE FROM companies WHERE slug = 'li';
-- nexus: ashby:nexus мертвий; справжня ashby:nexus.xyz
DELETE FROM companies WHERE slug = 'nexus';
-- sound: ashby:sound мертвий; справжня ashby:sound.xyz
DELETE FROM companies WHERE slug = 'sound';
-- trmlabs: greenhouse:trmlabs мертвий (13 порожніх сканів); TRM Labs на ashby:trm-labs
DELETE FROM companies WHERE slug = 'trmlabs';
-- spearbit: ashby:spearbit мертвий; Cantina/Spearbit наймає через Loxo, який ми не читаємо
DELETE FROM companies WHERE slug = 'spearbit';
-- grayscale: greenhouse:grayscale це тестова дошка «Grayscale (Sandbox)»; справжня greenhouse:grayscaleinvestments
DELETE FROM companies WHERE slug = 'grayscale';
-- circle: ashby:circle це circle.so (спільноти), а не Circle (USDC), яка наймає через Phenom
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'circle';
-- safe: lever:safe це Safe Security (кіберризики), а не Safe{Wallet}
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'safe';
-- galaxy: greenhouse:galaxy це Galaxy Integrated Technologies (монтаж охорони), а не Galaxy Digital
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'galaxy';
-- perle: Perle: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'perle';
-- notion: Notion: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'notion';
-- ashby: Ashby: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'ashby';
-- givedirectly: GiveDirectly: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'givedirectly';
-- dynamo-ai: Dynamo AI: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'dynamo-ai';
-- pingidentity: Ping Identity: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'pingidentity';
-- wealthsimple: Wealthsimple: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'wealthsimple';
-- crossriverbank: Cross River: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'crossriverbank';
-- sift: Sift: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'sift';
-- auxmoney-gmbh: Auxmoney: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'auxmoney-gmbh';
-- fundingcircle: Funding Circle: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'fundingcircle';
-- greenhouse: Greenhouse: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'greenhouse';
-- wavemm1: Wave Mobile Money: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'wavemm1';
-- discord: Discord: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'discord';
-- stockx: StockX: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'stockx';
-- modemobile: Current Mobile: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'modemobile';
-- fuseenergy: Fuse Energy: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'fuseenergy';
-- transmitsecurity: Transmit Security: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'transmitsecurity';
-- virtuozzo: Virtuozzo: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'virtuozzo';
-- immuta: Immuta: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'immuta';
-- sophos: Sophos: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'sophos';
-- clsgroup: CLS: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'clsgroup';
-- helloclue: Clue: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'helloclue';
-- shippo: Shippo: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'shippo';
-- stashinvest: Stash: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'stashinvest';
-- groma: Groma: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'groma';
-- masterclass: MasterClass: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'masterclass';
-- webai: webAI: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)
UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN ('web3')) WHERE slug = 'webai';
-- Ethereum Foundation: відкритих 13.09: 2; Ashby org 'Ethereum Foundation' publicWebsite ethereum.foundation
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('ethereum-foundation','Ethereum Foundation','ashby','ethereum-foundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Optimism Foundation: відкритих 13.09: 0; optimism.io/careers links jobs.ashbyhq.com/opfoundation; org 'Optimism Foundation'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('opfoundation','Optimism Foundation','ashby','opfoundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Avalanche Foundation: відкритих 13.09: 0; Ashby org 'Avalanche Foundation' publicWebsite avax.network/about/foundation (0 open now)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('avalanche-foundation','Avalanche Foundation','ashby','avalanche-foundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Sui Foundation: відкритих 13.09: 2; sui.io links jobs.ashbyhq.com/Sui%20Foundation (slug has a space, URL-encode); org 'Sui Foundation'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('sui-foundation','Sui Foundation','ashby','Sui%20Foundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Aptos Foundation: відкритих 13.09: 1; aptosnetwork.com/foundation/careers lists same Ashby job id c566f327; org 'Aptos Foundation'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('aptosfoundation','Aptos Foundation','ashby','aptosfoundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- NEAR Foundation: відкритих 13.09: 0; near.foundation/careers links job-boards.eu.greenhouse.io/nearfoundation (EU board; 0 open now; US boards-api 
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('nearfoundation','NEAR Foundation','greenhouse','nearfoundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- NEAR One: відкритих 13.09: 0; Greenhouse board name 'Near One' (0 open; nearone.org/careers is 404)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('nearone','NEAR One','greenhouse','nearone','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Cosmos Labs: відкритих 13.09: 1; interchain.io/careers and cosmos.network link job-boards.greenhouse.io/cosmoslabs
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('cosmoslabs','Cosmos Labs','greenhouse','cosmoslabs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Starknet Foundation: відкритих 13.09: 4; Ashby org 'Starknet Foundation' publicWebsite starknet.org
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('starknetfoundation','Starknet Foundation','ashby','starknetfoundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Celestia Labs: відкритих 13.09: 0; celestia.org/careers links jobs.lever.co/celestia; page title 'Celestia Labs' (0 open now)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('celestia','Celestia Labs','lever','celestia','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Injective Labs: відкритих 13.09: 6; injectivelabs.org/careers links jobs.ashbyhq.com/injective-labs
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('injective-labs','Injective Labs','ashby','injective-labs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Sei Labs: відкритих 13.09: 7; sei.io/careers links jobs.ashbyhq.com/sei-labs
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('sei-labs','Sei Labs','ashby','sei-labs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Hyperliquid Labs: відкритих 13.09: 2; Ashby org 'Hyperliquid Labs' publicWebsite hyperliquid.xyz (slug has a space); found via paradigm.xyz portfoli
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('hyperliquid-labs','Hyperliquid Labs','ashby','Hyperliquid%20Labs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Aztec Labs: відкритих 13.09: 1; aztec-labs.com/careers links jobs.ashbyhq.com/aztec-labs
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('aztec-labs','Aztec Labs','ashby','aztec-labs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Hashgraph: відкритих 13.09: 4; hashgraph.com/careers links jobs.ashbyhq.com/hashgraph
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('hashgraph-ashby','Hashgraph','ashby','hashgraph','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Tether: відкритих 13.09: 157; tether.io/careers links tether.recruitee.com; company 'Tether Operations Limited'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('tether','Tether','recruitee','tether','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Tools for Humanity: відкритих 13.09: 19; toolsforhumanity.com/careers and world.org/careers link jobs.ashbyhq.com/Tools%20for%20Humanity (slug has spac
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('tools-for-humanity','Tools for Humanity','ashby','Tools%20for%20Humanity','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- World Foundation: відкритих 13.09: 1; world.org/careers links jobs.ashbyhq.com/world-foundation; org 'World Foundation'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('world-foundation','World Foundation','ashby','world-foundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Aave Labs: відкритих 13.09: 10; EU Lever: api.eu.lever.co/v0/postings/aavelabs; page title 'Aave Labs' (aave.com links jobs.eu.lever.co/aave w
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('aavelabs','Aave Labs','lever_eu','aavelabs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Lido: відкритих 13.09: 1; Ashby org 'Lido' publicWebsite lido.fi; linked from paradigm.xyz portfolio (Lido.fi); lido.fi/careers is 404
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('lido.fi','Lido','ashby','lido.fi','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Sky Frontier Foundation: відкритих 13.09: 0; Ashby org 'Sky Frontier Foundation' publicWebsite insights.skyeco.com (0 open)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('skyecosystem','Sky Frontier Foundation','ashby','skyecosystem','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Securitize: відкритих 13.09: 0; Greenhouse board name 'Securitize' (0 open now)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('securitize','Securitize','greenhouse','securitize','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Messari: відкритих 13.09: 0; Greenhouse board name 'Messari' (0 open; messari.io/careers now 'Messari by Blockworks')
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('messari','Messari','greenhouse','messari','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Coin Metrics: відкритих 13.09: 0; coinmetrics careers page links ats.rippling.com/coin-metrics; companyName 'Coin Metrics' (0 open; coinmetrics.
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('coin-metrics','Coin Metrics','rippling','coin-metrics','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Kaiko: відкритих 13.09: 0; kaiko.com/about-kaiko/careers links jobs.eu.lever.co/kaiko (0 open now)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('kaiko','Kaiko','lever_eu','kaiko','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Chainalysis Government Solutions: відкритих 13.09: 8; chainalysis.com job-openings loads jobs.ashbyhq.com/chainalysis-government-solutions
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('chainalysis-government-solutions','Chainalysis Government Solutions','ashby','chainalysis-government-solutions','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- TRM Labs: відкритих 13.09: 103; trmlabs.com/careers links jobs.ashbyhq.com/trm-labs
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('trm-labs','TRM Labs','ashby','trm-labs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- QuickNode: відкритих 13.09: 0; Ashby org 'Quicknode' publicWebsite quicknode.com (0 open)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('quicknode','QuickNode','ashby','quicknode','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Figment: відкритих 13.09: 0; figment.io/careers links boards.greenhouse.io/figment; board name 'Figment' (0 open)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('figment','Figment','greenhouse','figment','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Galaxy Digital: відкритих 13.09: 48; galaxy.com/careers links job-boards.greenhouse.io/galaxydigitalservices
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('galaxydigitalservices','Galaxy Digital','greenhouse','galaxydigitalservices','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Kraken: відкритих 13.09: 74; kraken.com/careers links jobs.ashbyhq.com/kraken.com
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('kraken.com','Kraken','ashby','kraken.com','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Gate: відкритих 13.09: 19; Lever page title 'Gate'; exchange roles (KYC, AI agent product in Chinese)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('gate','Gate','lever','gate','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- SatoshiLabs: відкритих 13.09: 6; satoshilabs.com/careers links jobs.ashbyhq.com/satoshilabs
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('satoshilabs','SatoshiLabs','ashby','satoshilabs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Safe Labs: відкритих 13.09: 1; safe.global/careers links safe-labs.jobs.personio.com; subcompany 'Safe Labs GmbH'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('safe-labs','Safe Labs','personio','safe-labs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Kalshi: відкритих 13.09: 41; Ashby org 'Kalshi' publicWebsite kalshi.com; newest postings 2026-09-06
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('kalshi-ashby','Kalshi','ashby','kalshi','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Trail of Bits: відкритих 13.09: 4; trailofbits.com/careers links apply.workable.com/trailofbits; account name 'Trail of Bits'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('trailofbits','Trail of Bits','workable','trailofbits','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Halborn: відкритих 13.09: 9; Rippling job text 'About Halborn Inc'; security/BD roles (halborn.com is behind Vercel checkpoint)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('halborn','Halborn','rippling','halborn','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Quantstamp: відкритих 13.09: 0; quantstamp.com/careers links jobs.ashbyhq.com/quantstamp (0 open)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('quantstamp','Quantstamp','ashby','quantstamp','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Sigma Prime: відкритих 13.09: 1; sigmaprime.io/careers links jobs.ashbyhq.com/sigp
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('sigp','Sigma Prime','ashby','sigp','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Hexens: відкритих 13.09: 3; hexens.bamboohr.com og:site_name 'Hexens'; security researcher/red team roles
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('hexens','Hexens','bamboohr','hexens','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- B2C2: відкритих 13.09: 3; b2c2.com embeds boards.eu.greenhouse.io for=b2c2 (EU board, US boards-api works)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('b2c2','B2C2','greenhouse','b2c2','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Flowdesk: відкритих 13.09: 3; flowdesk.co/careers links flowdesk.workable.com; account name 'Flowdesk'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('flowdesk','Flowdesk','workable','flowdesk','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Jump Crypto: відкритих 13.09: 5; jumpcrypto.com/careers links greenhouse jumpcrypto
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('jumpcrypto','Jump Crypto','greenhouse','jumpcrypto','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Auros: відкритих 13.09: 6; auros.global/careers links greenhouse aurosglobal
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('aurosglobal','Auros','greenhouse','aurosglobal','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Selini Capital: відкритих 13.09: 4; selinicapital.com/careers links greenhouse selinicapital
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('selinicapital','Selini Capital','greenhouse','selinicapital','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- QCP: відкритих 13.09: 13; qcpgroup.com/career links apply.workable.com/qcp-group; account name 'QCP'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('qcp-group','QCP','workable','qcp-group','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Presto Labs: відкритих 13.09: 6; Lever page title 'Presto'; middle-office/quant roles
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('prestolabs','Presto Labs','lever','prestolabs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Kronos Research: відкритих 13.09: 0; kronosresearch.com/careers links job-boards.greenhouse.io/kronosresearch (API shows 0 open; site still lists o
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('kronosresearch','Kronos Research','greenhouse','kronosresearch','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Caladan: відкритих 13.09: 7; caladan.xyz/careers uses gh_jid links; board name 'Caladan'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('caladan','Caladan','greenhouse','caladan','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Amber Group: відкритих 13.09: 4; MEDIUM confidence: ambergroup.bamboohr.com og:site_name 'Amber AI Limited', HK/Beijing crypto roles; ambergrou
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('ambergroup','Amber Group','bamboohr','ambergroup','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Riot Platforms: відкритих 13.09: 62; riotplatforms.com/careers links ats.rippling.com/riot-platforms-careers; companyName 'Riot Platforms, Inc.' (b
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('riot-platforms-careers','Riot Platforms','rippling','riot-platforms-careers','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Merkle Science: відкритих 13.09: 25; Lever page title 'Merkle Science'; blockchain intelligence roles
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('merklescience','Merkle Science','lever','merklescience','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Nexo: відкритих 13.09: 24; Breezy company 'Nexo'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('nexo','Nexo','breezy','nexo','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Lightning Labs: відкритих 13.09: 14; Ashby org 'Lightning Labs' publicWebsite lightning.engineering
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('lightning','Lightning Labs','ashby','lightning','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Ether.fi: відкритих 13.09: 13; ether.fi/careers links jobs.ashbyhq.com/ether.fi
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('ether.fi','Ether.fi','ashby','ether.fi','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Transak: відкритих 13.09: 10; careers.transak.com links transak-inc.breezy.hr
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('transak-inc','Transak','breezy','transak-inc','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Bitvavo: відкритих 13.09: 6; Ashby org 'Bitvavo' publicWebsite bitvavo.com
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('bitvavo','Bitvavo','ashby','bitvavo','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Solflare: відкритих 13.09: 6; SmartRecruiters company name 'Solflare'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('solflare','Solflare','smartrecruiters','solflare','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Uphold: відкритих 13.09: 6; uphold.bamboohr.com og:site_name 'Uphold'; digital assets roles
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('uphold','Uphold','bamboohr','uphold','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Anagram: відкритих 13.09: 5; Ashby org 'Anagram' publicWebsite anagram.xyz
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('anagram-ashby','Anagram','ashby','anagram','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Casa: відкритих 13.09: 1; casa.io/careers links greenhouse casa
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('casa','Casa','greenhouse','casa','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Logos: відкритих 13.09: 4; status.app/jobs links greenhouse logos
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('logos','Logos','greenhouse','logos','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Unchained: відкритих 13.09: 4; unchained.com/careers links ats.rippling.com/unchained; companyName 'Unchained Capital, Inc.'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('unchained','Unchained','rippling','unchained','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Nethermind: відкритих 13.09: 2; jobs.ashbyhq.com/nethermind linked; org 'Nethermind'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('nethermind','Nethermind','ashby','nethermind','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Douro Labs: відкритих 13.09: 2; Ashby org 'Douro Labs'; also on jobs.solana.com
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('dourolabs.xyz','Douro Labs','ashby','dourolabs.xyz','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- P2P.org: відкритих 13.09: 2; p2p.org/career links jobs.ashbyhq.com/p2p.org
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('p2p.org','P2P.org','ashby','p2p.org','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Luno: відкритих 13.09: 2; Greenhouse 'Luno'; OTC trader role
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('luno','Luno','greenhouse','luno','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Gensyn: відкритих 13.09: 2; Greenhouse 'Gensyn'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('gensyn','Gensyn','greenhouse','gensyn','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Electric Capital: відкритих 13.09: 2; Rippling companyName 'Electric Capital'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('electriccapital','Electric Capital','rippling','electriccapital','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- PIP Labs: відкритих 13.09: 1; Lever 'PIP Labs'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('piplabs','PIP Labs','lever','piplabs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- CoinGecko: відкритих 13.09: 1; Lever 'CoinGecko'
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('coingecko','CoinGecko','lever','coingecko','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Meow: відкритих 13.09: 5; колекція Castle Island, галузь Getro: крипто
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('meow','Meow','ashby','meow','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Project Eleven: відкритих 13.09: 2; постквантовий захист біткоїна, колекція Castle Island
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('projecteleven','Project Eleven','ashby','projecteleven','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Monad Foundation: відкритих 13.09: 6; посилання з колекцій Monad і Castle Island; старий ashby:monad мертвий (крапку в слагу різало)
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('monad.foundation','Monad Foundation','ashby','monad.foundation','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Wormhole (Asymmetric): відкритих 13.09: 1; посилання з колекції Jump Crypto; старий ashby:asymmetric мертвий через крапку
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('asymmetric.re','Wormhole (Asymmetric)','ashby','asymmetric.re','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Omni Network: відкритих 13.09: 2; посилання з колекції Arbitrum
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('nomina','Omni Network','greenhouse','nomina','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Stork Labs: відкритих 13.09: 2; оракул, колекція Injective
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('stork','Stork Labs','ashby','stork','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Alpen Labs: відкритих 13.09: 5; біткоїн-ролап, колекція Castle Island
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('alpenlabs','Alpen Labs','ashby','alpenlabs','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Valinor: відкритих 13.09: 1; колекція Castle Island, галузь Getro: крипто
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('valinor','Valinor','workable','valinor','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Nexus: відкритих 13.09: 4; старий ashby:nexus мертвий через крапку в слагу
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('nexus.xyz','Nexus','ashby','nexus.xyz','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- Sound: відкритих 13.09: 2; старий ashby:sound мертвий через крапку в слагу
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('sound.xyz','Sound','ashby','sound.xyz','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- LI.FI: 0 вакансій 13.09, дошка жива; старий ashby:li мертвий через крапку в слагу
INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES ('li.fi','LI.FI','ashby','li.fi','["web3"]','curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(companies.tags) UNION SELECT * FROM (SELECT 'web3') WHERE 1));
-- board:global-cryptocareers: умови crypto-careers.com забороняють «crawl, scrape» і «systematic or automated data collection»; RSS немає; за весь час не дала жодного рядка
UPDATE country_boards SET enabled = 0 WHERE name = 'board:global-cryptocareers';
-- getro:13362 Castle Island Ventures: 664 вакансії 13.09, 415 ведуть у публічний ATS; безпека й інфраструктура
INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES ('getro-13362', 13362, 'Castle Island Ventures', 'https://jobs.castleisland.vc', 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';
-- getro:20916 Jump Crypto: 186 вакансій, 125 з публічним ATS; трейдинг і безпека
INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES ('getro-20916', 20916, 'Jump Crypto', 'https://jobs.jumpcrypto.com', 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';
-- getro:4184 Arbitrum: 135 вакансій, 97 з публічним ATS
INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES ('getro-4184', 4184, 'Arbitrum', 'https://jobs.arbitrum.io', 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';
-- getro:13457 Monad: 36 вакансій, 10 з публічним ATS
INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES ('getro-13457', 13457, 'Monad', 'https://eco-jobs.monad.xyz', 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';
-- getro:13490 Injective: 30 вакансій, 21 з публічним ATS
INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES ('getro-13490', 13490, 'Injective', 'https://injective.getro.com', 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';
-- getro:6230 Animoca Brands: 17 вакансій, усі з публічним ATS
INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES ('getro-6230', 6230, 'Animoca Brands', 'https://careers.animocabrands.com', 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0047_ncj_crypto_sources.sql');
