import Link from "next/link";
import Shell from "@/app/shell";
import { sendFeedback } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { pathFor } from "@/lib/seo";
import type { Locale } from "@/lib/vocab";

/**
 * Одне поле й кнопка. Ані категорій, ані оцінок у зірках: людина, яка хоче
 * щось сказати, має сказати це одразу, а не спершу класифікувати себе.
 */
export default async function FeedbackBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const user = await currentUser();
  const self = pathFor(locale, "/feedback");

  if (sent) {
    return (
      <Shell urlPath="/feedback" locale={locale} title={t(locale, "fb.thanksTitle")} lede={t(locale, "fb.thanksBody")}>
        <Link href={pathFor(locale, "/")} className="btn">{t(locale, "err.home")}</Link>
      </Shell>
    );
  }

  return (
    <Shell urlPath="/feedback" locale={locale} eyebrow={t(locale, "nav.feedback")}
           title={t(locale, "fb.title")} lede={t(locale, "fb.lede")}>
      <form action={sendFeedback} className="card flex flex-col gap-5 px-7 py-7">
        {/* Адреса саме та, з якої написали: тепер їх дві на мову, і «/feedback»
            зашите рядком склеїло б українські відгуки з англійськими. */}
        <input type="hidden" name="page" value={self} />

        <label className="flex flex-col gap-2">
          <span className="eyebrow">{t(locale, "fb.message")}</span>
          <textarea name="message" rows={7} required minLength={3} maxLength={4000}
                    className="field resize-y text-base"
                    placeholder={t(locale, "fb.placeholder")} />
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">{t(locale, "fb.contact")}</span>
          <input type="text" name="contact" maxLength={200} className="field"
                 defaultValue={user?.email ?? ""} placeholder={t(locale, "fb.contactHint")} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>{t(locale, "fb.contactWhy")}</span>
        </label>

        {error && (
          <p className="text-sm" style={{ color: "var(--bad)" }}>{t(locale, `fb.${error}`)}</p>
        )}

        <button type="submit" className="btn mt-1 justify-center">{t(locale, "fb.send")}</button>
      </form>
    </Shell>
  );
}
