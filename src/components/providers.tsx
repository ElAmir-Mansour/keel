"use client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { UiProvider } from "@/lib/ui-store";
import { ServicesBoot } from "@/components/services-boot";
import { LangBoot } from "@/components/lang-boot";
import type { Lang } from "@/lib/i18n";

export function Providers({ children, lang }: { children: React.ReactNode; lang: Lang }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <UiProvider>
          <LangBoot initial={lang} />
          {children}
          <ServicesBoot />
          <Toaster position="bottom-right" richColors closeButton />
        </UiProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
