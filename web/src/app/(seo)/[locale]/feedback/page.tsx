import type { Metadata } from "next";
import FeedbackBody from "../../_pages/feedback";
import { localeParam } from "../../_pages/param";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await localeParam(params);
  return pageMeta(locale, "/feedback", t(locale, "fb.title"));
}

export default async function Page({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const locale = await localeParam(params);
  return <FeedbackBody locale={locale} searchParams={searchParams} />;
}
