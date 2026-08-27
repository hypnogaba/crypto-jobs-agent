import Link from "next/link";
import Nav from "../nav";
import { detectLocale, login } from "../actions";
import { t } from "@/lib/i18n";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;
  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-sm flex-1 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "auth.login")}</h1>
        <form action={login} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t(locale, "auth.email")}</span>
            <input type="email" name="email" required autoComplete="email" className="field" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t(locale, "auth.password")}</span>
            <input type="password" name="password" required autoComplete="current-password" className="field" />
          </label>
          {error && <p className="text-sm" style={{ color: "var(--bad)" }}>{t(locale, `auth.${error}`)}</p>}
          <button type="submit" className="btn mt-2">{t(locale, "auth.login")}</button>
        </form>
        <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
          {t(locale, "auth.noAccount")}{" "}
          <Link href="/register" className="underline">{t(locale, "auth.register")}</Link>
        </p>
      </main>
    </>
  );
}
