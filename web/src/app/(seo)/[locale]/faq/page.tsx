import type { Metadata } from "next";
import FaqBody from "../../_pages/faq";
import { localeParam } from "../../_pages/param";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await localeParam(params);
  return pageMeta(locale, "/faq", t(locale, "faq.title"));
}

export default async function Page({ params }: Params) {
  return <FaqBody locale={await localeParam(params)} />;
}
