"use client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { UiProvider } from "@/lib/ui-store";
import { ServicesBoot } from "@/components/services-boot";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <UiProvider>
          {children}
          <ServicesBoot />
          <Toaster position="bottom-right" richColors closeButton />
        </UiProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
