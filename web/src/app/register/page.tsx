import Link from "next/link";
import Shell from "../shell";
import { detectLocale, register } from "../actions";
import { t } from "@/lib/i18n";

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;
  return (
    <Shell locale={locale} eyebrow="03 / 03" title={t(locale, "auth.register")}>
      <form action={register} className="card flex max-w-sm flex-col gap-5 px-7 py-7">
        <label className="flex flex-col gap-2">
          <span className="eyebrow">{t(locale, "auth.email")}</span>
          <input type="email" name="email" required autoComplete="email" className="field" />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">{t(locale, "auth.password")}</span>
          <input type="password" name="password" required minLength={8} autoComplete="new-password" className="field" />
        </label>
        {error && <p className="text-sm" style={{ color: "var(--bad)" }}>{t(locale, `auth.${error}`)}</p>}
        <button type="submit" className="btn mt-1 justify-center">{t(locale, "auth.register")}</button>
      </form>
      <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
        <Link href="/login" className="link">{t(locale, "auth.login")}</Link>
      </p>
    </Shell>
  );
}
