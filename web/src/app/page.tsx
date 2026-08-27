import Link from "next/link";
import Nav from "./nav";
import { detectLocale, startOnboarding } from "./actions";
import { t } from "@/lib/i18n";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t(locale, "tagline")}</h1>
        <p className="mt-4 text-base leading-relaxed" style={{ color: "var(--ink-2)" }}>
          {t(locale, "home.lede")}
        </p>

        <form action={startOnboarding} className="mt-10 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t(locale, "home.field")}</span>
            <textarea
              name="input" required rows={6} className="field resize-y"
              placeholder={t(locale, "home.placeholder")}
            />
          </label>
          {error === "empty" && (
            <p className="text-sm" style={{ color: "var(--bad)" }}>{t(locale, "err.empty")}</p>
          )}
          <button type="submit" className="btn self-start">{t(locale, "home.submit")}</button>
        </form>

        <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
          {t(locale, "home.have")}{" "}
          <Link href="/login" className="underline">{t(locale, "home.login")}</Link>
        </p>
      </main>
    </>
  );
}
