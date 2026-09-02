import type { D1Client } from "./d1.js";
import { notifyOwner } from "./notify.js";

/**
 * Акаунти, до яких нам нікуди слати.
 *
 * Виміряно 02.09: сім акаунтів із двадцяти чотирьох не мали Telegram. Вони
 * отримали 105 добірок і зробили НУЛЬ подач на вакансію — проти 44 подач у
 * сімнадцяти підключених. Двоє вже не мали навіть сесії, тобто до власного
 * кабінету не дістались би ніколи: вхід у нас лише через бота.
 *
 * Кожна така добірка коштує читань D1, викликів моделі й вакансій, які після
 * запису в `sent` більше нікому не покажуться. Тобто ми щодня платили за те,
 * чого ніхто не бачив.
 *
 * Нових таких акаунтів більше не з'являється: сайт створює акаунт лише в мить
 * підключення Telegram (див. `pending_signups`). Цей файл прибирає спадок.
 *
 * Два кроки, і другий не квапиться:
 *   1. пауза одразу — доставки немає, витрат немає;
 *   2. видалення через п'ятнадцять днів — рівно стільки, скільки живе кука
 *      сесії ще з запасом, тож людина, яка повернеться на сайт із того
 *      самого браузера, встигне побачити попередження й підключити бота.
 *
 * Попередити інакше ми не можемо, і це не недогляд: у такого акаунта немає
 * ЖОДНОГО каналу зв'язку. Саме тому він і видаляється.
 *
 * Те саме число лежить у `web/src/lib/account-life.ts`: там воно показується
 * людині датою в попередженні. Два пакети не діляться кодом, тож копія
 * свідома, і міняти їх треба разом.
 */
export const GRACE_DAYS = 15;

export interface OrphanRow {
  id: string;
  status: string;
  paused_reason: string | null;
  paused_at: string | null;
}

export interface OrphanPlan { pause: string[]; drop: string[] }

/** Що зробити з рядками без Telegram. Чиста функція — її й перевіряє тест. */
export function orphanPlan(rows: OrphanRow[], now: Date): OrphanPlan {
  const deadline = now.getTime() - GRACE_DAYS * 86_400_000;
  const pause: string[] = [];
  const drop: string[] = [];
  for (const r of rows) {
    if (r.status === "active") { pause.push(r.id); continue; }
    // Видаляємо лише тих, кого ми ж і поставили на паузу за цією причиною.
    // Ручна пауза («/pause») і відв'язка при переприв'язці — інші історії,
    // і рішення про них не наше.
    if (r.paused_reason !== "no_telegram") continue;
    // Без позначки часу відлік починається зараз, а не заднім числом:
    // рядок, поставлений на паузу до появи стовпця, теж має свої п'ятнадцять днів.
    if (!r.paused_at) continue;
    if (new Date(r.paused_at).getTime() <= deadline) drop.push(r.id);
  }
  return { pause, drop };
}

/** Застосувати план. Повертає, що саме зроблено, — для журналу й сповіщення. */
export async function retireUnreachable(d1: D1Client, now: Date): Promise<OrphanPlan> {
  const rows = await d1.query<OrphanRow>(
    "SELECT id,status,paused_reason,paused_at FROM users WHERE telegram_chat_id IS NULL");
  const plan = orphanPlan(rows, now);

  for (const id of plan.pause) {
    await d1.execute(
      `UPDATE users SET status='paused', paused_reason='no_telegram',
         paused_at=?, updated_at=datetime('now') WHERE id=?`,
      [now.toISOString(), id]);
  }
  // Каскад забирає профіль, сесії, добірки й реакції разом із рядком; відгук
  // із сайту навмисно лишається (див. 0004): він переживає акаунт.
  for (const id of plan.drop) {
    await d1.execute("DELETE FROM users WHERE id=?", [id]);
  }

  if (plan.pause.length) {
    console.log(`Без Telegram: ${plan.pause.length} на паузу.`);
  }
  if (plan.drop.length) {
    console.log(`Без Telegram понад ${GRACE_DAYS} днів: видалено ${plan.drop.length}.`);
    await notifyOwner(
      `Видалено ${plan.drop.length} акаунтів без Telegram (пауза понад ${GRACE_DAYS} днів).`);
  }
  return plan;
}
