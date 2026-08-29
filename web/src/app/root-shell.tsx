import { cookies } from "next/headers";
import Analytics from "@/app/analytics";
import JsonLd from "@/app/json-ld";
import { organizationLd, webSiteLd } from "@/lib/seo";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { Locale } from "@/lib/vocab";
import "@/app/globals.css";

/**
 * Спільне тіло для обох root layout.
 *
 * Root layout тепер два: один для сторінок застосунку, де мова береться з
 * куки, і один для публічних сторінок, де мова стоїть в адресі. Обидва мусять
 * віддавати свої <html> і <body> — так вимагає Next. Спільним лишається все
 * решта, і воно тут, бо два однакові каркаси розійшлися б із першою ж правкою.
 */

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

/**
 * Тема ставиться на сервері, а не в браузері.
 *
 * Сторінки рендеряться на Workers, тож тема має бути відома до першого байта —
 * інакше людина щоразу бачила б спалах чужої теми. Порожня кука означає «як у
 * системі»: атрибута немає, і працює медіа-умова prefers-color-scheme.
 */
export default async function RootShell({
  lang,
  children,
}: {
  lang: Locale;
  children: React.ReactNode;
}) {
  const chosen = (await cookies()).get("nr_theme")?.value;
  const theme = chosen === "light" || chosen === "dark" ? chosen : undefined;

  return (
    <html lang={lang} data-theme={theme} className={`${ui.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        {/* Хто ми і що це за сайт. Один раз на сторінку, не на блок. */}
        <JsonLd data={organizationLd()} />
        <JsonLd data={webSiteLd()} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
