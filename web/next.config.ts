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
  // Type checking is done locally (`tsc --noEmit`) and in the repo's own
  // history — skip it during the production build on this constrained host,
  // where it stalls under the LVE CPU governor rather than failing outright.
  typescript: {
    ignoreBuildErrors: true,
  },

  /**
   * Заголовки безпеки. До цього не було жодного.
   *
   * Referrer-Policy тут не формальність: посилання входу має вигляд
   * /enter?token=…, і без цього правила токен пішов би в чужий сайт
   * заголовком Referer. Тепер назовні йде лише origin.
   *
   * CSP свідомо не додаю наосліп: сторінка налаштувань має вбудований
   * скрипт визначення часового поясу, і сувора політика зламала б її
   * мовчки. Це окрема робота — з nonce і перевіркою кожної сторінки.
   */
  headers() {
    return [{
      source: "/:path*",
      headers: [
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
