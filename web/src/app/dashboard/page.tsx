import { redirect } from "next/navigation";
import Nav from "../nav";
import { detectLocale, listMatches } from "../actions";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";

export default async function Dashboard() {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");

  const matches = await listMatches(user.id);

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "dash.title")}</h1>

        {matches.length === 0 ? (
          <p className="card mt-8 px-5 py-8 text-sm" style={{ color: "var(--muted)" }}>
            {t(locale, "dash.empty")}
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {matches.map((m) => (
              <li key={m.id} className="card p-5">
                <h2 className="font-medium">{m.company} — {m.title}</h2>
                {m.location && (
                  <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{m.location}</p>
                )}
                <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
                  <span className="font-medium" style={{ color: "var(--ink)" }}>{t(locale, "dash.why")}: </span>
                  {m.why_fits}
                </p>
                {/* Голе посилання: частина клієнтів Telegram ріже markdown-лінки */}
                <a href={m.url} target="_blank" rel="noreferrer"
                   className="mt-3 block break-all text-sm underline" style={{ color: "var(--ok)" }}>
                  {m.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
