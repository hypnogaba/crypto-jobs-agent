import Nav from "./nav";
import type { Locale } from "@/lib/vocab";

/** Оболонка внутрішніх сторінок: вузька колонка, заголовок, багато повітря. */
export default async function Shell({
  locale, eyebrow, title, lede, width = "narrow", center = false, children,
}: {
  locale: Locale; eyebrow?: string; title: string; lede?: string;
  // Три ширини, не дві: кабінету тісно у вузькій колонці й порожньо в
  // широкій, бо картка має і опис, і дії праворуч.
  width?: "narrow" | "roomy" | "wide"; center?: boolean; children: React.ReactNode;
}) {
  const max = width === "wide" ? "max-w-5xl" : width === "roomy" ? "max-w-3xl" : "max-w-2xl";
  return (
    <>
      <Nav locale={locale} />
      <main className={`mx-auto w-full flex-1 px-6 py-14 ${max}` +
                       (center ? " flex flex-col justify-center pb-24" : "")}>
        <div className={center ? "mx-auto w-full max-w-sm" : undefined}>
          {eyebrow && <p className="eyebrow rise rise-1">{eyebrow}</p>}
          <h1 className="display rise rise-1 mt-3 text-3xl sm:text-4xl">{title}</h1>
          {lede && <p className="lede rise rise-2 mt-3">{lede}</p>}
          <div className="rise rise-3 mt-10">{children}</div>
        </div>
      </main>
    </>
  );
}
