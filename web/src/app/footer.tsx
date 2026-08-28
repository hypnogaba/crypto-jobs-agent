import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";

export default function Footer({ locale }: { locale: Locale }) {
  return (
    <footer className="mt-auto border-t" style={{ borderColor: "var(--rule)" }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-5 px-6 py-8 text-sm"
           style={{ color: "var(--muted)" }}>
        <span className="display text-base" style={{ color: "var(--ink)" }}>NextRole</span>
        <nav className="flex flex-wrap gap-5">
          <Link href="/faq" className="hover:opacity-70">{t(locale, "nav.faq")}</Link>
          <Link href="/privacy" className="hover:opacity-70">{t(locale, "nav.privacy")}</Link>
          <Link href="/feedback" className="hover:opacity-70" style={{ color: "var(--ember)" }}>
            {t(locale, "nav.feedback")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
