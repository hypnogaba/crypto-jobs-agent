import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Shell from "../shell";
import { detectLocale, readDraft } from "../actions";
import ProfileForm, { parseList, type ProfilePre } from "../profile-form";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  return { title: t(locale, "onboarding.title") };
}

/** Перший прохід: форма з чернетки після розбору тексту. Правка живе на /profile. */
export default async function Onboarding() {
  const locale = await detectLocale();
  const user = await currentUser();
  const draft = await readDraft();

  let pre: ProfilePre | null = draft
    ? { ...draft.parsed, wishes: null }
    : null;
  if (!pre && user) {
    const row = await one<{ spheres: string; industries: string; seniority: string | null;
      remote_mode: string; location: string | null; salary_min: number | null; salary_currency: string | null;
      wishes: string | null }>(
      "SELECT * FROM profiles WHERE user_id=?", user.id);
    if (row) pre = {
      spheres: parseList(row.spheres), industries: parseList(row.industries),
      seniority: row.seniority, remoteMode: row.remote_mode, location: row.location,
      salaryMin: row.salary_min, salaryCurrency: row.salary_currency, wishes: row.wishes };
  }
  if (!pre) redirect("/");

  return (
    <Shell locale={locale} eyebrow="02 / 02" title={t(locale, "onboarding.title")} lede={t(locale, "onboarding.lede")}>
      <ProfileForm locale={locale} pre={pre} />
    </Shell>
  );
}
