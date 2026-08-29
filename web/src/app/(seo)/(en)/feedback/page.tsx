import type { Metadata } from "next";
import FeedbackBody from "../../_pages/feedback";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

export const generateMetadata = async (): Promise<Metadata> =>
  pageMeta("en", "/feedback", t("en", "fb.title"));

export default function Page({
  searchParams,
}: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  return <FeedbackBody locale="en" searchParams={searchParams} />;
}
