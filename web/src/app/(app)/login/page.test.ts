import { describe, expect, it, vi } from "vitest";

/**
 * Мовчазний збій входу.
 *
 * /enter із погашеним, чужим або обрізаним посиланням веде сюди з ?error=,
 * але сторінка цей параметр не читала взагалі: людина тиснула посилання з
 * чату й бачила звичайне «відкрий бота», без натяку, що сталось. Найгірше це
 * в мить накату міграції 0045 — вона гасить УСІ живі токени одразу, тож у ту
 * хвилину сюди прилетить кожен, хто саме тисне посилання.
 *
 * Перевіряємо не наявність рядка у словнику, а те, що сторінка справді віддає
 * його в дереві — і лише тоді, коли причина є.
 */

const state = vi.hoisted(() => ({ locale: "en" as "en" | "uk" | "fr" | "ru" }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { TELEGRAM_BOT_USERNAME: "nr_bot" } }),
}));
vi.mock("@/app/actions", () => ({ detectLocale: async () => state.locale }));

import Login from "./page";
import { DICTIONARIES, LOCALES } from "@/lib/i18n";

/**
 * Увесь текст, який сторінка віддає. Йдемо по props, а не лише по children:
 * заголовок і лід їдуть у Shell пропсами, і повідомлення теж могло б.
 */
const textOf = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const props = (node as { props?: Record<string, unknown> }).props;
  return props ? Object.values(props).map(textOf).join(" ") : "";
};

const render = async (params: { error?: string }): Promise<string> =>
  textOf(await Login({ searchParams: Promise.resolve(params) }));

describe("сторінка входу пояснює мертве посилання", () => {
  it("без параметра не малює нічого зайвого", async () => {
    const plain = await render({});
    expect(plain).not.toContain(DICTIONARIES.en["auth.linkDead"]);
    // Сторінка при цьому лишається робочою: кнопка в бота на місці.
    expect(plain).toContain(DICTIONARIES.en["auth.openBot"]);
  });

  it("невідома причина теж не лишається тишею", async () => {
    // Коли завтра з'явиться новий код помилки, людина мусить бачити хоч щось.
    expect(await render({ error: "somethingNew" }))
      .toContain(DICTIONARIES.en["auth.linkDead"]);
  });

  it("причину видно всіма чотирма мовами", async () => {
    for (const l of LOCALES) {
      state.locale = l.id;
      expect({ l: l.id, has: (await render({ error: "badCredentials" }))
        .includes(DICTIONARIES[l.id]["auth.linkDead"]!) }).toEqual({ l: l.id, has: true });
    }
    state.locale = "en";
  });

  it("поруч із причиною стоїть дія — попросити нове посилання в бота", async () => {
    const failed = await render({ error: "badCredentials" });
    expect(failed).toContain(DICTIONARIES.en["auth.openBot"]);
    expect(failed).toContain("https://t.me/nr_bot?start=site");
  });
});
