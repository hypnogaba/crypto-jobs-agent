import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";
import { logout } from "./actions";

export default async function Nav({ locale }: { locale: Locale }) {
  const user = await currentUser();
  return (
    <header className="border-b" style={{ borderColor: "var(--line)" }}>
      <nav className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">{t(locale, "brand")}</Link>
        <div className="flex items-center gap-4 text-sm" style={{ color: "var(--muted)" }}>
          {user ? (
            <>
              <Link href="/dashboard" className="hover:underline">{t(locale, "dash.title")}</Link>
              <Link href="/settings" className="hover:underline">{t(locale, "dash.settings")}</Link>
              {user.isAdmin && <Link href="/admin" className="hover:underline">{t(locale, "nav.admin")}</Link>}
              <form action={logout}><button type="submit" className="hover:underline">{t(locale, "auth.logout")}</button></form>
            </>
          ) : (
            <Link href="/login" className="hover:underline">{t(locale, "auth.login")}</Link>
          )}
        </div>
      </nav>
    </header>
  );
}
