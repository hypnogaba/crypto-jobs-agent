import type { Metadata } from "next";
import Link from "next/link";
import Shell from "../shell";
import Footer from "../footer";
import { detectLocale } from "../actions";
import { t } from "@/lib/i18n";
import JsonLd from "../json-ld";
import { pageMeta, faqPageLd, breadcrumbLd } from "@/lib/seo";

const KEYS = ["cost", "apply", "sources", "cv", "why5", "wrong", "stop", "telegram", "languages", "dead"];


export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return pageMeta(locale, "/faq", t(locale, "faq.title"));
}

export default async function Faq() {
  const locale = await detectLocale();
  return (
    <>
      {/* Ті самі KEYS, що й видимий список нижче: розмітка й текст на
          сторінці мусять збігатися, інакше Google знімає rich result. */}
      <JsonLd data={faqPageLd(locale, KEYS)} />
      <JsonLd data={breadcrumbLd(t(locale, "faq.title"), "/faq")} />
      <Shell locale={locale} eyebrow={t(locale, "nav.faq")} title={t(locale, "faq.title")}>
        <dl className="ruled card">
          {KEYS.map((k) => (
            <div key={k} className="px-6 py-6">
              <dt className="font-medium">{t(locale, `faq.${k}.q`)}</dt>
              <dd className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {t(locale, `faq.${k}.a`)}
                {/* Умови Remote OK і Remotive вимагають назви й відкритого
                    посилання, доки ми беремо звідти дані. Із підвалу сторінку
                    прибрали, тож єдиний шлях до неї тепер тут — і він мусить
                    бути справжнім посиланням, а не згадкою словами. */}
                {k === "sources" && (
                  <>
                    {" "}
                    <Link href="/sources" className="link">{t(locale, "nav.sources")}</Link>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Shell>
      <Footer locale={locale} />
    </>
  );
}
