import type { Metadata } from "next";
import HomeBody from "../_pages/home";
import { localeParam } from "../_pages/param";
import { pageMeta, siteTitleFor } from "@/lib/seo";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await localeParam(params);
  // Назву сторінці не віддаємо (шаблон із кореня приклеївся б удруге),
  // а картці віддаємо: з порожнім рядком og:image:alt зникав.
  const { title: _title, ...rest } = pageMeta(locale, "/", siteTitleFor(locale));
  return rest;
}

export default async function Page({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ error?: string }> }) {
  const locale = await localeParam(params);
  return <HomeBody locale={locale} searchParams={searchParams} />;
}
