import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/faq", "/sources", "/privacy", "/login", "/feedback"],
      // Кабінет і адмінка не мають потрапляти в індекс
      disallow: ["/dashboard", "/settings", "/admin", "/telegram", "/enter", "/onboarding", "/profile", "/go/", "/apply/", "/api/"],
    }],
    sitemap: "https://nextrole.info/sitemap.xml",
  };
}
