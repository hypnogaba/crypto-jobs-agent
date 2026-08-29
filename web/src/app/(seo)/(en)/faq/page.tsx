import type { Metadata } from "next";
import FaqBody from "../../_pages/faq";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

export const generateMetadata = async (): Promise<Metadata> =>
  pageMeta("en", "/faq", t("en", "faq.title"));

export default function Page() {
  return <FaqBody locale="en" />;
}
