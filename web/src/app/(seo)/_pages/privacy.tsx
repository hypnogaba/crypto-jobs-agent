import Shell from "@/app/shell";
import Footer from "@/app/footer";
import { t } from "@/lib/i18n";
import JsonLd from "@/app/json-ld";
import { breadcrumbLd } from "@/lib/seo";
import type { Locale } from "@/lib/vocab";

const SECTIONS = ["collect", "cv", "why", "keep", "share", "rights", "cookies", "contact"];

export default function PrivacyBody({ locale }: { locale: Locale }) {
  return (
    <>
      <JsonLd data={breadcrumbLd(locale, t(locale, "privacy.title"), "/privacy")} />
      <Shell urlPath="/privacy" locale={locale} eyebrow={t(locale, "nav.privacy")} title={t(locale, "privacy.title")}
             lede={t(locale, "privacy.lede")}>
        <div className="ruled card">
          {SECTIONS.map((s) => (
            <section key={s} className="px-6 py-6">
              <h2 className="font-medium">{t(locale, `privacy.${s}.h`)}</h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {t(locale, `privacy.${s}.b`)}
              </p>
            </section>
          ))}
        </div>
        <p className="mono mt-6 text-xs" style={{ color: "var(--muted)" }}>
          {t(locale, "privacy.updated")}
        </p>
      </Shell>
      <Footer locale={locale} />
    </>
  );
}
