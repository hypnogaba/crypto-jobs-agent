import { notFound } from "next/navigation";
import { localeForSegment } from "@/lib/seo";
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
  // Тут саме ВІДРІЗОК адреси, а не код мови: українська живе на /ua, а
  // зветься uk. Приймати обидва не можна — дві адреси на одну сторінку самі
  // собі дублікат у пошуку, і canonical показував би на іншу з них.
  const l = localeForSegment(locale);
  if (!l || l === "en") notFound();
  return l;
}
