import type { Metadata } from "next";
import HomeBody from "../_pages/home";
import { localeParam } from "../_pages/param";
import { pageMeta } from "@/lib/seo";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await localeParam(params);
  // Назви не даємо: title.default із root layout — це вже назва головної.
  const { title: _title, ...rest } = pageMeta(locale, "/", "");
  return rest;
}

export default async function Page({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ error?: string }> }) {
  const locale = await localeParam(params);
  return <HomeBody locale={locale} searchParams={searchParams} />;
}
