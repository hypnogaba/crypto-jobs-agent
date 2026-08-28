import type { Metadata } from "next";
import { Spectral, Commissioner, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Кирилиця обов'язкова: інтерфейс має чотири мови, дві з них кириличні.
const display = Spectral({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["300", "400", "600"],
  variable: "--nr-display",
  display: "swap",
});

const ui = Commissioner({
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
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "NextRole",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
