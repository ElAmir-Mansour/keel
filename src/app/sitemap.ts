import type { MetadataRoute } from "next";

const SITE_URL = "https://keel-six-amber.vercel.app";

// The public top-level routes. Everything under them is per-user data that
// lives in the visitor's own browser, so there is nothing deeper to index.
const ROUTES = ["/", "/inbox", "/projects", "/notes", "/decisions", "/risks", "/timelines", "/graph", "/team", "/settings"];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map(
    (path): MetadataRoute.Sitemap[number] => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "weekly",
      priority: path === "/" ? 1 : 0.6,
    }),
  );
}
