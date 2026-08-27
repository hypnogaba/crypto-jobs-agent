import { redirect } from "next/navigation";
import Shell from "../shell";
import { detectLocale, listMatches, recordFeedback } from "../actions";
import { currentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ queued?: string }> }) {
  const { queued } = await searchParams;
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");

  const matches = await listMatches(user.id);

  // Групуємо по добірках: ранкова пачка — це одна одиниця, а не п'ять карток
  const digests = new Map<string, typeof matches>();
  for (const m of matches) {
    const list = digests.get(m.digest_id) ?? [];
    list.push(m);
    digests.set(m.digest_id, list);
  }

  return (
    <Shell locale={locale} title={t(locale, "dash.title")} wide>
      {queued && <p className="tag tag-ok mb-6 inline-block">{t(locale, "dash.queued")}</p>}
      {matches.length === 0 ? (
        <div className="card px-8 py-14 text-center">
          <p className="display text-2xl" style={{ color: "var(--ink-2)" }}>{t(locale, "dash.empty")}</p>
          {!user.telegramChatId && (
            <a href="/telegram" className="btn mt-7">{t(locale, "telegram.button")}</a>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          {[...digests.entries()].map(([digestId, group]) => (
            <section key={digestId}>
              <div className="flex items-baseline justify-between border-b pb-2"
                   style={{ borderColor: "var(--rule-2)" }}>
                <h2 className="mono text-sm" style={{ color: "var(--ember)" }}>
                  {group[0]!.created_at.slice(0, 10)}
                </h2>
                <span className="eyebrow">{group.length}</span>
              </div>

              <ol className="ruled card mt-4">
                {group.map((m, i) => (
                  <li key={m.id} className="grid grid-cols-[2.5rem_1fr] gap-4 px-6 py-6">
                    <span className="mono pt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-medium leading-snug">
                        {m.company} <span style={{ color: "var(--muted)" }}>·</span> {m.title}
                      </h3>
                      {m.location && (
                        <p className="mono mt-1 text-xs" style={{ color: "var(--muted)" }}>{m.location}</p>
                      )}
                      <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
                        <span className="eyebrow mr-2">{t(locale, "dash.why")}</span>
                        {m.why_fits}
                      </p>
                      {/* Голе посилання: те саме правило, що й у Telegram */}
                      <a href={m.url} target="_blank" rel="noreferrer"
                         className="mono mt-3 block break-all text-xs hover:underline"
                         style={{ color: "var(--ok)" }}>
                        {m.url}
                      </a>
                    </div>
                  </li>
                ))}
              </ol>

              <form action={recordFeedback} className="mt-3 flex gap-2">
                <input type="hidden" name="digestId" value={digestId} />
                <button name="reaction" value="not_relevant" className="btn btn-quiet px-3 py-2 text-xs">
                  {t(locale, "dash.notRelevant")}
                </button>
                <button name="reaction" value="more" className="btn btn-quiet px-3 py-2 text-xs">
                  {t(locale, "dash.more")}
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}
