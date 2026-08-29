import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RootShell from "@/app/root-shell";
import { rootMetadata, PREFIXED_LOCALES } from "@/lib/seo";
import { isLocale } from "@/lib/i18n";

/**
 * Публічні сторінки всіх мов, крім англійської: /uk, /fr/faq і так далі.
 * Англійська лежить у корені, в (en), бо її адреси вже в індексі.
 *
 * Це другий root layout — окремий саме тому, що <html lang> має збігатися з
 * текстом сторінки, а взяти мову layout може лише з відрізка адреси. Поки
 * мову брали з куки, Googlebot — який ходить без куки — бачив англійську на
 * всіх чотирьох мовах, і три з них не існували для пошуку взагалі.
 */

/** Лише ці чотири. Інакше /xx/faq віддавав би англійський текст під lang="xx". */
export const dynamicParams = false;

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ locale: string }> },
): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? rootMetadata(locale) : {};
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "en") notFound();
  return <RootShell lang={locale}>{children}</RootShell>;
}
