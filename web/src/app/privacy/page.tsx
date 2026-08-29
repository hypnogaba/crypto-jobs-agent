import type { Metadata } from "next";
import Shell from "../shell";
import Footer from "../footer";
import { detectLocale } from "../actions";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

const SECTIONS = ["collect", "cv", "why", "keep", "share", "rights", "cookies", "contact"];


export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return pageMeta(locale, "/privacy", t(locale, "privacy.title"));
}

export default async function Privacy() {
  const locale = await detectLocale();
  return (
    <>
      <Shell locale={locale} eyebrow={t(locale, "nav.privacy")} title={t(locale, "privacy.title")}
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
