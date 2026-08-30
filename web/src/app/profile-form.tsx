import { saveProfile } from "./actions";
import { t } from "@/lib/i18n";
import {
  INDUSTRIES, REMOTE_MODES, SPHERES, label, needsCity, parseModes, type Locale,
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
  /** Стек, роки, мови з резюме. Заповнює розбір, правити може людина. */
  cvHighlights: string | null;
  /**
   * Чи прийшла чернетка з резюме.
   *
   * Питання не косметичне: заголовок «З резюме» бачила КОЖНА людина, зокрема
   * та, що написала одне речення й ніякого файлу не давала. Вона читала про
   * своє резюме, якого не існує, і підказку «слова твої» про слова, яких не
   * писала. Саме поле корисне всім — брехав лише підпис.
   */
  fromCv?: boolean;
  industries: string[];
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

export default function ProfileForm({ locale, pre, back, error, quote, evidence, suggested }: {
  locale: Locale; pre: ProfilePre;
  /** `profile` — після збереження назад на /profile; інакше — до Telegram. */
  back?: "profile";
  /** Код помилки з попередньої спроби зберегти. Поки що лише `city`. */
  error?: string;
  /** Текст, який людина написала на кроці 1. Є лише в першому проході. */
  quote?: string;
  /** Підстави з розбору: `sphere:<id>` → уривок із тексту. Див. lib/parse.ts. */
  evidence?: Record<string, string>;
  /**
   * Що ми ПРИПУСТИЛИ з назви ролі, а не почули від людини.
   *
   * Малюється інакше й підписується окремо. Причина конкретна: вчора була
   * скарга «галочки не мої», і правило «не вгадуй» з'явилось саме через неї.
   * Пропонувати можна — але лише так, щоб різницю було видно з першого
   * погляду, а не після наведення миші.
   */
  suggested?: { spheres: string[]; industries: string[] };
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
  //
  // Рахується по ЗАПОВНЕНОМУ, а не по підставах. Спершу тут стояло
  // «підстав немає» — але модель уміє поставити галочку, чия цитата не
  // пройшла звірку, і тоді порада «познач кнопки сам» стояла б просто над
  // уже позначеними кнопками.
  const nothing = Boolean(quote)
    && spheres.size === 0 && industries.size === 0
    && modes.length === 0
    && !pre.location && !pre.salaryMin && !pre.wishes;

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
          {/* Це єдине питання, без якого підбір не працює: сфера важить ±6
              балів, а штраф за «жодного збігу» діє лише тоді, коли людина
              щось назвала. Порожня анкета проходила мовчки й давала п'ять
              випадкових вакансій. Тепер сервер її не приймає — а тут стоїть
              підпис, щоб це не було сюрпризом уже після натискання. */}
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t(locale, "onboarding.spheresNeeded")}
          </p>
          {error === "sphere" && (
            <p className="tag tag-warn mt-3 inline-block">{t(locale, "err.sphere")}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {SPHERES.map((s) => {
              const guessed = !spheres.has(s.id) && suggested?.spheres.includes(s.id);
              return (
                <label key={s.id} className={guessed ? "chip chip-guess" : "chip"}
                       title={guessed ? t(locale, "onboarding.guessOne") : undefined}>
                  <input type="checkbox" name="spheres" value={s.id}
                         defaultChecked={spheres.has(s.id) || Boolean(guessed)} />
                  {label(s, locale)}
                </label>
              );
            })}
          </div>
          {(suggested?.spheres.length ?? 0) > 0 && (
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              {t(locale, "onboarding.guessNote")}
            </p>
          )}
          {/* Написане тут шукається в назвах вакансій (matchesCustomRole
              у сканері) — це справжній фільтр, а не мертвий текст. */}
          <OwnWords name="customRole" locale={locale} value={pre.customRole}
            placeholder={t(locale, "onboarding.rolePlaceholder")} />
          <div className="mt-5">
            <p className="eyebrow">{t(locale, "onboarding.industries")}</p>
            {/* Галочка тут НЕ «мені цікаво ще й це», а фільтр: збіг дає +3, а
                розбіжність забирає 3 в кожної вакансії з іншої галузі. Порожнє
                поле — це ширша видача, а не пропущений крок, і людина має це
                знати до того, як поставить галочку. */}
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {t(locale, "onboarding.industriesNote")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {INDUSTRIES.map((i) => (
                <label key={i.id}
                       className={!industries.has(i.id) && suggested?.industries.includes(i.id)
                         ? "chip chip-guess" : "chip"}>
                  <input type="checkbox" name="industries" value={i.id}
                         defaultChecked={industries.has(i.id) || suggested?.industries.includes(i.id) || false} />
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

        {/* Галочки, не радіо: «офіс у моєму місті» і «готовий переїхати» —
            не альтернативи, і людині, згодній на обидва, раніше доводилось
            викреслити одне. «Тільки віддалено» лишається виключним: разом
            з рештою воно було б суперечністю. Скрипт нижче тримає це
            правило й вмикає обов'язковість міста. */}
        <Question n={2} title={t(locale, "onboarding.remote")} hint={t(locale, "onboarding.remoteHint")}>
          <div className="flex flex-wrap gap-2" id="where">
            {REMOTE_MODES.map((m) => (
              <label key={m.id} className="chip">
                <input type="checkbox" name="remoteMode" value={m.id} defaultChecked={modes.includes(m.id)} />
                {label(m, locale)}
              </label>
            ))}
          </div>
          {/* Місто видно завжди, а обов'язкове — лише там, де людина обрала
              офіс чи переїзд.

              Раніше воно ховалось від тих, хто працює лише віддалено. З міста
              виводиться країна, з країни — національні дошки, і виходило, що
              людина в Києві, згодна на віддалену роботу, ніколи не бачила
              жодної української вакансії й не мала як про це дізнатись. У всіх
              шести живих акаунтів країна порожня саме через це.

              Здогадуватись про країну з часового поясу ми навмисно не будемо:
              пояс каже, де людина сидить, а не де хоче працювати. Тому просто
              питаємо — і не наполягаємо. */}
          <label className="mt-4 block" id="cityRow">
            <span className="eyebrow">{t(locale, "onboarding.location")}</span>
            <input type="text" name="location" id="city" className="field mt-2" maxLength={120}
              required={needsCity(modes)} defaultValue={pre.location ?? ""} />
            <span className="mt-2 block text-xs" style={{ color: "var(--muted)" }}>
              {t(locale, needsCity(modes) ? "onboarding.locationHint" : "onboarding.locationOptional")}
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

        <Question n={3} title={t(locale, "onboarding.salary")} hint={t(locale, "onboarding.salaryHint")}>
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

        {/* Витяг із резюме. Досі текст CV розбирали на галочки й забували:
            стек, роки й мови не ловить жодна кнопка, а саме за ними
            відрізняються дві людини з однаковими галочками. Поле видиме й
            редаговане — це слова людини, а не наш висновок про неї. */}
        <Question n={4}
                  title={t(locale, pre.fromCv ? "onboarding.fromCv" : "onboarding.ownWords")}
                  hint={t(locale, pre.fromCv ? "onboarding.fromCvHint" : "onboarding.ownWordsHint")}>
          <textarea name="cvHighlights" className="field" rows={2} maxLength={300}
            defaultValue={pre.cvHighlights ?? ""} placeholder={t(locale, "onboarding.fromCvPlaceholder")} />
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
var HINT_NEED=${JSON.stringify(t(locale, "onboarding.locationHint"))},HINT_OPT=${JSON.stringify(t(locale, "onboarding.locationOptional"))};
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
  city.required=need;
  var hint=row.querySelector('span:last-child');
  if(hint)hint.textContent=need?HINT_NEED:HINT_OPT;
}
for(var k=0;k<m.length;k++)m[k].addEventListener('change',sync);
sync();
})()}catch(e){}` }} />
    </form>
  );
}
