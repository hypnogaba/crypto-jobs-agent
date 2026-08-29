import type { Metadata } from "next";
import SourcesBody from "../../_pages/sources";
import { localeParam } from "../../_pages/param";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await localeParam(params);
  return pageMeta(locale, "/sources", t(locale, "sources.title"));
}

export default async function Page({ params }: Params) {
  return <SourcesBody locale={await localeParam(params)} />;
}
