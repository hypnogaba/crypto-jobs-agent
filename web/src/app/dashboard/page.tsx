import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Shell from "../shell";
import ApplyButton from "./apply-button";
import { detectLocale, hideMatch, listMatches, recordFeedback, undoApplied, unhideMatch } from "../actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";
import { factLabels, parseFacts } from "@/lib/facts";
import { dayLabel } from "@/lib/digest-time";
import type { Locale } from "@/lib/vocab";

type Match = Awaited<ReturnType<typeof listMatches>>[number];


export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "dash.title") };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ queued?: string }> }) {
  const { queued } = await searchParams;
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");

  const matches = await listMatches(user.id);
  const me = await one<{ timezone: string; delivery_hour: number }>(
    "SELECT timezone,delivery_hour FROM users WHERE id=?", user.id);
  const tz = me?.timezone ?? "UTC";

  // «Перша добірка — протягом години» правдиве лише поки запит справді
  // висить неопрацьованим. Якщо його вже розгребли й нічого не знайшлося,
  // обіцяти годину — брехня, і тоді працює звичайний порожній стан.
  const pending = await one<{ n: number }>(
    "SELECT COUNT(*) n FROM delivery_requests WHERE user_id=? AND handled_at IS NULL", user.id);
  const firstOnTheWay = (pending?.n ?? 0) > 0;

  // Ранкова пачка — одна одиниця, а не п'ять карток.
  const digests = new Map<string, Match[]>();
  for (const m of matches) {
    const list = digests.get(m.digest_id) ?? [];
    list.push(m);
    digests.set(m.digest_id, list);
  }

  const money = (m: Match): string | null =>
    m.salary_min
      ? `${m.salary_min.toLocaleString(locale === "en" ? "en-GB" : locale)} ${m.salary_currency ?? ""}`.trim()
      : null;

  return (
    <Shell locale={locale} title={t(locale, "dash.title")} width="roomy">
      {queued && <p className="tag tag-ok mb-6 inline-block">{t(locale, "dash.queued")}</p>}

      {matches.length === 0 ? (
        firstOnTheWay ? (
          <FirstRun locale={locale} hour={me?.delivery_hour ?? 9} connected={Boolean(user.telegramChatId)} />
        ) : (
          <div className="card px-8 py-14 text-center">
            <p className="display text-2xl" style={{ color: "var(--ink-2)" }}>{t(locale, "dash.empty")}</p>
            {!user.telegramChatId && (
              <a href="/telegram" className="btn mt-7">{t(locale, "telegram.button")}</a>
            )}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-12">
          {[...digests.entries()].map(([digestId, group]) => {
            const applied = group.filter((m) => m.applied_at).length;
            return (
              <section key={digestId}>
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-2"
                     style={{ borderColor: "var(--rule-2)" }}>
                  <h2 className="mono text-sm" style={{ color: "var(--ember)" }}>
                    {dayLabel(group[0]!.created_at, tz, locale)}
                    <span style={{ color: "var(--muted)" }}>
                      {" · "}{t(locale, "dash.count").replace("{n}", String(group.length))}
                      {applied > 0 && ` · ${t(locale, "dash.applied").replace("{n}", String(applied))}`}
                    </span>
                  </h2>
                  {/* Фідбек живе в заголовку добірки: так видно, що він про
                      добірку цілком, а не про останню вакансію в списку. */}
                  <form action={recordFeedback} className="flex gap-2">
                    <input type="hidden" name="digestId" value={digestId} />
                    <button name="reaction" value="not_relevant" className="btn btn-quiet px-2 py-1 text-xs">
                      {t(locale, "dash.notRelevant")}
                    </button>
                    <button name="reaction" value="more" className="btn btn-quiet px-2 py-1 text-xs">
                      {t(locale, "dash.more")}
                    </button>
                  </form>
                </div>

                <ol className="ruled card mt-4">
                  {group.map((m, i) => {
                    if (m.hidden_at) {
                      return (
                        <li key={m.id} className="flex items-center justify-between gap-4 px-6 py-3 text-xs"
                            style={{ color: "var(--muted)" }}>
                          <span>{t(locale, "dash.hidden")}</span>
                          <form action={unhideMatch}>
                            <input type="hidden" name="id" value={m.id} />
                            <button className="link text-xs">{t(locale, "dash.unhide")}</button>
                          </form>
                        </li>
                      );
                    }

                    const facts = factLabels(parseFacts(m.match_facts), locale);
                    return (
                      <li key={m.id}
                          className={`match grid grid-cols-[2.5rem_1fr] gap-4 px-6 py-6${m.applied_at ? " match-done" : ""}`}>
                        <span className="mono pt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="font-medium leading-snug">
                                {m.company} <span style={{ color: "var(--muted)" }}>·</span> {m.title}
                              </h3>
                              <p className="mono mt-1 text-xs" style={{ color: "var(--muted)" }}>
                                {[m.location, money(m)].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </div>
                            {!m.applied_at && (
                              <div className="row-actions flex shrink-0 items-center gap-2">
                                <ApplyButton id={m.id} label={t(locale, "dash.apply")} />
                                <form action={hideMatch}>
                                  <input type="hidden" name="id" value={m.id} />
                                  <button aria-label={t(locale, "dash.hide")} title={t(locale, "dash.hide")}
                                          className="btn btn-quiet px-2 py-1 text-xs">✕</button>
                                </form>
                              </div>
                            )}
                          </div>

                          {/* Опис самої вакансії. Раніше тут стояв переказ
                              профілю, однаковий на всі п'ять позицій. Старі
                              добірки опису не мають — для них лишається
                              попередній рядок, але вже без зламаного підпису. */}
                          {m.summary ? (
                            <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{m.summary}</p>
                          ) : m.why_fits ? (
                            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{m.why_fits}</p>
                          ) : null}

                          {facts.length > 0 && (
                            <p className="mt-2">
                              {facts.map((f) => <span key={f} className="fact">{f}</span>)}
                            </p>
                          )}

                          {m.applied_at && (
                            // div, не p: <form> усередині <p> — недійсний HTML,
                            // і React зривається на гідратації.
                            <div className="mono mt-3 flex items-center gap-3 text-xs" style={{ color: "var(--ok)" }}>
                              <span>✓ {t(locale, "dash.appliedOn").replace("{d}", m.applied_at.slice(0, 10))}</span>
                              <form action={undoApplied}>
                                <input type="hidden" name="id" value={m.id} />
                                <button className="link text-xs">{t(locale, "dash.undo")}</button>
                              </form>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

/** Що відбувається після онбордингу. Раніше тут був глухий кут. */
function FirstRun({ locale, hour, connected }: { locale: Locale; hour: number; connected: boolean }) {
  const rows = [
    { mark: "✓", text: t(locale, "first.profile"), done: true },
    { mark: "●", text: t(locale, "first.soon"), done: false },
    { mark: "○", text: t(locale, "first.daily").replace("{h}", `${String(hour).padStart(2, "0")}:00`), done: false },
  ];
  return (
    <div className="card px-8 py-12">
      <p className="display text-2xl">{t(locale, "first.title")}</p>
      <ul className="mt-8 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.text} className="flex gap-3 text-sm" style={{ color: r.done ? "var(--ok)" : "var(--ink-2)" }}>
            <span className="mono">{r.mark}</span>{r.text}
          </li>
        ))}
      </ul>
      <div className="mt-9 flex flex-wrap items-center gap-4">
        {!connected && <a href="/telegram" className="btn">{t(locale, "telegram.button")}</a>}
        <a href="/onboarding" className="link text-sm">{t(locale, "first.edit")}</a>
      </div>
    </div>
  );
}
