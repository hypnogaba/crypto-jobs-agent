import type { Metadata } from "next";
import Link from "next/link";
import Shell from "../shell";
import { detectLocale, sendFeedback } from "../actions";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

/**
 * Одне поле й кнопка. Ані категорій, ані оцінок у зірках: людина, яка хоче
 * щось сказати, має сказати це одразу, а не спершу класифікувати себе.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return pageMeta(locale, "/feedback", t(locale, "fb.title"));
}

export default async function Feedback({
  searchParams,
}: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const locale = await detectLocale();
  const { sent, error } = await searchParams;
  const user = await currentUser();

  if (sent) {
    return (
      <Shell locale={locale} title={t(locale, "fb.thanksTitle")} lede={t(locale, "fb.thanksBody")}>
        <Link href="/" className="btn">{t(locale, "err.home")}</Link>
      </Shell>
    );
  }

  return (
    <Shell locale={locale} eyebrow={t(locale, "nav.feedback")}
           title={t(locale, "fb.title")} lede={t(locale, "fb.lede")}>
      <form action={sendFeedback} className="card flex flex-col gap-5 px-7 py-7">
        <input type="hidden" name="page" value="/feedback" />

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
