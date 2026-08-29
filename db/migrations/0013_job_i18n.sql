-- Переклад картки вакансії мовою людини.
--
-- title і summary перекладаються моделлю один раз на вакансію й локаль і
-- лежать тут: та сама вакансія йде десяткам людей з однією мовою, і платити
-- за кожну добірку окремо нема сенсу. Компанія не перекладається ніколи,
-- тому колонки для неї немає. Без ANTHROPIC_API_KEY таблиця лишається
-- порожньою, а картка — мовою оригіналу.
CREATE TABLE IF NOT EXISTS job_i18n (
    job_id     TEXT NOT NULL,
    locale     TEXT NOT NULL,
    title      TEXT NOT NULL,
    summary    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (job_id, locale)
);
