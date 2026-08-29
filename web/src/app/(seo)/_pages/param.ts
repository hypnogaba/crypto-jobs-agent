import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";

/**
 * Мова з відрізка адреси.
 *
 * Перевірка тут, а не в кожній сторінці: сторінок під [locale] п'ять, і
 * непровірений params.locale поїхав би прямо в <html lang> та в t().
 * dynamicParams=false у layout уже відсікає чуже, але сторінка не має
 * покладатися на сусідній файл, щоб лишитися типобезпечною.
 */
export async function localeParam(
  params: Promise<{ locale: string }>,
): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "en") notFound();
  return locale;
}
