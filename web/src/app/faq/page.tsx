import Shell from "../shell";
import Footer from "../footer";
import { detectLocale } from "../actions";
import { t } from "@/lib/i18n";

const KEYS = ["cost", "apply", "sources", "cv", "why5", "wrong", "stop", "telegram", "languages", "dead"];

export default async function Faq() {
  const locale = await detectLocale();
  return (
    <>
      <Shell locale={locale} eyebrow={t(locale, "nav.faq")} title={t(locale, "faq.title")}>
        <dl className="ruled card">
          {KEYS.map((k) => (
            <div key={k} className="px-6 py-6">
              <dt className="font-medium">{t(locale, `faq.${k}.q`)}</dt>
              <dd className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {t(locale, `faq.${k}.a`)}
              </dd>
            </div>
          ))}
        </dl>
      </Shell>
      <Footer locale={locale} />
    </>
  );
}
