"use client";
import Link from "next/link";
import { useMemo } from "react";
import { CheckCircle2, CircleDashed, CircleDot, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysUntil, fmtDate, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { splitByState } from "@/lib/timeline/layout";
import type { TimelineEntry, TimelineEntryStatus } from "@/lib/types";
import { useLinkIndex } from "@/hooks/use-data";
import { resolveLink } from "@/lib/wikilinks";
import { MarkdownView } from "@/components/markdown";

// The timeline told as a story: what happened (newest first), what is in
// progress, and what comes next (soonest first). This is the table twin of
// the chart and the whole view on narrow screens, so nothing is only visual.

function StateIcon({ state, milestone, className }: { state: TimelineEntryStatus; milestone?: boolean; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  if (milestone) return <Diamond className={cn(c, state === "done" ? "fill-[var(--viz-ordinal-4)] text-[var(--viz-ordinal-4)]" : state === "active" ? "text-[var(--viz-series-1)]" : "text-[var(--viz-ordinal-3)]")} />;
  if (state === "done") return <CheckCircle2 className={cn(c, "text-[var(--viz-ordinal-4)]")} />;
  if (state === "active") return <CircleDot className={cn(c, "text-[var(--viz-series-1)]")} />;
  return <CircleDashed className={cn(c, "text-muted-foreground")} />;
}

export function relativeLabel(e: TimelineEntry, state: TimelineEntryStatus, t: (s: string, v?: Record<string, string | number>) => string) {
  const ref = state === "done" ? (e.end ?? e.start) : e.start;
  const d = daysUntil(ref);
  if (d === null) return "";
  if (d === 0) return state === "done" ? t("today") : t("starts today");
  if (state === "done") return Math.abs(d) === 1 ? t("yesterday") : Math.abs(d) < 60 ? t("{n} days ago", { n: Math.abs(d) }) : t("{n} months ago", { n: Math.round(Math.abs(d) / 30) });
  if (state === "active") {
    const left = daysUntil(e.end ?? e.start);
    return left === null ? "" : left <= 0 ? t("ends today") : left === 1 ? t("ends tomorrow") : t("{n} days left", { n: left });
  }
  return d === 1 ? t("tomorrow") : d < 60 ? t("in {n} days", { n: d }) : t("in {n} months", { n: Math.round(d / 30) });
}

export function EntryLink({ target, className }: { target: string; className?: string }) {
  const idx = useLinkIndex();
  const r = resolveLink(target, idx);
  return (
    <Link href={r.href} className={cn("font-mono text-[11px]", r.kind === "missing" ? "text-muted-foreground" : "text-[var(--viz-series-1)] hover:underline", className)} onClick={(e) => e.stopPropagation()}>
      {r.label}
    </Link>
  );
}

function Row({ e, state, selected, onSelect, t }: { e: TimelineEntry; state: TimelineEntryStatus; selected?: boolean; onSelect?: (id: string) => void; t: ReturnType<typeof useT> }) {
  const dates = e.end ? `${fmtShort(e.start)} → ${fmtDate(e.end)}` : fmtDate(e.start);
  const Comp = onSelect ? "button" : "div";
  return (
    <li>
      <Comp
        type={onSelect ? "button" : undefined}
        onClick={onSelect ? () => onSelect(e.id) : undefined}
        className={cn("flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-start text-sm", onSelect && "hover:bg-muted/60", selected && "bg-muted")}
      >
        <StateIcon state={state} milestone={e.kind === "milestone"} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("font-medium", e.kind === "milestone" && "font-semibold")} dir="auto">
              {e.title}
            </span>
            {e.group ? <span className="text-xs text-muted-foreground">{e.group}</span> : null}
            {e.link ? <EntryLink target={e.link} /> : null}
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
            <span>{dates}</span>
            <span>·</span>
            <span>{relativeLabel(e, state, t)}</span>
          </div>
          {e.note ? (
            <div className="md mt-0.5 text-xs text-muted-foreground [&_p]:my-0" dir="auto">
              <MarkdownView body={e.note} />
            </div>
          ) : null}
        </div>
      </Comp>
    </li>
  );
}

export function TimelineStory({
  entries,
  today,
  selectedId,
  onSelect,
  columns = true,
  className,
}: {
  entries: TimelineEntry[];
  today: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Side by side on wide screens; a single chronological list otherwise. */
  columns?: boolean;
  className?: string;
}) {
  const t = useT();
  const { done, active, planned } = useMemo(() => splitByState(entries, today), [entries, today]);
  if (!entries.length) return null;
  const sections: { key: TimelineEntryStatus; title: string; items: TimelineEntry[] }[] = [
    { key: "done", title: t("What happened"), items: done },
    { key: "active", title: t("In progress"), items: active },
    { key: "planned", title: t("What's next"), items: planned },
  ];
  return (
    <div className={cn(columns ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3" : "grid gap-6", className)}>
      {sections
        .filter((s) => s.items.length)
        .map((s) => (
          <section key={s.key} aria-label={s.title}>
            <h3 className="mb-1.5 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.title}
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium tabular-nums">{s.items.length}</span>
            </h3>
            <ul className="divide-y divide-border/60">
              {s.items.map((e) => (
                <Row key={e.id} e={e} state={s.key} selected={selectedId === e.id} onSelect={onSelect} t={t} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
