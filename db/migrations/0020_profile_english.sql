-- Слова людини англійською.
--
-- Кнопка «Немає в списку» обіцяє, що написане шукатиметься в назвах вакансій.
-- Для всіх, хто пише не англійською, обіцянка не виконувалась ніколи: підбір
-- робив `title.includes("комуніті менеджер")` по англійських назвах. Людина в
-- Парижі написала «Комуніті менеджер» і отримала п'ять Account Executive у
-- США, тоді як у кеші лежало 69 вакансій зі словом «community».
--
-- Переклад робиться ОДИН раз, коли профіль зберігають, а не під час добірки:
-- там він коштував би виклику моделі на кожну людину щодня.
--
-- normalized_from зберігає ті самі вихідні рядки, з яких переклад зроблено.
-- Збіг означає «нічого не змінилось» — і жодного зайвого виклику моделі на
-- повторному збереженні профілю.
ALTER TABLE profiles ADD COLUMN custom_role_en     TEXT;
ALTER TABLE profiles ADD COLUMN custom_industry_en TEXT;
ALTER TABLE profiles ADD COLUMN wishes_en          TEXT;
ALTER TABLE profiles ADD COLUMN location_en        TEXT;
ALTER TABLE profiles ADD COLUMN normalized_from    TEXT;
