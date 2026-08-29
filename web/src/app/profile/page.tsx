import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Shell from "../shell";
import { detectLocale } from "../actions";
import ProfileForm, { parseList } from "../profile-form";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "profile.title") };
}

/**
 * Правка профілю. Та сама форма, що й в онбордингу, але з бази, і після
 * збереження — сюди ж. Текст резюме це не чіпає: без чернетки
 * persistProfile лишає raw_input/cv_text як були.
 */
export default async function Profile({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const locale = await detectLocale();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { saved, error } = await searchParams;

  const row = await one<{ spheres: string; industries: string; seniority: string | null;
    custom_role: string | null; custom_industry: string | null;
    remote_mode: string; location: string | null; salary_min: number | null; salary_currency: string | null;
    wishes: string | null }>(
    "SELECT * FROM profiles WHERE user_id=?", user.id);
  if (!row) redirect("/");

  return (
    <Shell locale={locale} title={t(locale, "profile.title")} lede={t(locale, "profile.lede")}>
      {saved && <p className="tag tag-ok mb-5 inline-block">{t(locale, "settings.saved")}</p>}
      <ProfileForm locale={locale} back="profile" error={error} pre={{
        spheres: parseList(row.spheres), industries: parseList(row.industries),
        customRole: row.custom_role, customIndustry: row.custom_industry,
        seniority: row.seniority, remoteMode: row.remote_mode, location: row.location,
        salaryMin: row.salary_min, salaryCurrency: row.salary_currency, wishes: row.wishes,
      }} />
    </Shell>
  );
}
