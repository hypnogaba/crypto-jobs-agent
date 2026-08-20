"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { parseCv } from "@/lib/ai";

export async function startOnboarding(formData: FormData) {
  const input = String(formData.get("input") ?? "").trim();
  if (!input) {
    throw new Error("Tell us what you're looking for, or paste your CV.");
  }

  const parsed = await parseCv(input);
  const prisma = await getPrisma();

  const user = await prisma.user.create({
    data: {
      profile: {
        create: {
          mode: "FREETEXT",
          rawInput: input,
          seekingRole: parsed.seekingRole,
          category: parsed.category,
          location: parsed.location,
          remoteOk: parsed.remoteOk,
          salaryMin: parsed.salaryMin,
        },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set("userId", user.id, { httpOnly: true, sameSite: "lax" });

  redirect("/onboarding/details");
}

export async function saveDetails(formData: FormData) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const category = String(formData.get("category") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const remoteOk = formData.get("remoteOk") === "on";
  const salaryMinRaw = String(formData.get("salaryMin") ?? "").trim();
  const salaryMin = salaryMinRaw ? Number.parseInt(salaryMinRaw, 10) : null;

  const prisma = await getPrisma();
  await prisma.candidateProfile.update({
    where: { userId },
    data: { category, location, remoteOk, salaryMin },
  });

  redirect("/onboarding/connect");
}
