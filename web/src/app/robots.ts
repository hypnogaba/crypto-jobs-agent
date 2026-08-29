import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

/**
 * robots.txt — другий рубіж, не перший.
 *
 * Перший рубіж — правила WAF у Cloudflare: там запит блокується до того, як
 * розбудить Worker, тому нічого не коштує. robots.txt лише просить, і
 * зловмисний краулер його читає рівно настільки, наскільки хоче. Тримаємо
 * обидва: чесний краулер послухає файл, нечесного зупинить WAF.
 *
 * Попередній варіант складався зі списку Allow і жодного правила для тих,
 * кого пускати не треба. Allow без Disallow не обмежує нічого: за
 * замовчуванням дозволено все. Тепер обмеження записані як обмеження.
 */

/**
 * Краулери, які беруть вміст і не приводять людей.
 *
 * Тут лише збирачі даних і SEO-розвідники. Пошукових систем, що надсилають
 * трафік, у списку немає й бути не повинно — включно з тими, що збирають
 * дані й для навчання, і для пошуку водночас (Googlebot, Bingbot).
 */
const FREELOADERS = [
  // навчальні набори і LLM
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "CCBot", "anthropic-ai", "ClaudeBot",
  "Google-Extended", "Applebot-Extended", "meta-externalagent", "FacebookBot",
  "Bytespider", "Diffbot", "Omgilibot", "ImagesiftBot",
  // SEO-розвідка
  "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "DataForSeoBot",
  "BLEXBot", "PetalBot", "Barkrowler", "SeekportBot",
];

/** Приватне. Ці шляхи не для пошуку в жодному разі. */
const PRIVATE = [
  "/dashboard", "/settings", "/admin", "/telegram", "/enter",
  "/onboarding", "/profile", "/go/", "/apply/", "/api/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Усім іншим — сайт відкритий, крім приватного.
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // Цим — нічого.
      { userAgent: FREELOADERS, disallow: "/" },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
