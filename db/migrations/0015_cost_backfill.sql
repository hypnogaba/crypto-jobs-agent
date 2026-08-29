-- db/migrations/0015_cost_backfill.sql
-- Рядки api_usage, записані до появи таблиці цін, мають cost_usd=0.
-- Ставки — ті самі, що в web/src/lib/pricing.ts (USD за 1M токенів).
UPDATE api_usage SET cost_usd = (input_tokens * 1.0 + output_tokens * 5.0) / 1000000.0
 WHERE cost_usd = 0 AND model LIKE 'claude-haiku-4-5%';
UPDATE api_usage SET cost_usd = (input_tokens * 2.0 + output_tokens * 10.0) / 1000000.0
 WHERE cost_usd = 0 AND model LIKE 'claude-sonnet-5%';
UPDATE api_usage SET cost_usd = (input_tokens * 5.0 + output_tokens * 25.0) / 1000000.0
 WHERE cost_usd = 0 AND model LIKE 'claude-opus-5%';
