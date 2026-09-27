"use client";
import Link from "next/link";
import { CalendarDays, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { daysUntil, fmtShort } from "@/lib/dates";
import { isOpen, milestoneProgress } from "@/lib/metrics";
import type { Issue, Milestone, Project, Update } from "@/lib/types";
import { HealthBadge, ProjectDot } from "@/components/ui-bits";
import { Meter } from "@/components/projects/milestone-progress";

// One card per active project: the health someone actually posted, time to
// the target date, the milestone in flight and how much is open.

export function ProjectHealthCards({
  projects,
  issues,
  milestones,
  latest,
  loading,
}: {
  projects: Project[];
  issues: Issue[];
  milestones: Milestone[];
  latest: Map<string, Update>;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }
  if (!projects.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectHealthCard key={p.id} project={p} issues={issues.filter((i) => i.projectId === p.id)} milestones={milestones.filter((m) => m.projectId === p.id)} update={latest.get(p.id)} />
      ))}
    </div>
  );
}

function ProjectHealthCard({ project, issues, milestones, update }: { project: Project; issues: Issue[]; milestones: Milestone[]; update?: Update }) {
  const open = issues.filter(isOpen).length;
  const days = daysUntil(project.targetDate);
  const active =
    milestones.filter((m) => m.status === "active").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.order - b.order)[0] ??
    milestones.filter((m) => m.status === "planned").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.order - b.order)[0];
  const live = issues.filter((i) => i.status !== "cancelled");
  const progress = active
    ? milestoneProgress(active, issues)
    : { total: live.length, done: live.filter((i) => i.status === "done").length, pct: live.length ? Math.round((live.filter((i) => i.status === "done").length / live.length) * 100) : 0 };
  const overdueTarget = days !== null && days < 0 && project.status === "active";

  return (
    <Card size="sm" className="min-w-0">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/projects/${project.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
            <ProjectDot project={project} />
            <span className="truncate font-medium" dir="auto">
              {project.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
          </Link>
          <HealthBadge health={update?.health} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {project.targetDate ? (
            <span className={cn("inline-flex items-center gap-1 tabular-nums", overdueTarget && "text-[var(--viz-critical)]")}>
              <CalendarDays className="size-3" aria-hidden />
              {days === null ? fmtShort(project.targetDate) : days < 0 ? `${-days} d past target` : days === 0 ? "Target today" : `${days} d to target`}
            </span>
          ) : (
            <span>No target date</span>
          )}
          <span className="tabular-nums">
            {open} open issue{open === 1 ? "" : "s"}
          </span>
          {project.status === "paused" ? <span>Paused</span> : null}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground" dir="auto">
              {active ? active.title : "All issues"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          </div>
          <Meter pct={progress.pct} overdue={active ? (daysUntil(active.dueDate) ?? 0) < 0 && progress.pct < 100 : false} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{update ? `Updated ${fmtShort(update.date)}` : "No update yet"}</span>
          <Link href={`/projects/${project.id}/updates`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
            <MessageSquarePlus className="size-3" aria-hidden />
            Post update
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
