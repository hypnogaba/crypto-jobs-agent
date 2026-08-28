import Nav from "./nav";
import type { Locale } from "@/lib/vocab";

/**
 * Оболонка внутрішніх сторінок: вузька колонка, заголовок, багато повітря.
 *
 * `night` лишає сторінку темною в обох темах — так само, як смуга на головній.
 * Це для входу й реєстрації: вони — продовження тієї самої дії, тому не мають
 * виглядати як інший сайт.
 */
export default async function Shell({
  locale, eyebrow, title, lede, wide = false, night = false, center = false, children,
}: {
  locale: Locale; eyebrow?: string; title: string; lede?: string;
  wide?: boolean; night?: boolean; center?: boolean; children: React.ReactNode;
}) {
  const body = (
    <main className={`relative z-10 mx-auto w-full flex-1 px-6 py-14 ${wide ? "max-w-5xl" : "max-w-2xl"}` +
                     (center ? " flex flex-col justify-center pb-24" : "")}>
      <div className={center ? "mx-auto w-full max-w-sm" : undefined}>
        {eyebrow && <p className="eyebrow rise rise-1">{eyebrow}</p>}
        <h1 className="display rise rise-1 mt-3 text-3xl sm:text-4xl">{title}</h1>
        {lede && <p className="lede rise rise-2 mt-3" style={night ? { color: "var(--night-2)" } : undefined}>{lede}</p>}
        <div className="rise rise-3 mt-10">{children}</div>
      </div>
    </main>
  );

  if (night) {
    return (
      <div className="night flex min-h-screen flex-col">
        <Nav locale={locale} onNight />
        {body}
      </div>
    );
  }
  return (
    <>
      <Nav locale={locale} />
      {body}
    </>
  );
}
