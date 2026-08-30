import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Shell from "@/app/shell";
import { detectLocale, readDraft, refineDraft } from "@/app/actions";
import ProfileForm, { parseList, type ProfilePre } from "@/app/profile-form";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";
import { monthlyFrom } from "@/lib/salary-period";
import type { Locale } from "@/lib/vocab";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "onboarding.title") };
}

/**
 * Каркас, поки модель розбирає текст.
 *
 * Порожній екран на сім секунд був би тим самим очікуванням, лише без
 * пояснення. Тут людина одразу бачить, що ми робимо і скільки лишилось.
 */
function Waiting({ locale }: { locale: Locale }) {
  return (
    <div className="card px-6 py-8">
      <p className="text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "onboarding.reading")}</p>
      <div className="mt-4 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: "1.75rem", width: `${88 - i * 18}%`,
                                background: "var(--surface-2)", borderRadius: "999px" }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Форма з уточненим розбором.
 *
 * Окремий компонент саме заради Suspense: усе, що вище, малюється миттєво, а
 * очікування моделі лишається всередині цієї межі. Раніше на неї чекала
 * НАВІГАЦІЯ — людина тиснула стрілку й дивилась на нерухому сторінку 7.7
 * секунди.
 */
async function Filled({ locale, error }: { locale: Locale; error?: string }) {
  const user = await currentUser();
  const draft = await readDraft();

  // Розбір тексту словника «свого варіанта» не знає — його людина пише
  // руками на самій формі. А от «побажання» більше не стираємо: у leftover
  // лежить те з тексту, що не влізло в жодну кнопку («тільки стартапи», «без
  // on-call»), і саме за це підбір дає до +6 балів.
  let parsed = draft?.parsed ?? null;
  if (draft && !draft.refined) {
    // Уточнення робимо тут, і лише раз: прапорець у чернетці не дає питати
    // модель знову на кожне оновлення сторінки.
    parsed = await refineDraft(draft.id, draft.text, draft.parsed);
  }

  // Розбір тексту зводить зарплату до РІЧНОЇ — тієї одиниці, в якій лежить
  // база й міряються вакансії. Поле ж підписане «на місяць», тож сюди воно має
  // приходити місячним. Без цього переділу людина, яка написала «3000 євро»,
  // читала в місячному полі 36 000 — і, зберігши форму, множила його на 12
  // вдруге: у базу лягало 432 000, і не проходила жодна вакансія.
  let pre: ProfilePre | null = parsed
    ? { ...parsed, salaryMin: monthlyFrom(parsed.salaryMin), wishes: parsed.leftover }
    : null;
  if (!pre && user) {
    const row = await one<{ spheres: string; industries: string;
      custom_role: string | null; custom_industry: string | null;
      cv_highlights: string | null; mode: string | null;
      remote_mode: string; location: string | null; salary_min: number | null; salary_currency: string | null;
      wishes: string | null }>(
      "SELECT * FROM profiles WHERE user_id=?", user.id);
    if (row) pre = {
      spheres: parseList(row.spheres), industries: parseList(row.industries),
      customRole: row.custom_role, customIndustry: row.custom_industry,
      cvHighlights: row.cv_highlights, fromCv: row.mode === "cv",
      remoteMode: row.remote_mode, location: row.location,
      salaryMin: monthlyFrom(row.salary_min), salaryCurrency: row.salary_currency, wishes: row.wishes };
  }
  if (!pre) redirect("/");

  return (
    /* Слова людини й підстави існують лише в першому проході: на /profile
       чернетки немає, і форма там виглядає рівно як раніше. */
    <ProfileForm locale={locale} pre={pre} error={error}
      quote={draft?.text} evidence={parsed?.evidence}
      suggested={parsed?.suggested} />
  );
}

/** Перший прохід: форма з чернетки після розбору тексту. Правка живе на /profile. */
export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await detectLocale();
  const { error } = await searchParams;

  return (
    <Shell locale={locale} eyebrow="02 / 02" title={t(locale, "onboarding.title")} lede={t(locale, "onboarding.lede")}>
      <Suspense fallback={<Waiting locale={locale} />}>
        <Filled locale={locale} error={error} />
      </Suspense>
    </Shell>
  );
}
