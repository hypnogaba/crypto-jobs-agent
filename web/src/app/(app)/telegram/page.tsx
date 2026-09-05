import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Shell from "@/app/shell";
import { connectTelegram, detectLocale, finishPending } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { PENDING_COOKIE, pendingById } from "@/lib/pending";
import { buildTelegramDeepLink } from "@/lib/connect-token";
import { t } from "@/lib/i18n";
import { formatWhen, nextDelivery } from "@/lib/digest-time";


export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "telegram.title") };
}

export default async function Telegram(
  { searchParams }: { searchParams: Promise<{ waiting?: string }> },
) {
  const locale = await detectLocale();
  const user = await currentUser();

  const botName = (): string => {
    const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
    return env.TELEGRAM_BOT_USERNAME ?? "mynextrole_bot";
  };

  /**
   * Ще не акаунт, а лише заповнена анкета.
   *
   * Сюди приходить кожен, хто щойно пройшов другий крок на сайті: рядка в
   * `users` для нього ще не існує, і саме тому сторінка не жене його на
   * /login, як робила б перевірка сесії.
   */
  if (!user) {
    const jar = await cookies();
    const pendingId = jar.get(PENDING_COOKIE)?.value;
    const pending = pendingId ? await pendingById(pendingId) : null;
    // Ні акаунта, ні анкети — людині тут нічого підключати.
    if (!pending) redirect("/");

    return (
      <Shell locale={locale} eyebrow="03 / 03" title={t(locale, "telegram.title")}
             lede={t(locale, "telegram.lede")}>
        <div className="card px-7 py-8">
          <a href={buildTelegramDeepLink(botName(), pending.token)} className="btn">
            {t(locale, "telegram.button")}
          </a>
          <p className="mono mt-5 text-xs" style={{ color: "var(--muted)" }}>
            @{botName()}
          </p>
          {/* Сторінка не вміє дізнатись про підключення сама: бот пише в базу,
              а не в цю вкладку. Тому кнопка «я підключив» — це просто
              перечитування рядка, і воно ж віддає сесію. */}
          <form action={finishPending} className="mt-5 border-t pt-5" style={{ borderColor: "var(--rule)" }}>
            <button type="submit" className="text-sm link" style={{ color: "var(--muted)" }}>
              {t(locale, "telegram.iConnected")}
            </button>
          </form>
        </div>
        {(await searchParams).waiting ? (
          <p className="mt-6 text-sm" style={{ color: "var(--warn, var(--ink-2))" }}>
            {t(locale, "telegram.waiting")}
          </p>
        ) : null}
        <p className="mt-6 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "telegram.why")}</p>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{t(locale, "telegram.cabinet")}</p>
      </Shell>
    );
  }

  if (user.telegramChatId) {
    const me = await one<{ timezone: string; delivery_hour: number }>(
      "SELECT timezone,delivery_hour FROM users WHERE id=?", user.id);
    const tz = me?.timezone ?? "UTC";
    const when = formatWhen(nextDelivery(tz, me?.delivery_hour ?? 9, new Date()), tz, locale);
    return (
      <Shell locale={locale} title={t(locale, "telegram.done")} lede={t(locale, "telegram.doneLede").replace("{when}", when)}>
        <Link href="/dashboard" className="btn">{t(locale, "dash.title")}</Link>
      </Shell>
    );
  }

  /**
   * Акаунт без Telegram — спадок того часу, коли сайт створював акаунт
   * одразу. Нових таких не з'являється; ці лишаються, доки не підключать
   * бота, і доставки їм немає.
   *
   * ТУТ НЕ КАРБУЄТЬСЯ НІЧОГО, і це головне в цій гілці.
   *
   * Досі токен народжувався просто під час рендеру. Поки в базі лежав сам
   * токен, живий рядок перечитувався й посилання діяло всі 15 хвилин. Тепер у
   * стовпці хеш, назад він не розгортається — тож кожен повторний показ
   * сторінки гасив би той токен, який людина щойно віднесла в бота: вона тисне
   * «Так» і бачить «посилання не працює». Досить було оновити вкладку або
   * повернутись «назад».
   *
   * Кнопка стала серверною дією (connectTelegram): токен карбується в мить
   * дотику й веде просто в чат. Заодно зникає запис у D1 на кожен перегляд
   * сторінки, а обмежує нас саме запис (0044).
   *
   * Окремої кнопки «отримати нове посилання» більше немає навмисно: тепер
   * кожен дотик і є новим посиланням.
   */
  return (
    <Shell locale={locale} eyebrow="03 / 03" title={t(locale, "telegram.title")} lede={t(locale, "telegram.lede")}>
      <div className="card px-7 py-8">
        <form action={connectTelegram}>
          <button type="submit" className="btn">{t(locale, "telegram.button")}</button>
        </form>
        <p className="mono mt-5 text-xs" style={{ color: "var(--muted)" }}>
          @{botName()} · {t(locale, "telegram.expiry")}
        </p>
      </div>
      {/* Кнопки «пропустити» тут немає навмисно.
          Доставка і є продукт: людина, яка пропустить цей крок, зробить усю
          роботу й не отримає нічого, а дізнається про це лише тим, що зранку
          нічого не прийде. Єдиний вихід звідси — підключити Telegram. */}
      <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
        {t(locale, "telegram.why")}
      </p>
    </Shell>
  );
}
