/**
 * Крипто-джерела, додані й виправлені 13.09.2026 для NextCryptoJob.
 *
 * Кеш вакансій спільний: NextRole і NextCryptoJob читають ту саму таблицю
 * `jobs_cache`, і NextCryptoJob бере з неї лише рядки з тегом `web3`. Тому
 * все тут має тег `web3`, а на не-крипто поведінку NextRole ніщо не впливає.
 *
 * Цей файл одночасно:
 *   - джерело правди для міграції 0047 (`overlaySql()`; тест звіряє файл
 *     міграції з цим виводом, тож вони не розійдуться);
 *   - накладка на знімок таблиць для скану насухо (`applyOverlay`), щоб
 *     оцінка «що дасть міграція» рахувалась тим самим кодом.
 *
 * Кожен роботодавець перевірений живим запитом до публічного API його ATS
 * (Greenhouse Job Board API, Lever Postings API, Ashby Posting API тощо): ці
 * API існують саме для того, щоб вакансії читали й показували. Рішення про
 * кожне джерело з посиланнями записані в docs/reference/job-sources-catalogue.md.
 */
import type { AtsProvider } from "./types.js";

export interface CryptoEmployer {
  name: string;
  provider: AtsProvider;
  /** `companies.slug`. Зазвичай це і слаг ATS, як у збору посилань із Getro. */
  slug: string;
  /**
   * Слаг ATS, коли він відрізняється від `slug`: із пробілом
   * (`Sui%20Foundation`) або коли той самий слаг уже зайнятий іншим ATS
   * (Kalshi має дошки і на Greenhouse, і на Ashby).
   */
  atsSlug?: string;
  tags?: string[];
  /** Звідки відомо, що це саме та компанія. */
  note: string;
}

export interface CompanyFix {
  slug: string;
  /** Вилучити рядок: мертва адреса, яку замінює правильна під іншим слагом. */
  drop?: boolean;
  addTags?: string[];
  removeTags?: string[];
  note: string;
}

export interface BoardChange { name: string; enabled: 0 | 1; note: string }

export interface GetroDiscovery { id: number; label: string; url: string; note: string }

/**
 * Роботодавці з публічним ATS. Кожен перевірено 13.09.2026 живим запитом до
 * API й звірено, що це та сама компанія (посилання з її сторінки кар'єри,
 * назва організації на дошці або текст вакансій). Однофамільці, яких ми
 * НЕ беремо, записані в каталозі джерел §11.
 */
export const CRYPTO_EMPLOYERS: CryptoEmployer[] = [
  { name: "Ethereum Foundation", provider: "ashby", slug: "ethereum-foundation", note: "відкритих 13.09: 2; Ashby org 'Ethereum Foundation' publicWebsite ethereum.foundation" },
  { name: "Optimism Foundation", provider: "ashby", slug: "opfoundation", note: "відкритих 13.09: 0; optimism.io/careers links jobs.ashbyhq.com/opfoundation; org 'Optimism Foundation'" },
  { name: "Avalanche Foundation", provider: "ashby", slug: "avalanche-foundation", note: "відкритих 13.09: 0; Ashby org 'Avalanche Foundation' publicWebsite avax.network/about/foundation (0 open now)" },
  { name: "Sui Foundation", provider: "ashby", slug: "sui-foundation", atsSlug: "Sui%20Foundation", note: "відкритих 13.09: 2; sui.io links jobs.ashbyhq.com/Sui%20Foundation (slug has a space, URL-encode); org 'Sui Foundation'" },
  { name: "Aptos Foundation", provider: "ashby", slug: "aptosfoundation", note: "відкритих 13.09: 1; aptosnetwork.com/foundation/careers lists same Ashby job id c566f327; org 'Aptos Foundation'" },
  { name: "NEAR Foundation", provider: "greenhouse", slug: "nearfoundation", note: "відкритих 13.09: 0; near.foundation/careers links job-boards.eu.greenhouse.io/nearfoundation (EU board; 0 open now; US boards-api " },
  { name: "NEAR One", provider: "greenhouse", slug: "nearone", note: "відкритих 13.09: 0; Greenhouse board name 'Near One' (0 open; nearone.org/careers is 404)" },
  { name: "Cosmos Labs", provider: "greenhouse", slug: "cosmoslabs", note: "відкритих 13.09: 1; interchain.io/careers and cosmos.network link job-boards.greenhouse.io/cosmoslabs" },
  { name: "Starknet Foundation", provider: "ashby", slug: "starknetfoundation", note: "відкритих 13.09: 4; Ashby org 'Starknet Foundation' publicWebsite starknet.org" },
  { name: "Celestia Labs", provider: "lever", slug: "celestia", note: "відкритих 13.09: 0; celestia.org/careers links jobs.lever.co/celestia; page title 'Celestia Labs' (0 open now)" },
  { name: "Injective Labs", provider: "ashby", slug: "injective-labs", note: "відкритих 13.09: 6; injectivelabs.org/careers links jobs.ashbyhq.com/injective-labs" },
  { name: "Sei Labs", provider: "ashby", slug: "sei-labs", note: "відкритих 13.09: 7; sei.io/careers links jobs.ashbyhq.com/sei-labs" },
  { name: "Hyperliquid Labs", provider: "ashby", slug: "hyperliquid-labs", atsSlug: "Hyperliquid%20Labs", note: "відкритих 13.09: 2; Ashby org 'Hyperliquid Labs' publicWebsite hyperliquid.xyz (slug has a space); found via paradigm.xyz portfoli" },
  { name: "Aztec Labs", provider: "ashby", slug: "aztec-labs", note: "відкритих 13.09: 1; aztec-labs.com/careers links jobs.ashbyhq.com/aztec-labs" },
  { name: "Hashgraph", provider: "ashby", slug: "hashgraph-ashby", atsSlug: "hashgraph", note: "відкритих 13.09: 4; hashgraph.com/careers links jobs.ashbyhq.com/hashgraph" },
  { name: "Tether", provider: "recruitee", slug: "tether", note: "відкритих 13.09: 157; tether.io/careers links tether.recruitee.com; company 'Tether Operations Limited'" },
  { name: "Tools for Humanity", provider: "ashby", slug: "tools-for-humanity", atsSlug: "Tools%20for%20Humanity", note: "відкритих 13.09: 19; toolsforhumanity.com/careers and world.org/careers link jobs.ashbyhq.com/Tools%20for%20Humanity (slug has spac" },
  { name: "World Foundation", provider: "ashby", slug: "world-foundation", note: "відкритих 13.09: 1; world.org/careers links jobs.ashbyhq.com/world-foundation; org 'World Foundation'" },
  { name: "Aave Labs", provider: "lever_eu", slug: "aavelabs", note: "відкритих 13.09: 10; EU Lever: api.eu.lever.co/v0/postings/aavelabs; page title 'Aave Labs' (aave.com links jobs.eu.lever.co/aave w" },
  { name: "Lido", provider: "ashby", slug: "lido.fi", note: "відкритих 13.09: 1; Ashby org 'Lido' publicWebsite lido.fi; linked from paradigm.xyz portfolio (Lido.fi); lido.fi/careers is 404" },
  { name: "Sky Frontier Foundation", provider: "ashby", slug: "skyecosystem", note: "відкритих 13.09: 0; Ashby org 'Sky Frontier Foundation' publicWebsite insights.skyeco.com (0 open)" },
  { name: "Securitize", provider: "greenhouse", slug: "securitize", note: "відкритих 13.09: 0; Greenhouse board name 'Securitize' (0 open now)" },
  { name: "Messari", provider: "greenhouse", slug: "messari", note: "відкритих 13.09: 0; Greenhouse board name 'Messari' (0 open; messari.io/careers now 'Messari by Blockworks')" },
  { name: "Coin Metrics", provider: "rippling", slug: "coin-metrics", note: "відкритих 13.09: 0; coinmetrics careers page links ats.rippling.com/coin-metrics; companyName 'Coin Metrics' (0 open; coinmetrics." },
  { name: "Kaiko", provider: "lever_eu", slug: "kaiko", note: "відкритих 13.09: 0; kaiko.com/about-kaiko/careers links jobs.eu.lever.co/kaiko (0 open now)" },
  { name: "Chainalysis Government Solutions", provider: "ashby", slug: "chainalysis-government-solutions", note: "відкритих 13.09: 8; chainalysis.com job-openings loads jobs.ashbyhq.com/chainalysis-government-solutions" },
  { name: "TRM Labs", provider: "ashby", slug: "trm-labs", note: "відкритих 13.09: 103; trmlabs.com/careers links jobs.ashbyhq.com/trm-labs" },
  { name: "QuickNode", provider: "ashby", slug: "quicknode", note: "відкритих 13.09: 0; Ashby org 'Quicknode' publicWebsite quicknode.com (0 open)" },
  { name: "Figment", provider: "greenhouse", slug: "figment", note: "відкритих 13.09: 0; figment.io/careers links boards.greenhouse.io/figment; board name 'Figment' (0 open)" },
  { name: "Galaxy Digital", provider: "greenhouse", slug: "galaxydigitalservices", note: "відкритих 13.09: 48; galaxy.com/careers links job-boards.greenhouse.io/galaxydigitalservices" },
  { name: "Kraken", provider: "ashby", slug: "kraken.com", note: "відкритих 13.09: 74; kraken.com/careers links jobs.ashbyhq.com/kraken.com" },
  { name: "Gate", provider: "lever", slug: "gate", note: "відкритих 13.09: 19; Lever page title 'Gate'; exchange roles (KYC, AI agent product in Chinese)" },
  { name: "SatoshiLabs", provider: "ashby", slug: "satoshilabs", note: "відкритих 13.09: 6; satoshilabs.com/careers links jobs.ashbyhq.com/satoshilabs" },
  { name: "Safe Labs", provider: "personio", slug: "safe-labs", note: "відкритих 13.09: 1; safe.global/careers links safe-labs.jobs.personio.com; subcompany 'Safe Labs GmbH'" },
  { name: "Kalshi", provider: "ashby", slug: "kalshi-ashby", atsSlug: "kalshi", note: "відкритих 13.09: 41; Ashby org 'Kalshi' publicWebsite kalshi.com; newest postings 2026-09-06" },
  { name: "Trail of Bits", provider: "workable", slug: "trailofbits", note: "відкритих 13.09: 4; trailofbits.com/careers links apply.workable.com/trailofbits; account name 'Trail of Bits'" },
  { name: "Halborn", provider: "rippling", slug: "halborn", note: "відкритих 13.09: 9; Rippling job text 'About Halborn Inc'; security/BD roles (halborn.com is behind Vercel checkpoint)" },
  { name: "Quantstamp", provider: "ashby", slug: "quantstamp", note: "відкритих 13.09: 0; quantstamp.com/careers links jobs.ashbyhq.com/quantstamp (0 open)" },
  { name: "Sigma Prime", provider: "ashby", slug: "sigp", note: "відкритих 13.09: 1; sigmaprime.io/careers links jobs.ashbyhq.com/sigp" },
  { name: "Hexens", provider: "bamboohr", slug: "hexens", note: "відкритих 13.09: 3; hexens.bamboohr.com og:site_name 'Hexens'; security researcher/red team roles" },
  { name: "B2C2", provider: "greenhouse", slug: "b2c2", note: "відкритих 13.09: 3; b2c2.com embeds boards.eu.greenhouse.io for=b2c2 (EU board, US boards-api works)" },
  { name: "Flowdesk", provider: "workable", slug: "flowdesk", note: "відкритих 13.09: 3; flowdesk.co/careers links flowdesk.workable.com; account name 'Flowdesk'" },
  { name: "Jump Crypto", provider: "greenhouse", slug: "jumpcrypto", note: "відкритих 13.09: 5; jumpcrypto.com/careers links greenhouse jumpcrypto" },
  { name: "Auros", provider: "greenhouse", slug: "aurosglobal", note: "відкритих 13.09: 6; auros.global/careers links greenhouse aurosglobal" },
  { name: "Selini Capital", provider: "greenhouse", slug: "selinicapital", note: "відкритих 13.09: 4; selinicapital.com/careers links greenhouse selinicapital" },
  { name: "QCP", provider: "workable", slug: "qcp-group", note: "відкритих 13.09: 13; qcpgroup.com/career links apply.workable.com/qcp-group; account name 'QCP'" },
  { name: "Presto Labs", provider: "lever", slug: "prestolabs", note: "відкритих 13.09: 6; Lever page title 'Presto'; middle-office/quant roles" },
  { name: "Kronos Research", provider: "greenhouse", slug: "kronosresearch", note: "відкритих 13.09: 0; kronosresearch.com/careers links job-boards.greenhouse.io/kronosresearch (API shows 0 open; site still lists o" },
  { name: "Caladan", provider: "greenhouse", slug: "caladan", note: "відкритих 13.09: 7; caladan.xyz/careers uses gh_jid links; board name 'Caladan'" },
  { name: "Amber Group", provider: "bamboohr", slug: "ambergroup", note: "відкритих 13.09: 4; MEDIUM confidence: ambergroup.bamboohr.com og:site_name 'Amber AI Limited', HK/Beijing crypto roles; ambergrou" },
  { name: "Riot Platforms", provider: "rippling", slug: "riot-platforms-careers", note: "відкритих 13.09: 62; riotplatforms.com/careers links ats.rippling.com/riot-platforms-careers; companyName 'Riot Platforms, Inc.' (b" },
  { name: "Merkle Science", provider: "lever", slug: "merklescience", note: "відкритих 13.09: 25; Lever page title 'Merkle Science'; blockchain intelligence roles" },
  { name: "Nexo", provider: "breezy", slug: "nexo", note: "відкритих 13.09: 24; Breezy company 'Nexo'" },
  { name: "Lightning Labs", provider: "ashby", slug: "lightning", note: "відкритих 13.09: 14; Ashby org 'Lightning Labs' publicWebsite lightning.engineering" },
  { name: "Ether.fi", provider: "ashby", slug: "ether.fi", note: "відкритих 13.09: 13; ether.fi/careers links jobs.ashbyhq.com/ether.fi" },
  { name: "Transak", provider: "breezy", slug: "transak-inc", note: "відкритих 13.09: 10; careers.transak.com links transak-inc.breezy.hr" },
  { name: "Bitvavo", provider: "ashby", slug: "bitvavo", note: "відкритих 13.09: 6; Ashby org 'Bitvavo' publicWebsite bitvavo.com" },
  { name: "Solflare", provider: "smartrecruiters", slug: "solflare", note: "відкритих 13.09: 6; SmartRecruiters company name 'Solflare'" },
  { name: "Uphold", provider: "bamboohr", slug: "uphold", note: "відкритих 13.09: 6; uphold.bamboohr.com og:site_name 'Uphold'; digital assets roles" },
  { name: "Anagram", provider: "ashby", slug: "anagram-ashby", atsSlug: "anagram", note: "відкритих 13.09: 5; Ashby org 'Anagram' publicWebsite anagram.xyz" },
  { name: "Casa", provider: "greenhouse", slug: "casa", note: "відкритих 13.09: 1; casa.io/careers links greenhouse casa" },
  { name: "Logos", provider: "greenhouse", slug: "logos", note: "відкритих 13.09: 4; status.app/jobs links greenhouse logos" },
  { name: "Unchained", provider: "rippling", slug: "unchained", note: "відкритих 13.09: 4; unchained.com/careers links ats.rippling.com/unchained; companyName 'Unchained Capital, Inc.'" },
  { name: "Nethermind", provider: "ashby", slug: "nethermind", note: "відкритих 13.09: 2; jobs.ashbyhq.com/nethermind linked; org 'Nethermind'" },
  { name: "Douro Labs", provider: "ashby", slug: "dourolabs.xyz", note: "відкритих 13.09: 2; Ashby org 'Douro Labs'; also on jobs.solana.com" },
  { name: "P2P.org", provider: "ashby", slug: "p2p.org", note: "відкритих 13.09: 2; p2p.org/career links jobs.ashbyhq.com/p2p.org" },
  { name: "Luno", provider: "greenhouse", slug: "luno", note: "відкритих 13.09: 2; Greenhouse 'Luno'; OTC trader role" },
  { name: "Gensyn", provider: "greenhouse", slug: "gensyn", note: "відкритих 13.09: 2; Greenhouse 'Gensyn'" },
  { name: "Electric Capital", provider: "rippling", slug: "electriccapital", note: "відкритих 13.09: 2; Rippling companyName 'Electric Capital'" },
  { name: "PIP Labs", provider: "lever", slug: "piplabs", note: "відкритих 13.09: 1; Lever 'PIP Labs'" },
  { name: "CoinGecko", provider: "lever", slug: "coingecko", note: "відкритих 13.09: 1; Lever 'CoinGecko'" },
  { name: "Meow", provider: "ashby", slug: "meow", note: "відкритих 13.09: 5; колекція Castle Island, галузь Getro: крипто" },
  { name: "Project Eleven", provider: "ashby", slug: "projecteleven", note: "відкритих 13.09: 2; постквантовий захист біткоїна, колекція Castle Island" },
  { name: "Monad Foundation", provider: "ashby", slug: "monad.foundation", note: "відкритих 13.09: 6; посилання з колекцій Monad і Castle Island; старий ashby:monad мертвий (крапку в слагу різало)" },
  { name: "Wormhole (Asymmetric)", provider: "ashby", slug: "asymmetric.re", note: "відкритих 13.09: 1; посилання з колекції Jump Crypto; старий ashby:asymmetric мертвий через крапку" },
  { name: "Omni Network", provider: "greenhouse", slug: "nomina", note: "відкритих 13.09: 2; посилання з колекції Arbitrum" },
  { name: "Stork Labs", provider: "ashby", slug: "stork", note: "відкритих 13.09: 2; оракул, колекція Injective" },
  { name: "Alpen Labs", provider: "ashby", slug: "alpenlabs", note: "відкритих 13.09: 5; біткоїн-ролап, колекція Castle Island" },
  { name: "Valinor", provider: "workable", slug: "valinor", note: "відкритих 13.09: 1; колекція Castle Island, галузь Getro: крипто" },
  { name: "Nexus", provider: "ashby", slug: "nexus.xyz", note: "відкритих 13.09: 4; старий ashby:nexus мертвий через крапку в слагу" },
  { name: "Sound", provider: "ashby", slug: "sound.xyz", note: "відкритих 13.09: 2; старий ashby:sound мертвий через крапку в слагу" },
  { name: "LI.FI", provider: "ashby", slug: "li.fi", note: "0 вакансій 13.09, дошка жива; старий ashby:li мертвий через крапку в слагу" },
];


/**
 * Виправлення наявних рядків `companies`: мертві слаги, які замінює
 * правильний (здебільшого крапка в слагу Ashby, яку старий збір посилань
 * різав), однофамільці з чужим тегом web3 і не-крипто компанії, що отримали
 * web3 від колекції Getro цілком.
 */
export const COMPANY_FIXES: CompanyFix[] = [
  { slug: "coinbase", addTags: ["web3"], note: "Coinbase: крипто-компанія без тегу web3 (перевірено 13.09, 218 вакансій)" },
  { slug: "uniswapfoundation", addTags: ["web3"], note: "Uniswap Foundation: крипто-компанія без тегу web3 (перевірено 13.09, 0 вакансій)" },
  { slug: "coinhako", addTags: ["web3"], note: "Coinhako: крипто-компанія без тегу web3 (перевірено 13.09, 9 вакансій)" },
  { slug: "skymavis", addTags: ["web3"], note: "Sky Mavis: крипто-компанія без тегу web3 (перевірено 13.09, 6 вакансій)" },
  { slug: "sorare", addTags: ["web3"], note: "Sorare: крипто-компанія без тегу web3 (перевірено 13.09, 3 вакансій)" },
  { slug: "kraken", drop: true, note: "ashby:kraken мертвий (0 вакансій); Kraken живе на ashby:kraken.com" },
  { slug: "monad", drop: true, note: "ashby:monad мертвий; справжня дошка ashby:monad.foundation" },
  { slug: "asymmetric", drop: true, note: "мертвий; справжня ashby:asymmetric.re" },
  { slug: "dourolabs", drop: true, note: "мертвий; справжня ashby:dourolabs.xyz" },
  { slug: "sui", drop: true, note: "ashby:sui мертвий; Sui Foundation на ashby:Sui%20Foundation" },
  { slug: "lido", drop: true, note: "ashby:lido мертвий; справжня ashby:lido.fi" },
  { slug: "tools", drop: true, note: "ashby:tools мертвий; Tools for Humanity на ashby:Tools%20for%20Humanity" },
  { slug: "li", drop: true, note: "ashby:li мертвий; справжня ashby:li.fi" },
  { slug: "nexus", drop: true, note: "ashby:nexus мертвий; справжня ashby:nexus.xyz" },
  { slug: "sound", drop: true, note: "ashby:sound мертвий; справжня ashby:sound.xyz" },
  { slug: "trmlabs", drop: true, note: "greenhouse:trmlabs мертвий (13 порожніх сканів); TRM Labs на ashby:trm-labs" },
  { slug: "spearbit", drop: true, note: "ashby:spearbit мертвий; Cantina/Spearbit наймає через Loxo, який ми не читаємо" },
  { slug: "grayscale", drop: true, note: "greenhouse:grayscale це тестова дошка «Grayscale (Sandbox)»; справжня greenhouse:grayscaleinvestments" },
  { slug: "circle", removeTags: ["web3"], note: "ashby:circle це circle.so (спільноти), а не Circle (USDC), яка наймає через Phenom" },
  { slug: "safe", removeTags: ["web3"], note: "lever:safe це Safe Security (кіберризики), а не Safe{Wallet}" },
  { slug: "galaxy", removeTags: ["web3"], note: "greenhouse:galaxy це Galaxy Integrated Technologies (монтаж охорони), а не Galaxy Digital" },
  { slug: "perle", removeTags: ["web3"], note: "Perle: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "notion", removeTags: ["web3"], note: "Notion: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "ashby", removeTags: ["web3"], note: "Ashby: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "givedirectly", removeTags: ["web3"], note: "GiveDirectly: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "dynamo-ai", removeTags: ["web3"], note: "Dynamo AI: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "pingidentity", removeTags: ["web3"], note: "Ping Identity: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "wealthsimple", removeTags: ["web3"], note: "Wealthsimple: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "crossriverbank", removeTags: ["web3"], note: "Cross River: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "sift", removeTags: ["web3"], note: "Sift: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "auxmoney-gmbh", removeTags: ["web3"], note: "Auxmoney: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "fundingcircle", removeTags: ["web3"], note: "Funding Circle: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "greenhouse", removeTags: ["web3"], note: "Greenhouse: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "wavemm1", removeTags: ["web3"], note: "Wave Mobile Money: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "discord", removeTags: ["web3"], note: "Discord: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "stockx", removeTags: ["web3"], note: "StockX: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "modemobile", removeTags: ["web3"], note: "Current Mobile: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "fuseenergy", removeTags: ["web3"], note: "Fuse Energy: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "transmitsecurity", removeTags: ["web3"], note: "Transmit Security: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "virtuozzo", removeTags: ["web3"], note: "Virtuozzo: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "immuta", removeTags: ["web3"], note: "Immuta: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "sophos", removeTags: ["web3"], note: "Sophos: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "clsgroup", removeTags: ["web3"], note: "CLS: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "helloclue", removeTags: ["web3"], note: "Clue: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "shippo", removeTags: ["web3"], note: "Shippo: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "stashinvest", removeTags: ["web3"], note: "Stash: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "groma", removeTags: ["web3"], note: "Groma: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "masterclass", removeTags: ["web3"], note: "MasterClass: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
  { slug: "webai", removeTags: ["web3"], note: "webAI: не крипто; тег прийшов від колекції Getro цілком (NextCryptoJob уже відсіює її списком NON_CRYPTO_COMPANIES)" },
];

/** Дошки, які вимикаємо або вмикаємо, з причиною. */
export const BOARD_CHANGES: BoardChange[] = [
  { name: "board:global-cryptocareers", enabled: 0,
    note: "умови crypto-careers.com забороняють «crawl, scrape» і «systematic or automated data collection»; RSS немає; за весь час не дала жодного рядка" },
];

/**
 * Колекції Getro, з яких щотижнева розвідка забирає посилання на ATS
 * роботодавців. Щоденний скан їх не читає (GETRO_MODE=discover).
 */
export const GETRO_DISCOVERY: GetroDiscovery[] = [
  { id: 13362, label: "Castle Island Ventures", url: "https://jobs.castleisland.vc", note: "664 вакансії 13.09, 415 ведуть у публічний ATS; безпека й інфраструктура" },
  { id: 20916, label: "Jump Crypto", url: "https://jobs.jumpcrypto.com", note: "186 вакансій, 125 з публічним ATS; трейдинг і безпека" },
  { id: 4184, label: "Arbitrum", url: "https://jobs.arbitrum.io", note: "135 вакансій, 97 з публічним ATS" },
  { id: 13457, label: "Monad", url: "https://eco-jobs.monad.xyz", note: "36 вакансій, 10 з публічним ATS" },
  { id: 13490, label: "Injective", url: "https://injective.getro.com", note: "30 вакансій, 21 з публічним ATS" },
  { id: 6230, label: "Animoca Brands", url: "https://careers.animocabrands.com", note: "17 вакансій, усі з публічним ATS" },
];

// ── накладка на знімок для скану насухо ──────────────────────

type Row = Record<string, unknown>;

const tagsOf = (raw: unknown): string[] => {
  try { const v = JSON.parse(String(raw ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

export function applyOverlay<T extends { companies: Row[]; boards: Row[]; getro: Row[] }>(t: T): T {
  const companies = new Map(t.companies.map((r) => [String(r.slug), { ...r }]));
  for (const f of COMPANY_FIXES) {
    const r = companies.get(f.slug);
    if (!r) continue;
    if (f.drop) { companies.delete(f.slug); continue; }
    const tags = tagsOf(r.tags).filter((x) => !(f.removeTags ?? []).includes(x));
    for (const x of f.addTags ?? []) if (!tags.includes(x)) tags.push(x);
    r.tags = JSON.stringify(tags);
  }
  for (const e of CRYPTO_EMPLOYERS) {
    const prior = companies.get(e.slug);
    const tags = tagsOf(prior?.tags);
    for (const x of e.tags ?? ["web3"]) if (!tags.includes(x)) tags.push(x);
    companies.set(e.slug, {
      ...(prior ?? { discovered_via: "curated", dry_scans: 0, last_fit_at: null }),
      slug: e.slug, name: e.name, ats_provider: e.provider, ats_slug: e.atsSlug ?? e.slug, tags: JSON.stringify(tags),
    });
  }
  const boards = t.boards.map((r) => {
    const ch = BOARD_CHANGES.find((b) => b.name === r.name);
    return ch ? { ...r, enabled: ch.enabled } : r;
  });
  const getro = [...t.getro];
  for (const g of GETRO_DISCOVERY) {
    const i = getro.findIndex((r) => Number(r.collection_id) === g.id);
    const row = { id: `getro-${g.id}`, collection_id: g.id, label: g.label, url: g.url, enabled: 1, tags: '["web3"]' };
    if (i >= 0) getro[i] = { ...getro[i], enabled: 1, tags: '["web3"]' }; else getro.push(row);
  }
  return { ...t, companies: [...companies.values()], boards, getro };
}

// ── SQL міграції ──────────────────────────────────────────────

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * Доповнити JSON-масив тегів без повторів, у SQLite. Порядок наявних
 * зберігається: `json_each` віддає їх за ключем, нові стають у хвіст.
 */
const unionSql = (col: string, add: string[]): string => {
  const extra = add.map((t) => `SELECT ${q(t)}`).join(" UNION ALL ");
  return `(SELECT json_group_array(value) FROM (SELECT value FROM json_each(${col}) UNION SELECT * FROM (${extra}) WHERE 1))`;
};

export function overlaySql(): string {
  const out: string[] = [];
  out.push(`-- Крипто-джерела для NextCryptoJob (13.09.2026).
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
`);
  for (const f of COMPANY_FIXES) {
    out.push(`-- ${f.slug}: ${f.note}`);
    if (f.drop) { out.push(`DELETE FROM companies WHERE slug = ${q(f.slug)};`); continue; }
    if (f.removeTags?.length) {
      out.push(`UPDATE companies SET tags = (SELECT json_group_array(value) FROM json_each(companies.tags) WHERE value NOT IN (${f.removeTags.map(q).join(",")})) WHERE slug = ${q(f.slug)};`);
    }
    if (f.addTags?.length) {
      out.push(`UPDATE companies SET tags = ${unionSql("companies.tags", f.addTags)} WHERE slug = ${q(f.slug)};`);
    }
  }
  for (const e of CRYPTO_EMPLOYERS) {
    const tags = e.tags ?? ["web3"];
    out.push(`-- ${e.name}: ${e.note}`);
    out.push(`INSERT INTO companies (slug,name,ats_provider,ats_slug,tags,discovered_via,added_at)
  VALUES (${q(e.slug)},${q(e.name)},${q(e.provider)},${q(e.atsSlug ?? e.slug)},${q(JSON.stringify(tags))},'curated',datetime('now'))
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, ats_provider=excluded.ats_provider, ats_slug=excluded.ats_slug,
    tags=${unionSql("companies.tags", tags)};`);
  }
  for (const b of BOARD_CHANGES) {
    out.push(`-- ${b.name}: ${b.note}`);
    out.push(`UPDATE country_boards SET enabled = ${b.enabled} WHERE name = ${q(b.name)};`);
  }
  for (const g of GETRO_DISCOVERY) {
    out.push(`-- getro:${g.id} ${g.label}: ${g.note}`);
    out.push(`INSERT INTO getro_collections (id, collection_id, label, url, enabled, tags)
  VALUES (${q(`getro-${g.id}`)}, ${g.id}, ${q(g.label)}, ${q(g.url)}, 1, '["web3"]')
  ON CONFLICT(collection_id) DO UPDATE SET enabled = 1, tags = '["web3"]';`);
  }
  out.push(`INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0047_ncj_crypto_sources.sql');`);
  return out.join("\n") + "\n";
}

if (process.argv[1]?.endsWith("crypto-sources.js")) process.stdout.write(overlaySql());
