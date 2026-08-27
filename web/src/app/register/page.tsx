import Link from "next/link";
import Nav from "../nav";
import { detectLocale, register } from "../actions";
import { t } from "@/lib/i18n";

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;
  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-sm flex-1 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "auth.register")}</h1>
        <form action={register} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t(locale, "auth.email")}</span>
            <input type="email" name="email" required autoComplete="email" className="field" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t(locale, "auth.password")}</span>
            <input type="password" name="password" required minLength={8} autoComplete="new-password" className="field" />
          </label>
          {error && <p className="text-sm" style={{ color: "var(--bad)" }}>{t(locale, `auth.${error}`)}</p>}
          <button type="submit" className="btn mt-2">{t(locale, "auth.register")}</button>
        </form>
        <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
          <Link href="/login" className="underline">{t(locale, "auth.login")}</Link>
        </p>
      </main>
    </>
  );
}
