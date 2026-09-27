"use client";
import { addDays, addWeeks, differenceInCalendarDays, eachWeekOfInterval, format, startOfWeek, subWeeks } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CircleDashed, CircleDot, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fmtDate, isOverdue, parseYMD } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { milestoneProgress } from "@/lib/metrics";
import type { Issue, Milestone, MilestoneStatus, Person, Project } from "@/lib/types";
import { MarkdownView } from "@/components/markdown";
import { IssueRow } from "./issue-row";
import { compareIssues } from "./issue-utils";

// A hand-rolled timeline: one CSS grid with a label column and a track
// column. Inside each track, a nested grid has one column per day, so bars
// are placed with grid-column and follow the writing direction for free.

// Labels stay English here; render them through t().
export const MILESTONE_STATUSES: { value: MilestoneStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
];

/** English label for a milestone status; wrap in t() where it renders. */
export function milestoneStatusLabel(s: MilestoneStatus) {
  return MILESTONE_STATUSES.find((x) => x.value === s)?.label ?? s;
}

export function MilestoneStatusIcon({ status, className }: { status: MilestoneStatus; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  if (status === "done") return <CheckCircle2 className={cn(c, "text-[var(--viz-good)]")} />;
  if (status === "active") return <CircleDot className={cn(c, "text-[var(--viz-series-4)]")} />;
  return <CircleDashed className={cn(c, "text-muted-foreground")} />;
}

export function isMilestoneOverdue(m: Milestone) {
  return m.status !== "done" && isOverdue(m.dueDate);
}

export interface TimelineRange {
  start: Date;
  days: number;
  weeks: Date[];
  todayIdx: number;
}

export function computeRange(milestones: Milestone[], today: Date): TimelineRange {
  let min = subWeeks(today, 2);
  let max = addWeeks(today, 6);
  const floor = subWeeks(today, 26);
  const ceil = addWeeks(today, 52);
  for (const m of milestones) {
    for (const s of [m.startDate, m.dueDate]) {
      if (!s) continue;
      const d = parseYMD(s);
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  if (min < floor) min = floor;
  if (max > ceil) max = ceil;
  const start = startOfWeek(min, { weekStartsOn: 1 });
  const end = startOfWeek(addWeeks(max, 1), { weekStartsOn: 1 });
  return {
    start,
    days: differenceInCalendarDays(end, start),
    weeks: eachWeekOfInterval({ start, end: addDays(end, -1) }, { weekStartsOn: 1 }),
    todayIdx: differenceInCalendarDays(today, start),
  };
}

type Bar =
  | { kind: "bar"; from: number; to: number; open: boolean }
  | { kind: "diamond"; at: number }
  | { kind: "none" };

function barFor(m: Milestone, r: TimelineRange): Bar {
  const clamp = (n: number) => Math.min(r.days - 1, Math.max(0, n));
  const idx = (s: string) => clamp(differenceInCalendarDays(parseYMD(s), r.start));
  if (m.startDate && m.dueDate) {
    const from = idx(m.startDate);
    return { kind: "bar", from, to: Math.max(from, idx(m.dueDate)), open: false };
  }
  if (m.dueDate) return { kind: "diamond", at: idx(m.dueDate) };
  if (m.startDate) {
    const from = idx(m.startDate);
    return { kind: "bar", from, to: Math.max(from, clamp(r.todayIdx)), open: true };
  }
  return { kind: "none" };
}

const dayGrid = (days: number): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` });

export function RoadmapTimeline({
  milestones,
  issues,
  project,
  personById,
  range,
  expanded,
  onToggle,
  onEdit,
  onMove,
}: {
  milestones: Milestone[];
  issues: Issue[];
  project?: Project | null;
  personById: Map<string, Person>;
  range: TimelineRange;
  expanded: string | null;
  onToggle: (id: string) => void;
  onEdit: (m: Milestone) => void;
  onMove: (m: Milestone, dir: -1 | 1) => void;
}) {
  const t = useT();
  const { days, weeks, todayIdx } = range;
  const showToday = todayIdx >= 0 && todayIdx < days;
  const weekLabelEvery = weeks.length > 20 ? 4 : weeks.length > 10 ? 2 : 1;

  // Month spans across the week header.
  const months: { label: string; from: number; span: number }[] = [];
  weeks.forEach((w, i) => {
    const label = format(w, "MMM yyyy");
    const last = months[months.length - 1];
    if (last && last.label === label) last.span += 1;
    else months.push({ label, from: i, span: 1 });
  });

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[9rem_minmax(0,1fr)] md:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="border-b border-e bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">{t("Milestone")}</div>
        <div className="border-b bg-muted/40">
          <div style={dayGrid(days)} className="h-5 text-[10px] font-medium text-muted-foreground">
            {months.map((m) => (
              <div key={m.label} style={{ gridColumn: `${m.from * 7 + 1} / span ${m.span * 7}` }} className="truncate border-s px-1 leading-5">
                {m.label}
              </div>
            ))}
          </div>
          <div style={dayGrid(days)} className="h-4 text-[10px] text-muted-foreground">
            {weeks.map((w, i) => (
              <div key={w.toISOString()} style={{ gridColumn: `${i * 7 + 1} / span 7` }} className="truncate border-s border-border/60 px-1 leading-4">
                {i % weekLabelEvery === 0 ? format(w, "d") : ""}
              </div>
            ))}
          </div>
        </div>

        {milestones.map((m, i) => {
          const bar = barFor(m, range);
          const progress = milestoneProgress(m, issues);
          const overdue = isMilestoneOverdue(m);
          const isOpen = expanded === m.id;
          const mine = issues.filter((x) => x.milestoneId === m.id).sort(compareIssues);
          // Formatted dates are LTR runs, so the arrow between them reads
          // correctly in either document direction and is left as is.
          const dates = m.startDate || m.dueDate ? [m.startDate ? fmtDate(m.startDate) : "…", m.dueDate ? fmtDate(m.dueDate) : "…"].join(" → ") : t("No dates");
          return (
            <div key={m.id} className="contents">
              <div className={cn("flex items-center border-b border-e", isOpen && "bg-muted/30")}>
                <button
                  type="button"
                  onClick={() => onToggle(m.id)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-start text-sm hover:bg-muted/50"
                >
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform rtl:rotate-180", isOpen && "rotate-90 rtl:rotate-90")} />
                  <MilestoneStatusIcon status={m.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" dir="auto">{m.title}</span>
                    <span className={cn("flex items-center gap-1.5 text-xs", overdue ? "text-[var(--viz-critical)]" : "text-muted-foreground")}>
                      {overdue ? <AlertTriangle className="size-3" /> : null}
                      {overdue ? t("Overdue") : t(milestoneStatusLabel(m.status))}
                      <span className="tabular text-muted-foreground">· {progress.done}/{progress.total}</span>
                    </span>
                  </span>
                </button>
                <div className="hidden flex-col pe-1 md:flex">
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t("Move up")} disabled={i === 0} onClick={() => onMove(m, -1)}>
                    <ChevronUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t("Move down")} disabled={i === milestones.length - 1} onClick={() => onMove(m, 1)}>
                    <ChevronDown />
                  </Button>
                </div>
              </div>

              <div className={cn("relative border-b", isOpen && "bg-muted/30")}>
                <div style={dayGrid(days)} className="h-full min-h-12">
                  {weeks.map((w, wi) => (
                    <div key={w.toISOString()} style={{ gridRow: 1, gridColumn: `${wi * 7 + 1} / span 7` }} className="border-s border-border/60" />
                  ))}
                  {showToday ? (
                    <div style={{ gridRow: 1, gridColumn: `${todayIdx + 1} / span 1` }} className="h-full w-0.5 justify-self-start bg-[var(--viz-series-2)]" title={t("Today")} />
                  ) : null}
                  {bar.kind === "bar" ? (
                    <div
                      style={{ gridRow: 1, gridColumn: `${bar.from + 1} / ${bar.to + 2}` }}
                      title={t("{title} · {dates} · {pct}% done", { title: m.title, dates, pct: progress.pct })}
                      className={cn(
                        "relative z-10 my-3 h-6 min-w-1 self-center overflow-hidden rounded-md bg-[color-mix(in_oklab,var(--viz-ordinal-1)_35%,transparent)]",
                        bar.open && "rounded-e-none border-e-2 border-dashed border-[var(--viz-ordinal-3)]",
                        overdue && "ring-1 ring-[var(--viz-critical)]",
                      )}
                    >
                      {/* The label is drawn twice and clipped, so it stays legible on both the fill and the track. */}
                      <span className="tabular absolute inset-0 truncate px-2 text-[11px] leading-6 text-foreground">{progress.total ? `${progress.pct}%` : ""}</span>
                      <div className="absolute inset-y-0 start-0 overflow-hidden bg-[var(--viz-ordinal-3)]" style={{ width: `${progress.pct}%` }}>
                        <span className="tabular block whitespace-nowrap px-2 text-[11px] leading-6 text-white">{progress.total ? `${progress.pct}%` : ""}</span>
                      </div>
                    </div>
                  ) : bar.kind === "diamond" ? (
                    <div style={{ gridRow: 1, gridColumn: `${bar.at + 1} / span 1` }} className="relative z-10 flex items-center justify-center" title={t("{title} · due {date}", { title: m.title, date: fmtDate(m.dueDate) })}>
                      <span className={cn("block size-3 rotate-45 rounded-[2px]", overdue ? "bg-[var(--viz-critical)]" : "bg-[var(--viz-ordinal-3)]")} />
                    </div>
                  ) : (
                    <div style={{ gridRow: 1, gridColumn: `1 / -1` }} className="self-center px-2 text-xs text-muted-foreground">
                      {t("No dates yet")}
                    </div>
                  )}
                </div>
              </div>

              {isOpen ? (
                <div className="col-span-2 border-b bg-muted/20 px-3 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><MilestoneStatusIcon status={m.status} />{t(milestoneStatusLabel(m.status))}</span>
                        <span>{dates}</span>
                        <span className="tabular">{t("{done}/{total} done", { done: progress.done, total: progress.total })}</span>
                        {overdue ? <span className="inline-flex items-center gap-1 text-[var(--viz-critical)]"><AlertTriangle className="size-3" /> {t("Overdue")}</span> : null}
                      </div>
                      {m.description.trim() ? <MarkdownView body={m.description} className="text-sm" /> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => onEdit(m)}>
                        <Pencil /> {t("Edit")}
                      </Button>
                      <div className="flex md:hidden">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("Move up")} disabled={i === 0} onClick={() => onMove(m, -1)}><ChevronUp /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("Move down")} disabled={i === milestones.length - 1} onClick={() => onMove(m, 1)}><ChevronDown /></Button>
                      </div>
                    </div>
                  </div>
                  {mine.length ? (
                    <div className="mt-3 divide-y overflow-hidden rounded-md border bg-background">
                      {mine.map((issue) => (
                        <IssueRow key={issue.id} issue={issue} project={project} assignee={personById.get(issue.assigneeId ?? "")} />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">{t("No issues in this milestone yet. Assign some from the list below.")}</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
