import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Keel",
    short_name: "Keel",
    description: "Plans, decisions, notes and a dashboard for tech leads. Local-first.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    lang: "en",
    dir: "auto",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today's note", url: "/notes?today=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Inbox", url: "/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
