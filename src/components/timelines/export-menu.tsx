"use client";
import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, Download, FileImage, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmtDate, todayYMD } from "@/lib/dates";
import { getLang, useT } from "@/lib/i18n";
import { downloadBlob, pngBlob, printTimeline, safeFilename, standaloneSvg, svgBlob, type ExportTheme } from "@/lib/timeline/export";
import { splitByState } from "@/lib/timeline/layout";
import { timelineToText } from "@/lib/timeline/text";
import type { Timeline, TimelineEntry } from "@/lib/types";
import { relativeLabel } from "./timeline-story";

// Export the chart as the person will use it: a PNG for a slide or a chat, an
// SVG for a design tool, a PDF handout through the print dialog, or the text
// form for a note. Everything runs in the browser from the on-screen SVG.

export function ExportMenu({ timeline, svgRef, today = todayYMD() }: { timeline: Timeline; svgRef: RefObject<SVGSVGElement | null>; today?: string }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const name = `${safeFilename(timeline.title)}-${today}`;

  async function withSvg(kind: string, fn: (svg: SVGSVGElement) => Promise<void>, theme: ExportTheme = "light") {
    const el = svgRef.current;
    if (!el) {
      toast.error(t("The chart is not on screen yet."));
      return;
    }
    setBusy(kind);
    try {
      await fn(await standaloneSvg(el, theme));
    } catch (e) {
      toast.error(t("Export failed"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const png = (theme: ExportTheme) =>
    withSvg(
      "png",
      async (svg) => {
        downloadBlob(await pngBlob(svg, 2), `${name}${theme === "dark" ? "-dark" : ""}.png`);
        toast.success(t("PNG saved"));
      },
      theme,
    );
  const svgFile = () =>
    withSvg("svg", async (svg) => {
      downloadBlob(svgBlob(svg), `${name}.svg`);
      toast.success(t("SVG saved"));
    });
  const pdf = () =>
    withSvg("pdf", async (svg) => {
      const { done, active, planned } = splitByState(timeline.entries, today);
      const row = (e: TimelineEntry, state: "done" | "active" | "planned") => ({
        date: e.end ? `${fmtDate(e.start, "d MMM")} → ${fmtDate(e.end, "d MMM yyyy")}` : fmtDate(e.start),
        title: e.title,
        meta: [e.group, relativeLabel(e, state, t), e.link ? `[[${e.link}]]` : null].filter(Boolean).join(" · "),
      });
      await printTimeline(svg, {
        title: timeline.title,
        description: timeline.description,
        sections: [
          { heading: t("What happened"), rows: done.map((e) => row(e, "done")) },
          { heading: t("In progress"), rows: active.map((e) => row(e, "active")) },
          { heading: t("What's next"), rows: planned.map((e) => row(e, "planned")) },
        ],
        footer: t("Exported from Keel on {date}", { date: fmtDate(today) }),
        dir: getLang() === "ar" ? "rtl" : "ltr",
        lang: getLang(),
      });
    });
  async function copyText() {
    try {
      await navigator.clipboard.writeText(timelineToText(timeline.entries));
      toast.success(t("Copied as text"));
    } catch {
      toast.error(t("Could not copy"));
    }
  }
  async function copyImage() {
    await withSvg("copy", async (svg) => {
      const blob = await pngBlob(svg, 2);
      if (typeof ClipboardItem === "undefined") throw new Error(t("This browser cannot copy images."));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success(t("Image copied"));
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy !== null} aria-label={t("Export")}>
          <Download /> <span className="max-sm:hidden">{busy ? t("Exporting…") : t("Export")}</span>
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("Chart")}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void pdf()}>
          <Printer /> {t("PDF handout (print)")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void png("light")}>
          <FileImage /> {t("PNG image")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void png("dark")}>
          <FileImage /> {t("PNG image, dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void svgFile()}>
          <FileText /> {t("SVG file")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyImage()}>
          <Copy /> {t("Copy image")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void copyText()}>
          <Copy /> {t("Copy as text")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
