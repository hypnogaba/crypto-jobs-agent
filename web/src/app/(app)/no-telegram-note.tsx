import Link from "next/link";
import { one } from "@/lib/db";
import { GRACE_DAYS } from "@/lib/account-life";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";

/**
 * Попередження для акаунта без Telegram.
 *
 * Вхід тут лише через бота: /login уміє рівно одну дію — відкрити @-бота, а
 * бот на незнайомий chat_id пропонує /start, тобто НОВИЙ акаунт. Тому доки
 * Telegram не підключено, єдиний ключ до кабінету — кука сесії в цьому
 * браузері. Інший пристрій, очищені куки або тридцять днів — і профіль
 * лишається в базі, а людина до нього не дістанеться ніколи.
 *
 * Досі про це не було сказано ніде. Показуємо там, де людина вже сидить, —
 * у кабінеті й у налаштуваннях, — а не лише на кроці 03/03, який легко
 * проминути.
 *
 * Відколи такий акаунт ще й видаляється через п'ятнадцять днів паузи, тут
 * стоїть дата. Сказати «зникне» без дня означало б лякати без потреби; не
 * сказати нічого — видалити мовчки.
 */
export default async function NoTelegramNote({ locale, userId }: { locale: Locale; userId: string }) {
  const row = await one<{ paused_at: string | null }>(
    "SELECT paused_at FROM users WHERE id=?", userId);
  const deadline = row?.paused_at
    ? new Date(new Date(row.paused_at).getTime() + GRACE_DAYS * 86_400_000)
    : null;

  return (
    <div className="card mb-8 px-6 py-5">
      <p className="tag tag-warn inline-block">{t(locale, "warn.noTelegramTitle")}</p>
      <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
        {t(locale, "warn.noTelegram")}
      </p>
      {deadline && (
        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
          {t(locale, "warn.noTelegramDeadline").replace(
            "{date}", deadline.toISOString().slice(0, 10))}
        </p>
      )}
      <Link href="/telegram" className="btn mt-5">{t(locale, "telegram.button")}</Link>
    </div>
  );
}
