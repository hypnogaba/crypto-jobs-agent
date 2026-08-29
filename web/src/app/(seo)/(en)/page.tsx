import type { Metadata } from "next";
import HomeBody from "../_pages/home";
import { pageMeta, siteTitleFor } from "@/lib/seo";

/**
 * Назву сторінці не віддаємо, а картці — віддаємо.
 *
 * `title` викидаємо, бо шаблон "%s — NextRole" із кореня приклеївся б удруге.
 * Але в og і twitter назва мусить бути справжня: доки сюди йшов порожній
 * рядок, og:image:alt лишався порожнім і зникав із розмітки.
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const { title: _title, ...rest } = pageMeta("en", "/", siteTitleFor("en"));
  return rest;
};

export default function Page({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  return <HomeBody locale="en" searchParams={searchParams} />;
}
