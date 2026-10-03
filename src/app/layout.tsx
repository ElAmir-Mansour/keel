import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const arabic = IBM_Plex_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600"] });

const SITE_URL = "https://keel-six-amber.vercel.app";
const DESCRIPTION = "Plans, decisions, notes and a dashboard for tech leads. Local-first, markdown, with an AI assistant that reads your vault.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Keel", template: "%s · Keel" },
  description: DESCRIPTION,
  applicationName: "Keel",
  keywords: ["tech lead", "engineering manager", "decision log", "ADR", "notes", "markdown", "local-first", "roadmap", "risks", "timeline", "Arabic", "RTL", "PWA"],
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Keel",
    title: "Keel",
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
    alternateLocale: ["ar"],
  },
  twitter: { card: "summary_large_image", title: "Keel", description: DESCRIPTION },
  appleWebApp: { capable: true, title: "Keel", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The language lives in a cookie so the server renders the right one and
  // right-to-left pages never flash left-to-right.
  const store = await cookies();
  const lang = store.get("keel.lang")?.value === "ar" ? "ar" : "en";
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${arabic.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers lang={lang}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
