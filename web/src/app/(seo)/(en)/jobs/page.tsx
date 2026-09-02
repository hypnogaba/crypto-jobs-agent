import type { Metadata } from "next";
import Link from "next/link";
import { JOBS_PAGES, countFor } from "@/lib/jobs-pages";
import { SITE } from "@/lib/seo";

/**
 * Вузол розділу. Він потрібен не людині, а обходу: сторінка без жодного
 * посилання на себе з сайту індексується погано, скільки б її не було в
 * карті. Звідси ведуть посилання на всі добірки, а сюди — з підвалу.
 */

const TITLE = "Job collections";
const LEDE = "Every live role we read today, grouped the same way the daily digest groups them.";

export const generateMetadata = async (): Promise<Metadata> => ({
  title: TITLE,
  description: LEDE,
  alternates: { canonical: `${SITE}/jobs` },
  openGraph: { title: TITLE, description: LEDE, url: `${SITE}/jobs`, siteName: "NextRole", type: "website" },
});

export default async function Page() {
  // Один запит на добірку, двадцять два запити на сторінку. Це дорожче за
  // решту сайту, тож числа тут — не окраса: порожня добірка має бути видно
  // порожньою, інакше людина йде в неї даремно.
  const counts = await Promise.all(JOBS_PAGES.map((p) => countFor(p.tag)));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <h1 className="display text-3xl sm:text-5xl">{TITLE}</h1>
      <p className="lede mt-5">{LEDE}</p>

      <ul className="ruled card mt-10">
        {JOBS_PAGES.map((p, i) => (
          <li key={p.slug} className="flex items-baseline justify-between gap-4 px-6 py-4">
            <span>
              <Link href={`/jobs/${p.slug}`} className="link font-medium">{p.title}</Link>
              <span className="mt-1 block text-sm" style={{ color: "var(--ink-2)" }}>{p.lede}</span>
            </span>
            <span className="mono text-xs" style={{ color: "var(--muted)" }}>{counts[i]}</span>
          </li>
        ))}
      </ul>

      <div className="card mt-10 px-6 py-5">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          These pages are a snapshot. The product is the other way round: you say what
          you are looking for once, and five matching roles arrive in Telegram every
          morning.
        </p>
        <Link href="/" className="btn mt-5">Set it up</Link>
      </div>
    </main>
  );
}
