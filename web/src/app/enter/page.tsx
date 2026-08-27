import { redirect } from "next/navigation";
import { one, run } from "@/lib/db";
import { createSession } from "@/lib/auth";

/** Разовий вхід із бота: /site видає посилання, дійсне 15 хвилин. */
export default async function Enter({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/login");

  const user = await one<{ id: string; connect_expires_at: string | null }>(
    "SELECT id,connect_expires_at FROM users WHERE connect_token=?", token);

  const fresh = user?.connect_expires_at && new Date(user.connect_expires_at).getTime() > Date.now();
  if (!user || !fresh) redirect("/login?error=badCredentials");

  await run("UPDATE users SET connect_token=NULL, connect_expires_at=NULL, last_interaction_at=datetime('now') WHERE id=?", user.id);
  await createSession(user.id);
  redirect("/dashboard");
}
