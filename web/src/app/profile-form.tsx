import { saveProfile } from "./actions";
import { t } from "@/lib/i18n";
import { INDUSTRIES, REMOTE_MODES, SENIORITY, SPHERES, label, type Locale } from "@/lib/vocab";

/**
 * Одна форма профілю на два входи: перший прохід (/onboarding, з чернетки
 * після розбору тексту) і правка (/profile, з бази). Дві копії розійшлися б
 * першою ж новою кнопкою — так уже було з «дизайном», якого не існувало на
 * сайті, поки він з'являвся в боті.
 */
export interface ProfilePre {
  spheres: string[];
  industries: string[];
  seniority: string | null;
  remoteMode: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryCurrency: string | null;
  wishes: string | null;
}

export const parseList = (v: string | null): string[] => {
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

export default function ProfileForm({ locale, pre, back }: {
  locale: Locale; pre: ProfilePre;
  /** `profile` — після збереження назад на /profile; інакше — до Telegram. */
  back?: "profile";
}) {
  const spheres = new Set(pre.spheres);
  const industries = new Set(pre.industries);

  return (
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
            <input type="text" name="location" className="field mt-2" defaultValue={pre.location ?? ""} />
          </label>
        </Question>

        <Question n={4} title={t(locale, "onboarding.salary")} hint={t(locale, "onboarding.salaryHint")}>
          <div className="flex gap-3">
            <input type="number" name="salaryMin" className="field mono" placeholder="90000"
              defaultValue={pre.salaryMin ?? ""} />
            <select name="salaryCurrency" className="field mono" style={{ maxWidth: "7rem" }}
              defaultValue={pre.salaryCurrency ?? "EUR"}>
              {["EUR", "USD", "GBP", "PLN", "CHF"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </Question>

        {/* Побажання: те, чого немає в кнопках. Той самий стовпець, у який
            бот дописує вільний текст, — тут його можна прочитати й підправити. */}
        <Question n={5} title={t(locale, "onboarding.wishes")} hint={t(locale, "onboarding.wishesHint")}>
          <textarea name="wishes" className="field" rows={3} maxLength={2000}
            defaultValue={pre.wishes ?? ""} placeholder={t(locale, "onboarding.wishesPlaceholder")} />
        </Question>
      </div>

      {/* Часовий пояс людини. Досі він визначався ЛИШЕ на сторінці
          налаштувань, куди майже ніхто не заходить, тож у базі в усіх
          лишався зашитий UTC — і «щодня о 09:00» означало 12:00 за Києвом.
          Тепер зона знімається там, де людина насправді є: у реєстрації. */}
      <input type="hidden" name="timezone" defaultValue="UTC" id="tz" />
      {back && <input type="hidden" name="back" value={back} />}

      <button type="submit" className="btn mt-8">{t(locale, back ? "profile.save" : "onboarding.save")}</button>

      <script dangerouslySetInnerHTML={{ __html:
        `try{document.getElementById('tz').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch(e){}` }} />
    </form>
  );
}
