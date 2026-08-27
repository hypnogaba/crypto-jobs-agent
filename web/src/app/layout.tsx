import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NextRole — five jobs every morning",
  description: "Tell us what you are looking for. Every morning we send five matching roles to your Telegram.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
