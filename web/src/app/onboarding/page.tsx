import { redirect } from "next/navigation";
import Shell from "../shell";
import { detectLocale, readDraft, saveProfile } from "../actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";
import { INDUSTRIES, REMOTE_MODES, SENIORITY, SPHERES, label } from "@/lib/vocab";

const parseList = (v: string | null): string[] => {
  try { const p = JSON.parse(v ?? "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
};

function Question({ n, title, hint, children }: {
  n: number; title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <fieldset className="grid grid-cols-[2.5rem_1fr] gap-4 px-6 py-7">
      <span className="mono pt-1 text-sm" style={{ color: "var(--ember)" }}>
        {String(n).padStart(2, "0")}
      </span>
      <div>
        <legend className="font-medium">{title}</legend>
        {hint && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{hint}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </fieldset>
  );
}

export default async function Onboarding() {
  const locale = await detectLocale();
  const user = await currentUser();
  const draft = await readDraft();

  let pre = draft?.parsed as Record<string, unknown> | undefined;
  if (!pre && user) {
    const row = await one<{ spheres: string; industries: string; seniority: string | null;
      remote_mode: string; location: string | null; salary_min: number | null; salary_currency: string | null }>(
      "SELECT * FROM profiles WHERE user_id=?", user.id);
    if (row) pre = {
      spheres: parseList(row.spheres), industries: parseList(row.industries),
      seniority: row.seniority, remoteMode: row.remote_mode, location: row.location,
      salaryMin: row.salary_min, salaryCurrency: row.salary_currency };
  }
  if (!pre) redirect("/");

  const spheres = new Set(pre.spheres as string[]);
  const industries = new Set(pre.industries as string[]);

  return (
    <Shell locale={locale} night eyebrow="02 / 02" title={t(locale, "onboarding.title")} lede={t(locale, "onboarding.lede")}>
      <form action={saveProfile}>
        <div className="ruled card">
          <Question n={1} title={t(locale, "onboarding.spheres")}>
            <div className="flex flex-wrap gap-2">
              {SPHERES.map((s) => (
                <label key={s.id} className="chip">
                  <input type="checkbox" name="spheres" value={s.id} defaultChecked={spheres.has(s.id)} />
                  {label(s, locale)}
                </label>
              ))}
            </div>
            <div className="mt-5">
              <p className="eyebrow">{t(locale, "onboarding.industries")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {INDUSTRIES.map((i) => (
                  <label key={i.id} className="chip">
                    <input type="checkbox" name="industries" value={i.id} defaultChecked={industries.has(i.id)} />
                    {label(i, locale)}
                  </label>
                ))}
              </div>
            </div>
          </Question>

          <Question n={2} title={t(locale, "onboarding.seniority")}>
            <div className="flex flex-wrap gap-2">
              {SENIORITY.map((s) => (
                <label key={s.id} className="chip">
                  <input type="radio" name="seniority" value={s.id} defaultChecked={pre.seniority === s.id} />
                  {label(s, locale)}
                </label>
              ))}
            </div>
          </Question>

          <Question n={3} title={t(locale, "onboarding.remote")}>
            <div className="flex flex-wrap gap-2">
              {REMOTE_MODES.map((m) => (
                <label key={m.id} className="chip">
                  <input type="radio" name="remoteMode" value={m.id} defaultChecked={pre.remoteMode === m.id} />
                  {label(m, locale)}
                </label>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="eyebrow">{t(locale, "onboarding.location")}</span>
              <input type="text" name="location" className="field mt-2"
                defaultValue={(pre.location as string) ?? ""} />
            </label>
          </Question>

          <Question n={4} title={t(locale, "onboarding.salary")} hint={t(locale, "onboarding.salaryHint")}>
            <div className="flex gap-3">
              <input type="number" name="salaryMin" className="field mono" placeholder="90000"
                defaultValue={(pre.salaryMin as number) ?? ""} />
              <select name="salaryCurrency" className="field mono" style={{ maxWidth: "7rem" }}
                defaultValue={(pre.salaryCurrency as string) ?? "EUR"}>
                {["EUR", "USD", "GBP", "PLN", "CHF"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </Question>
        </div>

        <button type="submit" className="btn mt-8">{t(locale, "onboarding.save")}</button>
      </form>
    </Shell>
  );
}
