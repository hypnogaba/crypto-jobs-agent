import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Shell from "@/app/shell";
import NoTelegramNote from "../no-telegram-note";
import { deleteAccount, detectLocale, saveSettings, togglePause } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { LOCALES, t } from "@/lib/i18n";

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 px-6 py-6 sm:grid-cols-[1fr_16rem] sm:items-center">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}


export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "settings.title") };
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { saved } = await searchParams;

  const row = await one<{ delivery_hour: number; timezone: string }>(
    "SELECT delivery_hour,timezone FROM users WHERE id=?", user.id);

  return (
    <Shell locale={locale} title={t(locale, "settings.title")}>
      {saved && <p className="tag tag-ok mb-5 inline-block">{t(locale, "settings.saved")}</p>}

      {/* Друге місце, де це видно: сюди людина заходить міняти годину
          доставки — і саме тут має дізнатись, що доставки поки не буде
          взагалі, бо каналу немає. */}
      {!user.telegramChatId && <NoTelegramNote locale={locale} userId={user.id} />}

      <form action={saveSettings}>
        <div className="ruled card">
          <Row title={t(locale, "settings.delivery")} hint={row?.timezone ?? "UTC"}>
            <select name="deliveryHour" className="field mono" defaultValue={String(row?.delivery_hour ?? 9)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </Row>
          <Row title={t(locale, "settings.language")}>
            <select name="locale" className="field" defaultValue={locale}>
              {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Row>
        </div>
        <input type="hidden" name="timezone" defaultValue={row?.timezone ?? "UTC"} id="tz" />
        <button type="submit" className="btn mt-6">{t(locale, "settings.save")}</button>
      </form>

      <div className="card mt-10 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">
              {user.status === "paused" ? t(locale, "settings.resume") : t(locale, "settings.pause")}
            </h3>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {t(locale, user.telegramChatId ? "settings.tgOn" : "settings.tgOff")}
            </p>
          </div>
          <form action={togglePause}>
            <button type="submit" className="btn btn-quiet">
              {user.status === "paused" ? t(locale, "settings.resume") : t(locale, "settings.pause")}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-10 border-t pt-7" style={{ borderColor: "var(--rule)" }}>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t(locale, "settings.deleteConfirm")}</p>
        <form action={deleteAccount} className="mt-4">
          <button type="submit" className="btn btn-danger">{t(locale, "settings.delete")}</button>
        </form>
      </div>

      <script dangerouslySetInnerHTML={{ __html:
        `try{document.getElementById('tz').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch(e){}` }} />
    </Shell>
  );
}
