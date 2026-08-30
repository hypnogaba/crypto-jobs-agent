import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";
import { pathFor } from "@/lib/seo";

/**
 * Посилання ведуть на сторінку мовою людини: /faq для англійської, /ua/faq
 * для української. Раніше тут стояли голі "/faq" — і з української сторінки
 * підвал викидав людину в англійський текст.
 */
export default function Footer({ locale }: { locale: Locale }) {
  return (
    <footer className="mt-auto border-t" style={{ borderColor: "var(--rule)" }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-5 px-6 py-8 text-sm"
           style={{ color: "var(--muted)" }}>
        <span className="display text-base" style={{ color: "var(--ink)" }}>NextRole</span>
        <nav className="flex flex-wrap gap-5">
          <Link href={pathFor(locale, "/faq")} className="hover:opacity-70">{t(locale, "nav.faq")}</Link>
          <Link href={pathFor(locale, "/privacy")} className="hover:opacity-70">{t(locale, "nav.privacy")}</Link>
          <a href="https://t.me/nextroleinfo" target="_blank" rel="noreferrer" className="hover:opacity-70">
            {t(locale, "nav.channel")}
          </a>
          <Link href={pathFor(locale, "/feedback")} className="hover:opacity-70" style={{ color: "var(--ember)" }}>
            {t(locale, "nav.feedback")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
