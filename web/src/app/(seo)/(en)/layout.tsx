import type { Metadata } from "next";
import RootShell from "@/app/root-shell";
import { rootMetadata } from "@/lib/seo";

/**
 * Англійські публічні сторінки. Лежать у корені (`/faq`, а не `/en/faq`) —
 * ці адреси вже в індексі, і переїзд коштував би 301 на кожній ні за що.
 *
 * Мова тут зашита, і саме тому це окремий root layout: <html lang> мусить
 * збігатися з текстом сторінки, а дізнатися мову з адреси layout може лише
 * тоді, коли мова і є відрізком адреси. Поки її брали з куки, Googlebot —
 * який ходить без куки — бачив англійську на всіх чотирьох мовах.
 */
export const metadata: Metadata = rootMetadata("en");

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>;
}
