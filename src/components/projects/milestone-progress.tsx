"use client";
import Link from "next/link";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { SERIES, STATUS_COLOR } from "@/lib/chart-theme";
import { daysUntil, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { milestoneProgress } from "@/lib/metrics";
import type { Issue, Milestone, Project } from "@/lib/types";
import { ProjectDot } from "@/components/ui-bits";

// Horizontal meters, one per milestone. The fill carries state (accent, or
// critical when overdue) and the track is a lighter step of the same hue so
// the whole bar reads as one system. Not a chart library: it is a list.

export function Meter({ pct, overdue, className }: { pct: number; overdue?: boolean; className?: string }) {
  const fill = overdue ? STATUS_COLOR.critical : SERIES[0];
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full", className)}
      style={{ backgroundColor: `color-mix(in oklab, ${fill} 18%, transparent)` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: fill }} />
    </div>
  );
}

export function MilestoneRow({
  milestone,
  issues,
  project,
  showProject,
}: {
  milestone: Milestone;
  issues: Issue[];
  project?: Project;
  showProject?: boolean;
}) {
  const t = useT();
  const { total, done, pct } = milestoneProgress(milestone, issues);
  const days = milestone.status === "done" ? null : daysUntil(milestone.dueDate);
  const overdue = days !== null && days < 0 && pct < 100;
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-xs">
        {showProject && project ? <ProjectDot project={project} /> : null}
        <Link href={`/projects/${milestone.projectId}/roadmap`} className="min-w-0 flex-1 truncate font-medium hover:underline" dir="auto">
          {milestone.title}
        </Link>
        <span className="tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
        {milestone.dueDate ? (
          <span className={cn("inline-flex shrink-0 items-center gap-1 tabular-nums", overdue ? "text-[var(--viz-critical)]" : "text-muted-foreground")}>
            {overdue ? <AlertTriangle className="size-3" aria-hidden /> : <CalendarDays className="size-3" aria-hidden />}
            {overdue ? t("{n} d overdue", { n: Math.abs(days!) }) : fmtShort(milestone.dueDate)}
          </span>
        ) : null}
      </div>
      <Meter pct={pct} overdue={overdue} className="mt-1.5" />
    </li>
  );
}

export function MilestoneProgressList({
  milestones,
  issues,
  projects,
  showProject,
  emptyText,
  className,
}: {
  milestones: Milestone[];
  issues: Issue[];
  projects?: Project[];
  showProject?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const t = useT();
  const byId = new Map((projects ?? []).map((p) => [p.id, p]));
  if (!milestones.length) return <p className={cn("text-xs text-muted-foreground", className)}>{emptyText ?? t("No active milestones.")}</p>;
  return (
    <ul className={cn("divide-y", className)}>
      {milestones.map((m) => (
        <MilestoneRow key={m.id} milestone={m} issues={issues} project={byId.get(m.projectId)} showProject={showProject} />
      ))}
    </ul>
  );
}

/** Milestones worth showing on a dashboard: not done, due-soonest first. */
export function activeMilestones(milestones: Milestone[]) {
  return milestones
    .filter((m) => m.status !== "done")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.order - b.order;
    });
}
