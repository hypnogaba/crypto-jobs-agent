import { one, run } from "@/lib/db";
import { deriveCountry } from "@/lib/geo";

/**
 * Проставляє країну після того, як профіль записано.
 *
 * Профіль пишуть чотири місця — сайт, вебхук, крокова анкета бота й розбір CV.
 * Додавати колонку в кожен із чотирьох запитів означало б чотири нагоди
 * забути її в п'ятому. Тому країна виводиться одним кроком після запису.
 *
 * Мовчазна на помилці навмисно: країна лише розширює добірку локальними
 * вакансіями. Якщо її не вдалося вивести, людина бачить глобальні — це гірше,
 * ніж могло бути, але не зламано. Провалити через це збереження профілю було
 * б набагато гіршим обміном.
 */
export async function persistCountry(userId: string, location: string | null): Promise<void> {
  try {
    const u = await one<{ timezone: string | null }>("SELECT timezone FROM users WHERE id=?", userId);
    const country = deriveCountry(location, u?.timezone ?? null);
    await run("UPDATE profiles SET country=? WHERE user_id=?", country, userId);
  } catch { /* краще без країни, ніж без профілю */ }
}
