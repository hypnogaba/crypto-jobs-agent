import Link from "next/link";
import Shell from "@/app/shell";
import Footer from "@/app/footer";
import { t } from "@/lib/i18n";
import JsonLd from "@/app/json-ld";
import { faqPageLd, breadcrumbLd, pathFor } from "@/lib/seo";
import type { Locale } from "@/lib/vocab";

/**
 * Тіло сторінки питань, спільне для всіх мовних адрес.
 *
 * Мова приходить згори — з відрізка адреси, а не з куки. Кука лишилась лише
 * на сторінках застосунку: публічну сторінку пошук бачить без куки взагалі,
 * і поки мова бралася звідти, /uk віддавав англійський текст.
 */

export const FAQ_KEYS = [
  "cost", "apply", "sources", "cv", "why5", "wrong", "stop", "telegram", "languages", "dead",
];

export default function FaqBody({ locale }: { locale: Locale }) {
  return (
    <>
      {/* Ті самі FAQ_KEYS, що й видимий список нижче: розмітка й текст на
          сторінці мусять збігатися, інакше Google знімає rich result. */}
      <JsonLd data={faqPageLd(locale, FAQ_KEYS)} />
      <JsonLd data={breadcrumbLd(locale, t(locale, "faq.title"), "/faq")} />
      <Shell urlPath="/faq" locale={locale} eyebrow={t(locale, "nav.faq")} title={t(locale, "faq.title")}>
        <dl className="ruled card">
          {FAQ_KEYS.map((k) => (
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
                    <Link href={pathFor(locale, "/sources")} className="link">
                      {t(locale, "nav.sources")}
                    </Link>
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
