import { redirect } from "next/navigation";
import Nav from "../nav";
import { deleteAccount, detectLocale, saveSettings, togglePause } from "../actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { LOCALES, t } from "@/lib/i18n";

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { saved } = await searchParams;

  const row = await one<{ delivery_hour: number; timezone: string }>(
    "SELECT delivery_hour,timezone FROM users WHERE id=?", user.id);

  return (
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "settings.title")}</h1>
        {saved && <p className="mt-2 text-sm" style={{ color: "var(--ok)" }}>{t(locale, "settings.saved")}</p>}

        <form action={saveSettings} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t(locale, "settings.delivery")}</span>
            <select name="deliveryHour" className="field" defaultValue={String(row?.delivery_hour ?? 7)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t(locale, "settings.language")}</span>
            <select name="locale" className="field" defaultValue={locale}>
              {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          {/* Часовий пояс визначає браузер — людину про нього не питаємо */}
          <input type="hidden" name="timezone" defaultValue={row?.timezone ?? "UTC"} id="tz" />
          <button type="submit" className="btn self-start">{t(locale, "settings.save")}</button>
        </form>

        <form action={togglePause} className="mt-10">
          <button type="submit" className="btn btn-ghost">
            {user.status === "paused" ? t(locale, "settings.resume") : t(locale, "settings.pause")}
          </button>
        </form>

        <form action={deleteAccount} className="mt-10 border-t pt-6" style={{ borderColor: "var(--line)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t(locale, "settings.deleteConfirm")}</p>
          <button type="submit" className="btn mt-3" style={{ background: "var(--bad)", borderColor: "var(--bad)" }}>
            {t(locale, "settings.delete")}
          </button>
        </form>

        <script dangerouslySetInnerHTML={{ __html:
          `try{document.getElementById('tz').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch(e){}` }} />
      </main>
    </>
  );
}
