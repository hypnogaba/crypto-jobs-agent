import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="display mt-3 text-3xl">This page does not exist.</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
          It may have moved, or the link may be old.
        </p>
        <Link href="/" className="btn mt-8">Go to the start</Link>
      </div>
    </main>
  );
}
