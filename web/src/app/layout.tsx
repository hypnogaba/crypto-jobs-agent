import type { Metadata } from "next";
import { cookies } from "next/headers";
import Analytics from "./analytics";
import { detectLocale } from "./actions";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Кирилиця обов'язкова: інтерфейс має чотири мови, дві з них кириличні.
//
// Одна родина на все — заголовки й інтерфейс. Вага не задана навмисно: без неї
// береться змінна вісь wght 100–900, і заголовок може стояти на 560, між
// regular і medium. Спискові ваги (як було в Spectral) такого не дають.
const ui = Inter_Tight({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--nr-ui",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--nr-mono",
  display: "swap",
});

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
  // Головна без власної назви бере повний рядок.
  title: { default: TITLE, template: "%s — NextRole" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
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
};

/**
 * Тема ставиться на сервері, а не в браузері.
 *
 * Сторінки рендеряться на Workers, тож тема має бути відома до першого байта —
 * інакше людина щоразу бачила б спалах чужої теми. Порожня кука означає «як у
 * системі»: атрибута немає, і працює медіа-умова prefers-color-scheme.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const chosen = jar.get("nr_theme")?.value;
  const theme = chosen === "light" || chosen === "dark" ? chosen : undefined;

  // lang мусить збігатися з тим, що на сторінці: інтерфейс має чотири мови, дві
  // з них кириличні. Зашите "en" ламало читалки з екрана й перенос слів.
  //
  // Саме detectLocale, а не читання куки тут-таки: сторінки беруть мову ним,
  // і він знає ще й users.locale. Акаунт із бота приходить на сайт без куки —
  // раніше французький текст їхав у <html lang="en">. Для гостя виклик не
  // коштує нічого: без куки сесії він виходить одразу, до бази не йде.
  const lang = await detectLocale();

  return (
    <html lang={lang} data-theme={theme}
          className={`${ui.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
