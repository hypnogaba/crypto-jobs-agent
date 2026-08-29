import type { Metadata } from "next";
import SourcesBody from "../../_pages/sources";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

export const generateMetadata = async (): Promise<Metadata> =>
  pageMeta("en", "/sources", t("en", "sources.title"));

export default function Page() {
  return <SourcesBody locale="en" />;
}
