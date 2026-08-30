import Link from "next/link";
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
 */
export default function NoTelegramNote({ locale }: { locale: Locale }) {
  return (
    <div className="card mb-8 px-6 py-5">
      <p className="tag tag-warn inline-block">{t(locale, "warn.noTelegramTitle")}</p>
      <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
        {t(locale, "warn.noTelegram")}
      </p>
      <Link href="/telegram" className="btn mt-5">{t(locale, "telegram.button")}</Link>
    </div>
  );
}
