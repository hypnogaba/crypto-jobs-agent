import { saveProfile } from "./actions";
import { t } from "@/lib/i18n";
import {
  INDUSTRIES, REMOTE_MODES, SENIORITY, SPHERES, label, needsCity, parseModes, type Locale,
} from "@/lib/vocab";

/**
 * Одна форма профілю на два входи: перший прохід (/onboarding, з чернетки
 * після розбору тексту) і правка (/profile, з бази). Дві копії розійшлися б
 * першою ж новою кнопкою — так уже було з «дизайном», якого не існувало на
 * сайті, поки він з'являвся в боті.
 */
export interface ProfilePre {
  spheres: string[];
  /** Своя роль і своя індустрія: те, чого немає в кнопках. Бот питає це з першого дня. */
  customRole: string | null;
  customIndustry: string | null;
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

/** Поле «немає в списку» під набором кнопок. Пишеться в custom_role / custom_industry. */
function OwnWords({ name, locale, placeholder, value }: {
  name: string; locale: Locale; placeholder: string; value: string | null;
}) {
  return (
    <label className="mt-4 block">
      <span className="eyebrow">{t(locale, "onboarding.notListed")}</span>
      <input type="text" name={name} className="field mt-2" maxLength={120}
        placeholder={placeholder} defaultValue={value ?? ""} />
    </label>
  );
}

/**
 * Чому саме ця галочка стоїть.
 *
 * Досі крок 2 показував заповнену анкету й жодного натяку, звідки взялися
 * значення. Людина писала про себе тези, бачила чужі їй галочки й не мала
 * як зрозуміти, що пішло не так. Тепер під кожною групою стоять її ж слова
 * поруч із тим, у що ми їх перетворили, — помилку видно одразу.
 */
function Reasons({ items, guessed, guessLabel }: {
  items: Array<{ name: string; quote: string }>;
  /** Поставлено без цитати — здогад із загального змісту, а не з рядка тексту. */
  guessed?: string[];
  guessLabel?: string;
}) {
  if (items.length === 0 && !guessed?.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {items.map((i) => (
        <li key={i.name} className="mono text-xs leading-relaxed" style={{ color: "var(--faint)" }}>
          «{i.quote}» → {i.name}
        </li>
      ))}
      {/* Галочка без цитати — не мовчазна. Модель інколи ставить сферу з
          загального змісту, а її «цитата» не збігається з текстом дослівно й
          відсіюється (verifyEvidence). Раніше така галочка стояла зовсім без
          пояснення — тобто рівно те, на що людина й скаржилась. Вигадувати
          цитату не можна, а от чесно назвати це здогадом — можна. */}
      {guessed?.length ? (
        <li className="mono text-xs leading-relaxed" style={{ color: "var(--faint)" }}>
          {guessLabel}: {guessed.join(", ")}
        </li>
      ) : null}
    </ul>
  );
}

export default function ProfileForm({ locale, pre, back, error, quote, evidence }: {
  locale: Locale; pre: ProfilePre;
  /** `profile` — після збереження назад на /profile; інакше — до Telegram. */
  back?: "profile";
  /** Код помилки з попередньої спроби зберегти. Поки що лише `city`. */
  error?: string;
  /** Текст, який людина написала на кроці 1. Є лише в першому проході. */
  quote?: string;
  /** Підстави з розбору: `sphere:<id>` → уривок із тексту. Див. lib/parse.ts. */
  evidence?: Record<string, string>;
}) {
  const spheres = new Set(pre.spheres);
  const industries = new Set(pre.industries);
  const modes = parseModes(pre.remoteMode);

  /** Підстава для одного значення, якщо вона є. */
  const why = (key: string, name: string): { name: string; quote: string } | null => {
    const q = evidence?.[key];
    return q ? { name, quote: q } : null;
  };
  const kept = (items: Array<{ name: string; quote: string } | null>) =>
    items.filter((i): i is { name: string; quote: string } => i !== null);
  /** Назви того, що поставлено, але чим саме — сказати нема чим. */
  const guesses = (items: Array<{ key: string; name: string }>) =>
    quote ? items.filter((i) => !evidence?.[i.key]).map((i) => i.name) : [];

  // Порожній розбір — це теж відповідь, і краще сказати про це прямо, ніж
  // показати порожню форму так, ніби ми щось зрозуміли.
  const nothing = Boolean(quote) && Object.keys(evidence ?? {}).length === 0;

  return (
    <form action={saveProfile}>
      {quote && (
        <div className="card mb-6 px-6 py-5">
          <p className="eyebrow">{t(locale, "onboarding.youWrote")}</p>
          {/* Довгий текст згорнутий: цитата має нагадати, а не переписати
              екран. `whitespace-pre-line` тримає абзаци тез. */}
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed"
             style={{ color: "var(--muted)" }}>
            {quote.length > 320 ? `${quote.slice(0, 320).trimEnd()}…` : quote}
          </p>
          {quote.length > 320 && (
            <details className="mt-3">
              <summary className="mono cursor-pointer text-xs" style={{ color: "var(--ember)" }}>
                {t(locale, "onboarding.showAll")}
              </summary>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed"
                 style={{ color: "var(--muted)" }}>{quote}</p>
            </details>
          )}
          {nothing && (
            <p className="tag tag-warn mt-4 inline-block">{t(locale, "onboarding.nothingFound")}</p>
          )}
        </div>
      )}

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
          {/* Написане тут шукається в назвах вакансій (matchesCustomRole
              у сканері) — це справжній фільтр, а не мертвий текст. */}
          <OwnWords name="customRole" locale={locale} value={pre.customRole}
            placeholder={t(locale, "onboarding.rolePlaceholder")} />
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
            <OwnWords name="customIndustry" locale={locale} value={pre.customIndustry}
              placeholder={t(locale, "onboarding.industryPlaceholder")} />
          </div>
          <Reasons
            items={kept([
              ...SPHERES.filter((x) => spheres.has(x.id)).map((x) => why(`sphere:${x.id}`, label(x, locale))),
              ...INDUSTRIES.filter((x) => industries.has(x.id)).map((x) => why(`industry:${x.id}`, label(x, locale))),
            ])}
            guessed={guesses([
              ...SPHERES.filter((x) => spheres.has(x.id)).map((x) => ({ key: `sphere:${x.id}`, name: label(x, locale) })),
              ...INDUSTRIES.filter((x) => industries.has(x.id)).map((x) => ({ key: `industry:${x.id}`, name: label(x, locale) })),
            ])}
            guessLabel={t(locale, "onboarding.guessed")} />
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
          <Reasons items={kept([
            why("seniority", SENIORITY.find((x) => x.id === pre.seniority)
              ? label(SENIORITY.find((x) => x.id === pre.seniority)!, locale) : ""),
          ])} />
        </Question>

        {/* Галочки, не радіо: «офіс у моєму місті» і «готовий переїхати» —
            не альтернативи, і людині, згодній на обидва, раніше доводилось
            викреслити одне. «Тільки віддалено» лишається виключним: разом
            з рештою воно було б суперечністю. Скрипт нижче тримає це
            правило й вмикає обов'язковість міста. */}
        <Question n={3} title={t(locale, "onboarding.remote")} hint={t(locale, "onboarding.remoteHint")}>
          <div className="flex flex-wrap gap-2" id="where">
            {REMOTE_MODES.map((m) => (
              <label key={m.id} className="chip">
                <input type="checkbox" name="remoteMode" value={m.id} defaultChecked={modes.includes(m.id)} />
                {label(m, locale)}
              </label>
            ))}
          </div>
          <label className="mt-4 block" id="cityRow" hidden={!needsCity(modes)}>
            <span className="eyebrow">{t(locale, "onboarding.location")}</span>
            <input type="text" name="location" id="city" className="field mt-2" maxLength={120}
              required={needsCity(modes)} defaultValue={pre.location ?? ""} />
            <span className="mt-2 block text-xs" style={{ color: "var(--muted)" }}>
              {t(locale, "onboarding.locationHint")}
            </span>
          </label>
          <Reasons items={kept([
            why("remoteMode", REMOTE_MODES.filter((x) => modes.includes(x.id))
              .map((x) => label(x, locale)).join(", ")),
            why("location", pre.location ?? ""),
          ])} />
          {error === "city" && (
            <p className="tag tag-warn mt-3 inline-block">{t(locale, "err.city")}</p>
          )}
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
          <Reasons items={kept([
            why("salary", pre.salaryMin ? `${pre.salaryMin} ${pre.salaryCurrency ?? ""}`.trim() : ""),
          ])} />
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

      {/* Без скрипта форма лишається робочою: місто просто завжди видно, а
          обов'язковість і виключність «тільки віддалено» доводить сервер. */}
      <script dangerouslySetInnerHTML={{ __html:
        `try{document.getElementById('tz').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch(e){}
try{(function(){
var box=document.getElementById('where'),row=document.getElementById('cityRow'),city=document.getElementById('city');
var m=box.querySelectorAll('input[name=remoteMode]');
function sync(e){
  if(e&&e.target.checked){
    for(var i=0;i<m.length;i++){
      var x=m[i];
      if(x!==e.target&&(x.value==='remote_only'||e.target.value==='remote_only'))x.checked=false;
    }
  }
  var need=false;
  for(var j=0;j<m.length;j++)if(m[j].checked&&m[j].value!=='remote_only')need=true;
  row.hidden=!need;city.required=need;
}
for(var k=0;k<m.length;k++)m[k].addEventListener('change',sync);
sync();
})()}catch(e){}` }} />
    </form>
  );
}
