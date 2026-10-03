"use client";
import { useEffect } from "react";
import "./globals.css";
import { Button } from "@/components/ui/button";
import { getLang, useT } from "@/lib/i18n";

// The last resort: the root layout itself failed, so this renders its own
// <html> and <body>. No providers, no fonts, no database, no assistant and
// no shared page primitives — only what is needed to say so and offer a way
// out. A plain anchor is used because the router may be what broke.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const lang = getLang();
  useEffect(() => {
    console.error(error);
    // The theme provider is not mounted here; honour its stored choice by hand.
    try {
      const stored = localStorage.getItem("theme");
      const dark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      /* storage unavailable; stay light */
    }
  }, [error]);
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} suppressHydrationWarning className="h-full antialiased">
      <body className="flex min-h-full items-center justify-center p-6">
        <main className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
          <h1 className="text-lg font-semibold">{t("Keel could not load")}</h1>
          <p className="text-sm text-muted-foreground">{t("Reload the page. If this keeps happening, your data is still safe in this browser.")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>{t("Try again")}</Button>
            <Button asChild variant="outline">
              {/* A full navigation on purpose: the router may be what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/">{t("Back to home")}</a>
            </Button>
          </div>
          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground" dir="ltr">
              {t("Error reference")}: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
