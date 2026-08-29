import type { Metadata } from "next";
import PrivacyBody from "../../_pages/privacy";
import { localeParam } from "../../_pages/param";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await localeParam(params);
  return pageMeta(locale, "/privacy", t(locale, "privacy.title"));
}

export default async function Page({ params }: Params) {
  return <PrivacyBody locale={await localeParam(params)} />;
}
