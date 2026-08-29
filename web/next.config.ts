import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Без цього getCloudflareContext() кидає в `next dev`, і кожна сторінка, що
// торкається D1 або env, віддає 500 локально — / і /login зокрема. У проді
// це no-op: прив'язки там дає сам Worker.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Shared hosting reports 32 CPUs but the account's LVE resource
  // governor can't actually spawn that many build workers — cap parallelism
  // or `next build` fails with `spawn EAGAIN`.
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  output: "standalone",
  // Збірка йде локально й на Cloudflare, не на спільному хостингу з
  // обмеженим CPU — тож перевірка типів у збірці знову ввімкнена: вона є
  // останньою заслінкою для об'єднань типів, на які спирається безпека
  // (назви стовпців у SQL, словники профілю).

  /**
   * Заголовки безпеки.
   *
   * Referrer-Policy тут не формальність: посилання входу має вигляд
   * /enter?token=…, і без цього правила токен пішов би в чужий сайт
   * заголовком Referer. Тепер назовні йде лише origin.
   *
   * CSP: без nonce (для нього потрібен proxy на кожен запит, а сторінки
   * віддаються статичними заголовками), тому script-src мусить пускати
   * inline — App Router сам вбудовує скрипти гідрації. Решта директив
   * працює на повну: жодних плагінів, фреймів, чужих form-action і base.
   * Наступний крок — nonce через proxy.ts і прибрати 'unsafe-inline'.
   */
  headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' https://cloudflareinsights.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self' https://t.me",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
