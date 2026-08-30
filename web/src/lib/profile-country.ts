import { one, run } from "@/lib/db";
import { deriveCountry } from "@/lib/geo";
import { normalizeCity, normalizeFreeText } from "@/lib/normalize-text";
import { logUsage } from "@/lib/usage";

/**
 * Виведені поля профілю: країна й слова людини англійською.
 *
 * Профіль пишуть чотири місця — сайт, вебхук, крокова анкета бота й розбір CV.
 * Додавати стовпці в кожен із чотирьох запитів означало б чотири нагоди
 * забути їх у п'ятому. Тому виведене проставляється одним кроком ПІСЛЯ запису,
 * і читає воно те, що щойно лягло в базу, а не те, що передав викликач.
 *
 * Мовчазна на помилці навмисно: виведені поля лише розширюють добірку. Якщо
 * їх не вдалося обчислити, людина бачить менше, ніж могла б, — це гірше, ніж
 * могло бути, але не зламано. Провалити через це збереження профілю було б
 * набагато гіршим обміном.
 */
interface Row {
  location: string | null;
  custom_role: string | null;
  custom_industry: string | null;
  wishes: string | null;
  normalized_from: string | null;
}

/** Ті самі рядки, з яких зроблено переклад. Збіг = нічого не змінилось. */
const sourceKey = (r: Row): string =>
  JSON.stringify([r.custom_role ?? "", r.custom_industry ?? "", r.wishes ?? "", r.location ?? ""]);

export async function persistDerived(userId: string, apiKey: string | null): Promise<void> {
  try {
    const r = await one<Row>(
      `SELECT location, custom_role, custom_industry, wishes, normalized_from
         FROM profiles WHERE user_id=?`, userId);
    if (!r) return;

    // Країна й місто — детерміновані й дешеві, тому рахуються завжди.
    // Часовий пояс сюди не входить: країна — це відповідь на «де хочеш
    // працювати», а не здогад про місце перебування.
    const country = deriveCountry(r.location);
    const locationEn = normalizeCity(r.location);

    if (r.normalized_from === sourceKey(r)) {
      await run("UPDATE profiles SET country=?, location_en=? WHERE user_id=?",
        country, locationEn, userId);
      return;
    }

    // Слова змінились — перекладаємо. Модель тут вмикається щонайбільше
    // тричі на збереження профілю, а не щодня на кожну добірку.
    const note = (u: { model: string; inputTokens: number; outputTokens: number; ok: boolean }) =>
      logUsage({ operation: "normalize_text", ...u });
    const [role, industry, wishes] = await Promise.all([
      normalizeFreeText(r.custom_role, apiKey, note),
      normalizeFreeText(r.custom_industry, apiKey, note),
      normalizeFreeText(r.wishes, apiKey, note),
    ]);

    await run(
      `UPDATE profiles
          SET country=?, location_en=?, custom_role_en=?, custom_industry_en=?,
              wishes_en=?, normalized_from=?
        WHERE user_id=?`,
      country, locationEn, role, industry, wishes, sourceKey(r), userId);
  } catch { /* краще без виведених полів, ніж без профілю */ }
}
