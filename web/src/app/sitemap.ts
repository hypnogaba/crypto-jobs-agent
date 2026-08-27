import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://nextrole.info";
  return ["", "/faq", "/sources", "/privacy", "/login", "/register"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p === "" ? "daily" : "monthly",
    priority: p === "" ? 1 : 0.6,
  }));
}
