import { onboard } from "./actions";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Find your next web3 role
        </h1>
        <p className="mt-2 text-zinc-500">
          Tell us what you&apos;re looking for. We&apos;ll do the searching.
        </p>

        <form action={onboard} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Email</span>
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              What are you looking for?
            </span>
            <textarea
              name="cvText"
              required
              rows={5}
              placeholder="Senior Rust engineer, Solana ecosystem, remote EU timezone, from $150k. Not interested in NFT or gaming projects. (Or paste your CV.)"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">
                GitHub handle (optional)
              </span>
              <input
                type="text"
                name="githubHandle"
                placeholder="yourhandle"
                className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">
                X handle (optional)
              </span>
              <input
                type="text"
                name="xHandle"
                placeholder="yourhandle"
                className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-zinc-700">
              How should we reach you?
            </legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="radio" name="deliveryChannel" value="EMAIL" defaultChecked />
                Email
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="radio" name="deliveryChannel" value="TELEGRAM" />
                Telegram
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Get started
          </button>
        </form>
      </main>
    </div>
  );
}
