import { run } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { persistDerived } from "@/lib/profile-country";

/**
 * Запис профілю в базу. Одне місце на весь сайт.
 *
 * Раніше ця функція жила всередині actions.ts і була видима лише анкеті.
 * Відколи акаунт народжується не на сайті, а в мить підключення Telegram,
 * той самий профіль пише ще й вебхук бота — і другий INSERT із тим самим
 * переліком стовпців був би саме тією розбіжністю, через яку колись
 * зникали місто, вилка й побажання.
 */
export interface WritableProfile {
  spheres: string[]; industries: string[]; customRole: string | null;
  customIndustry: string | null;
  remoteMode: string;
  location: string | null; levelMax: number | null;
  salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null;
  wishes: string | null; cvHighlights: string | null;
}

export async function persistProfile(
  userId: string, rawInput: string | null, source: string,
  p: WritableProfile,
): Promise<void> {
  // Без нового тексту (null) три текстові стовпці лишаються як були: раніше
  // редагування без чернетки ставило cv_text=NULL, raw_input='' і
  // mode='freetext', і резюме зникало з профілю мовчки.
  const keepText = rawInput === null;
  // Резюме це чи тези — каже чернетка, а не довжина рядка. Стара мірка
  // («більше 800 символів») робила з довгих тез резюме: mode='cv',
  // raw_input=NULL, і слова людини зникали з профілю.
  const isCv = source === "cv";
  const textCols = keepText
    ? "mode=profiles.mode, raw_input=profiles.raw_input, cv_text=profiles.cv_text"
    : "mode=excluded.mode, raw_input=excluded.raw_input, cv_text=excluded.cv_text";
  await run(
    `INSERT INTO profiles (user_id,mode,raw_input,cv_text,spheres,custom_role,industries,custom_industry,remote_mode,location,level_max,salary_min,salary_max,salary_currency,wishes,cv_highlights,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ${textCols},
       spheres=excluded.spheres, custom_role=excluded.custom_role,
       industries=excluded.industries, custom_industry=excluded.custom_industry,
       remote_mode=excluded.remote_mode, location=excluded.location,
       level_max=excluded.level_max,
       salary_min=excluded.salary_min, salary_max=excluded.salary_max,
       salary_currency=excluded.salary_currency,
       wishes=excluded.wishes, cv_highlights=excluded.cv_highlights,
       updated_at=datetime('now')`,
    userId, isCv ? "cv" : "freetext",
    isCv || keepText ? null : rawInput,   // файл резюме не зберігаємо, лише розібраний текст
    isCv ? rawInput!.slice(0, 20_000) : null,
    JSON.stringify(p.spheres), p.customRole,
    JSON.stringify(p.industries), p.customIndustry,
    p.remoteMode, p.location, p.levelMax, p.salaryMin, p.salaryMax, p.salaryCurrency, p.wishes, p.cvHighlights);
  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  await persistDerived(userId, env.ANTHROPIC_API_KEY ?? null);

}
