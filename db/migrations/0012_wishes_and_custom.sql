-- Побажання й «свої» відповіді.
--
-- wishes — вільний текст, якого немає в кнопках: «тільки стартапи»,
-- «без on-call», «англомовна команда». Досі такий текст від підключеної
-- людини або губився, або — гірше — переписував їй профіль порожніми
-- сферами. Тепер він накопичується тут і показується в /profile.
--
-- custom_industry / custom_seniority — те, що людина написала на кнопці
-- «Немає в списку» в боті. Чернетка їх збирала, а запис у профіль мовчки
-- губив: в базі лишалась лише custom_role.
ALTER TABLE profiles ADD COLUMN wishes           TEXT;
ALTER TABLE profiles ADD COLUMN custom_industry  TEXT;
ALTER TABLE profiles ADD COLUMN custom_seniority TEXT;
