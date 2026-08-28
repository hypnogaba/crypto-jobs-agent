import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Cloudflare Web Analytics.
 *
 * Обрано замість Google Analytics свідомо: маячок не ставить кук і не тримає
 * ідентифікатора людини, тому банер згоди й окремий розділ у політиці не
 * потрібні. У продукту вже є користувачі з ЄС — з GA сайт довелося б
 * зупиняти на «прийняти cookies» ще до першого екрана.
 *
 * Токен не є секретом: він видимий у HTML кожної сторінки й дозволяє лише
 * надсилати перегляди в наш же лічильник. Тому живе у `vars` у
 * wrangler.jsonc, а не в секретах воркера.
 */
export default function Analytics() {
  let token: string | undefined;
  try {
    token = getCloudflareContext().env.WEB_ANALYTICS_TOKEN;
  } catch {
    // Поза Worker'ом (наприклад, у тестах) прив'язок немає — це не помилка.
  }
  if (!token) return null;

  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}
