"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseCv } from "@/lib/ai";

export async function onboard(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const cvText = String(formData.get("cvText") ?? "").trim();
  const githubHandle = String(formData.get("githubHandle") ?? "").trim() || null;
  const xHandle = String(formData.get("xHandle") ?? "").trim() || null;
  const deliveryChannel = formData.get("deliveryChannel") === "TELEGRAM" ? "TELEGRAM" : "EMAIL";

  if (!email || !cvText) {
    throw new Error("Email and a short description are required.");
  }

  const parsed = await parseCv(cvText);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      deliveryChannel,
      profile: {
        create: {
          rawCvText: cvText,
          githubHandle,
          xHandle,
          ...parsed,
        },
      },
    },
    update: {
      deliveryChannel,
      profile: {
        upsert: {
          create: { rawCvText: cvText, githubHandle, xHandle, ...parsed },
          update: { rawCvText: cvText, githubHandle, xHandle, ...parsed },
        },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set("userId", user.id, { httpOnly: true, sameSite: "lax" });

  redirect("/dashboard");
}

export async function updateDeliveryChannel(formData: FormData) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const deliveryChannel = formData.get("deliveryChannel") === "TELEGRAM" ? "TELEGRAM" : "EMAIL";
  const telegramChatId = String(formData.get("telegramChatId") ?? "").trim() || null;

  await prisma.user.update({
    where: { id: userId },
    data: { deliveryChannel, telegramChatId },
  });

  redirect("/dashboard");
}
