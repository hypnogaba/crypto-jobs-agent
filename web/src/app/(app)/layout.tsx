import type { Metadata } from "next";
import RootShell from "@/app/root-shell";
import { detectLocale } from "@/app/actions";

const SITE = "https://nextrole.info";
const TITLE = "NextRole — five jobs every morning";
const DESCRIPTION =
  "Tell us what you are looking for once. Every morning we send five matching roles " +
  "to your Telegram, each with a live link.";

export const metadata: Metadata = {
  // Канонічна адреса — власний домен. Без цього посилання, якими діляться,
  // вели б на workers.dev, і пошук індексував би дві копії одного сайту.
  metadataBase: new URL(SITE),
  // Шаблон: сторінка дає свою назву своєю мовою, а хвіст лишається брендом.
  title: { default: TITLE, template: "%s — NextRole" },
  description: DESCRIPTION,
  // Canonical тут НЕ ставимо. Next зливає метадані батька в дитину, тому
  // alternates.canonical="/" у корені означав, що кожна сторінка віддавала
  // canonical головної — тобто сайт сам просив пошук викинути її з індексу.
  openGraph: {
    type: "website",
    siteName: "NextRole",
    title: TITLE,
    description: DESCRIPTION,
    // Без картки посилання на продукт у Telegram виглядало як голий рядок
    // тексту — а перший канал поширення тут саме Telegram. Картка
    // збирається з тих самих величин, що й сайт: brand/og/gen.py.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  // Сторінки застосунку пошуку не потрібні. robots.txt їх і так закриває,
  // але тег переживає ситуацію, коли на приватну адресу є зовнішнє посилання:
  // Disallow лише забороняє обхід, а не індексацію знайденої іншим шляхом
  // адреси. noindex закриває і це.
  robots: { index: false, follow: false },
};

/**
 * Каркас застосунку: кабінет, налаштування, онбординг, вхід.
 *
 * Мова тут береться з куки й акаунту, а не з адреси — саме тому це окремий
 * root layout. Публічні сторінки живуть у (seo) і мову мають в URL, бо
 * інакше пошук не може дістатися до жодної, крім англійської.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Саме detectLocale, а не читання куки тут-таки: сторінки беруть мову ним,
  // і він знає ще й users.locale. Акаунт із бота приходить на сайт без куки —
  // раніше французький текст їхав у <html lang="en">.
  const lang = await detectLocale();
  return <RootShell lang={lang}>{children}</RootShell>;
}
