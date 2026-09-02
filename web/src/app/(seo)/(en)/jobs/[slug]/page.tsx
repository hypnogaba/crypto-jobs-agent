import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JOBS_PAGES, PAGE_SIZE, countFor, jobsFor, pageBySlug, type ListedJob } from "@/lib/jobs-pages";
import { SITE } from "@/lib/seo";
import { toLatin } from "@/lib/geo";

/**
 * Сторінка-добірка: єдиний бік продукту, який бачить пошук.
 *
 * Малюється на кожен запит, як і решта сайту. Один запит до D1 зі стелею в
 * шістдесят рядків — це дешевше за будь-яку добірку й на два порядки дешевше
 * за те, що ми вже витрачаємо на доставку.
 */

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const page = pageBySlug((await params).slug);
  if (!page) return {};
  const url = `${SITE}/jobs/${page.slug}`;
  return {
    title: page.title,
    description: page.lede,
    alternates: { canonical: url },
    openGraph: { title: page.title, description: page.lede, url, siteName: "NextRole", type: "website" },
  };
}

const money = (j: ListedJob): string | null => {
  if (!j.salary_min && !j.salary_max) return null;
  const n = (v: number) => v.toLocaleString("en-GB");
  const range = j.salary_min && j.salary_max
    ? `${n(j.salary_min)}–${n(j.salary_max)}`
    : n((j.salary_min ?? j.salary_max)!);
  return `${range} ${j.salary_currency ?? ""}`.trim();
};

const when = (iso: string | null): string | null =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null;

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const page = pageBySlug((await params).slug);
  if (!page) notFound();

  const [jobs, total] = await Promise.all([jobsFor(page.tag), countFor(page.tag)]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <p className="eyebrow">
        <Link href="/jobs" className="link">All collections</Link>
      </p>
      <h1 className="display mt-4 text-3xl sm:text-5xl">{page.title}</h1>
      <p className="lede mt-5">{page.lede}</p>
      <p className="mono mt-3 text-xs" style={{ color: "var(--muted)" }}>
        {total} live {total === 1 ? "role" : "roles"}
        {total > PAGE_SIZE ? `, ${PAGE_SIZE} newest below` : ""} · rechecked daily
      </p>

      {/* Заклик стоїть НАД переліком, а не під ним: людина, яка знайшла цю
          сторінку в пошуку, шукає роботу саме зараз, і гортати шістдесят
          рядків, перш ніж дізнатись про щоденну добірку, вона не мусить. */}
      <div className="card mt-8 px-6 py-5">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Rather than checking this page, get five matching roles in Telegram every
          morning. Three questions, thirty seconds, free.
        </p>
        <Link href="/" className="btn mt-5">Set it up</Link>
      </div>

      {jobs.length === 0 ? (
        <p className="mt-10 text-sm" style={{ color: "var(--muted)" }}>
          Nothing live in this collection right now. The scan runs every day, so this
          is a snapshot, not a verdict.
        </p>
      ) : (
        <ul className="ruled card mt-10">
          {jobs.map((j) => (
            <li key={j.id} className="px-6 py-4">
              <a href={j.url} target="_blank" rel="noopener" className="link font-medium">
                {j.title}
              </a>
              <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
                {j.company}
                {j.location ? ` · ${toLatin(j.location)}` : ""}
                {j.remote ? " · remote" : ""}
              </p>
              <p className="mono mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {[money(j), when(j.posted_at)].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-sm" style={{ color: "var(--muted)", maxWidth: "62ch" }}>
        Every link goes to the employer&rsquo;s own posting, never to a copy of it.
        Where each one comes from is listed on the{" "}
        <Link href="/sources" className="link">sources page</Link>.
      </p>

      <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {JOBS_PAGES.filter((p) => p.slug !== page.slug).map((p) => (
          <Link key={p.slug} href={`/jobs/${p.slug}`} className="link" style={{ color: "var(--muted)" }}>
            {p.title}
          </Link>
        ))}
      </nav>
    </main>
  );
}
