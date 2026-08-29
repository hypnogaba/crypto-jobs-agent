import type { Metadata } from "next";
import HomeBody from "../_pages/home";
import { pageMeta } from "@/lib/seo";

/**
 * Назви сторінці не даємо: title.default із root layout — це вже назва
 * головної, і другий рядок з тим самим текстом розійшовся б із першим.
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const { title: _title, ...rest } = pageMeta("en", "/", "");
  return rest;
};

export default function Page({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  return <HomeBody locale="en" searchParams={searchParams} />;
}
