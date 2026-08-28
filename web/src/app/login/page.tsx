import Link from "next/link";
import Shell from "../shell";
import { detectLocale, login } from "../actions";
import { t } from "@/lib/i18n";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;
  return (
    <Shell locale={locale} night center title={t(locale, "auth.login")}>
      <form action={login} className="flex flex-col gap-5 rounded-lg border px-7 py-7"
            style={{ borderColor: "var(--night-rule)" }}>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">{t(locale, "auth.email")}</span>
          <input type="email" name="email" required autoComplete="email" className="field field-night" />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">{t(locale, "auth.password")}</span>
          <input type="password" name="password" required autoComplete="current-password" className="field field-night" />
        </label>
        {error && <p className="text-sm" style={{ color: "var(--bad)" }}>{t(locale, `auth.${error}`)}</p>}
        <button type="submit" className="btn mt-1 justify-center">{t(locale, "auth.login")}</button>
      </form>
      <p className="mt-6 text-sm" style={{ color: "var(--night-2)" }}>
        {t(locale, "auth.noAccount")} <Link href="/" className="link" style={{ color: "var(--night-ink)" }}>{t(locale, "auth.register")}</Link>
      </p>
    </Shell>
  );
}
