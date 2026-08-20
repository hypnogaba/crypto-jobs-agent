import { startOnboarding } from "./actions";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Find your next role
        </h1>
        <p className="mt-2 text-zinc-500">
          Tell us what you&apos;re looking for, or paste your CV. We&apos;ll do the
          searching — up to 5 matches a day, sent to Telegram.
        </p>

        <form action={startOnboarding} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              What are you looking for, and where?
            </span>
            <textarea
              name="input"
              required
              rows={5}
              placeholder="Senior backend engineer, fintech, remote EU timezone, from $100k. Or paste your CV here."
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Continue
          </button>
        </form>
      </main>
    </div>
  );
}
