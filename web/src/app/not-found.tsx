import Link from "next/link";
import { detectLocale } from "./actions";
import { t } from "@/lib/i18n";

/** Серверний компонент, тому мову можна взяти нормально, а не з куки на клієнті. */
export default async function NotFound() {
  const locale = await detectLocale();

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-6 text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="display mt-3 text-3xl">{t(locale, "nf.title")}</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "nf.body")}</p>
        <Link href="/" className="btn mt-8">{t(locale, "err.home")}</Link>
      </div>
    </main>
  );
}
