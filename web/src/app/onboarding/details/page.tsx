import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { saveDetails } from "../../actions";

export default async function OnboardingDetails() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();
  const profile = await prisma.candidateProfile.findUnique({ where: { userId } });
  if (!profile) redirect("/");

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          A few more details
        </h1>
        <p className="mt-2 text-zinc-500">
          We pre-filled these from what you told us — edit anything that&apos;s off.
        </p>

        <form action={saveDetails} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Category</span>
            <input
              type="text"
              name="category"
              defaultValue={profile.category ?? ""}
              placeholder="e.g. Engineering, Partnerships, DevRel"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Location</span>
            <input
              type="text"
              name="location"
              defaultValue={profile.location ?? ""}
              placeholder="e.g. Paris, or leave blank if fully remote"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="remoteOk" defaultChecked={profile.remoteOk} />
            Open to remote roles
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              Minimum salary (optional, USD/year)
            </span>
            <input
              type="number"
              name="salaryMin"
              defaultValue={profile.salaryMin ?? ""}
              placeholder="80000"
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
