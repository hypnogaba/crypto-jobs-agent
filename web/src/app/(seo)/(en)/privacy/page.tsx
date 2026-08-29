import type { Metadata } from "next";
import PrivacyBody from "../../_pages/privacy";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

export const generateMetadata = async (): Promise<Metadata> =>
  pageMeta("en", "/privacy", t("en", "privacy.title"));

export default function Page() {
  return <PrivacyBody locale="en" />;
}
