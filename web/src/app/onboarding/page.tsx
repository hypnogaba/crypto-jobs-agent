import { redirect } from "next/navigation";
import Nav from "../nav";
import { detectLocale, readDraft, saveProfile } from "../actions";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";
import { INDUSTRIES, REMOTE_MODES, SENIORITY, SPHERES, label } from "@/lib/vocab";

const parseList = (v: string | null): string[] => {
  try { const p = JSON.parse(v ?? "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
};

export default async function Onboarding() {
  const locale = await detectLocale();
  const user = await currentUser();
  const draft = await readDraft();

  // Дані беремо з чернетки (щойно написаного) або з уже збереженого профілю
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
    <>
      <Nav locale={locale} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "onboarding.title")}</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "onboarding.lede")}</p>

        <form action={saveProfile} className="mt-9 flex flex-col gap-8">
          <fieldset>
            <legend className="text-sm font-medium">{t(locale, "onboarding.spheres")}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {SPHERES.map((s) => (
                <label key={s.id} className="chip">
                  <input type="checkbox" name="spheres" value={s.id} defaultChecked={spheres.has(s.id)} />
                  {label(s, locale)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t(locale, "onboarding.industries")}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {INDUSTRIES.map((i) => (
                <label key={i.id} className="chip">
                  <input type="checkbox" name="industries" value={i.id} defaultChecked={industries.has(i.id)} />
                  {label(i, locale)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t(locale, "onboarding.seniority")}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {SENIORITY.map((s) => (
                <label key={s.id} className="chip">
                  <input type="radio" name="seniority" value={s.id} defaultChecked={pre.seniority === s.id} />
                  {label(s, locale)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t(locale, "onboarding.remote")}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {REMOTE_MODES.map((m) => (
                <label key={m.id} className="chip">
                  <input type="radio" name="remoteMode" value={m.id} defaultChecked={pre.remoteMode === m.id} />
                  {label(m, locale)}
                </label>
              ))}
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-sm" style={{ color: "var(--muted)" }}>{t(locale, "onboarding.location")}</span>
              <input type="text" name="location" className="field" defaultValue={(pre.location as string) ?? ""} />
            </label>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t(locale, "onboarding.salary")}</legend>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t(locale, "onboarding.salaryHint")}</p>
            <div className="mt-3 flex gap-3">
              <input type="number" name="salaryMin" className="field" placeholder="90000"
                defaultValue={(pre.salaryMin as number) ?? ""} />
              <select name="salaryCurrency" className="field" defaultValue={(pre.salaryCurrency as string) ?? "EUR"}
                style={{ maxWidth: "8rem" }}>
                <option value="EUR">EUR</option><option value="USD">USD</option>
                <option value="GBP">GBP</option><option value="PLN">PLN</option>
              </select>
            </div>
          </fieldset>

          <button type="submit" className="btn self-start">{t(locale, "onboarding.save")}</button>
        </form>
      </main>
    </>
  );
}
