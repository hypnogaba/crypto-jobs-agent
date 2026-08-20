import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "@/lib/prisma";

export default async function Dashboard() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) redirect("/");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const cards = await prisma.dailyCard.findMany({
    where: { userId, createdAt: { gte: startOfDay } },
    include: { jobSignal: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return (
    <div className="flex flex-1 justify-center bg-white px-6 py-16">
      <main className="w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Today&apos;s opportunities
          </h1>
          <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-900">
            Settings
          </Link>
        </div>

        {cards.length === 0 ? (
          <p className="mt-8 rounded-lg border border-zinc-200 px-4 py-6 text-sm text-zinc-500">
            Nothing new today. We checked the market and found nothing that matches
            what you&apos;re looking for. Check back tomorrow at 9:00.
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {cards.map((card) => (
              <li key={card.id} className="rounded-lg border border-zinc-200 p-5">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-medium text-zinc-900">
                    {card.jobSignal.company ?? "Unknown company"}, {card.jobSignal.role}
                  </h2>
                  <span className="text-xs uppercase tracking-wide text-zinc-400">
                    {card.jobSignal.path === "HUMAN" ? "Human path" : "Formal path"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {card.jobSignal.compFrom
                    ? `From $${card.jobSignal.compFrom.toLocaleString()}`
                    : "Compensation not listed"}
                  {card.jobSignal.remote ? `, ${card.jobSignal.remote}` : ""}
                </p>
                <p className="mt-3 text-sm text-zinc-700">
                  <span className="font-medium">Why you: </span>
                  {card.whyYou}
                </p>
                <pre className="mt-3 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm text-zinc-800">
                  {card.draftText}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
