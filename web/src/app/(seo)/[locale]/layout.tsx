import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RootShell from "@/app/root-shell";
import { rootMetadata, PREFIXED_LOCALES, localeForSegment, segmentFor } from "@/lib/seo";

/**
 * Публічні сторінки всіх мов, крім англійської: /ua, /fr/faq і так далі.
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
  // Відрізок, а не код: для української це /ua. Дати сюди «uk» означало б
  // збудувати сторінку за адресою, на яку не веде жодне посилання сайту.
  return PREFIXED_LOCALES.map((locale) => ({ locale: segmentFor(locale) }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ locale: string }> },
): Promise<Metadata> {
  const { locale } = await params;
  const l = localeForSegment(locale);
  return l ? rootMetadata(l) : {};
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const l = localeForSegment(locale);
  if (!l || l === "en") notFound();
  // <html lang> — код МОВИ (uk), а не відрізок адреси (ua): це те, що читають
  // екранні читалки й пошук, і країною воно не є.
  return <RootShell lang={l}>{children}</RootShell>;
}
