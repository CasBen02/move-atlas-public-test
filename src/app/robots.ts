import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/demo", "/privacy", "/terms", "/safety", "/support"], disallow: ["/app", "/setup", "/account", "/api"] },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
