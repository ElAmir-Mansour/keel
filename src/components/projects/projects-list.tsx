"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FolderKanban, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { daysUntil, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { isOpen, milestoneProgress } from "@/lib/metrics";
import type { Issue, Milestone, Person, Project, ProjectStatus, Update } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { EmptyState, HealthBadge, PageHeader, PersonAvatar, ProjectDot } from "@/components/ui-bits";
import { latestUpdates } from "@/components/dashboard/data";
import { Meter } from "./milestone-progress";

// Labels stay English here and are translated at render with t(label).
const STATUS_FILTERS: { value: "all" | ProjectStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
];

const STATUS_LABEL: Record<ProjectStatus, string> = { active: "Active", paused: "Paused", done: "Done", archived: "Archived" };

interface Data {
  projects: Project[];
  issues: Issue[];
  milestones: Milestone[];
  people: Person[];
  updates: Update[];
}

export function ProjectsList() {
  const t = useT();
  const { openQuickCreate } = useUi();
  const [status, setStatus] = useState<"all" | ProjectStatus>("all");
  const [showArchived, setShowArchived] = useState(false);
  const data = useLiveQuery(
    async (): Promise<Data> => {
      const [projects, issues, milestones, people, updates] = await Promise.all([
        db.projects.orderBy("updatedAt").reverse().toArray(),
        db.issues.toArray(),
        db.milestones.toArray(),
        db.people.toArray(),
        db.updates.toArray(),
      ]);
      return { projects, issues, milestones, people, updates };
    },
    [],
    null,
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const latest = latestUpdates(data.updates);
    const people = new Map(data.people.map((p) => [p.id, p]));
    return data.projects
      .filter((p) => (showArchived ? true : p.status !== "archived"))
      .filter((p) => status === "all" || p.status === status)
      .map((p) => {
        const issues = data.issues.filter((i) => i.projectId === p.id);
        const ms = data.milestones.filter((m) => m.projectId === p.id);
        const active = ms.filter((m) => m.status === "active").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
        const live = issues.filter((i) => i.status !== "cancelled");
        const done = live.filter((i) => i.status === "done").length;
        const progress = active ? milestoneProgress(active, issues) : { total: live.length, done, pct: live.length ? Math.round((done / live.length) * 100) : 0 };
        return { project: p, update: latest.get(p.id), lead: p.leadId ? people.get(p.leadId) : undefined, open: issues.filter(isOpen).length, milestone: active, progress };
      });
  }, [data, status, showArchived]);

  const archivedCount = data?.projects.filter((p) => p.status === "archived").length ?? 0;

  return (
    <>
      <PageHeader
        title={t("Projects")}
        description={t("Every project, its posted health and what is in flight.")}
        actions={
          <Button size="sm" onClick={() => openQuickCreate("project")}>
            <Plus className="size-4" />
            {t("New project")}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("Status")} className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="xs"
                variant={status === f.value ? "outline" : "ghost"}
                aria-pressed={status === f.value}
                className={cn("h-7", status === f.value ? "bg-background shadow-xs" : "text-muted-foreground")}
                onClick={() => setStatus(f.value)}
              >
                {t(f.label)}
              </Button>
            ))}
          </div>
          {archivedCount ? (
            <Label className="ms-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} size="sm" />
              {t("Show archived ({n})", { n: archivedCount })}
            </Label>
          ) : null}
        </div>
      </PageHeader>

      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : data.projects.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title={t("No projects yet")} description={t("A project groups issues, milestones, risks and weekly updates.")}>
          <Button onClick={() => openQuickCreate("project")}>{t("New project")}</Button>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title={t("Nothing matches this filter")} description={t("Try another status, or include archived projects.")} />
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Project")}</TableHead>
                <TableHead>{t("Health")}</TableHead>
                <TableHead className="max-md:hidden">{t("Status")}</TableHead>
                <TableHead className="max-md:hidden">{t("Lead")}</TableHead>
                <TableHead className="max-sm:hidden">{t("Target")}</TableHead>
                <TableHead className="text-end">{t("Open")}</TableHead>
                <TableHead className="min-w-40">{t("Progress")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project: p, update, lead, open, milestone, progress }) => {
                const days = daysUntil(p.targetDate);
                const late = days !== null && days < 0 && p.status === "active";
                const msOverdue = milestone ? (daysUntil(milestone.dueDate) ?? 0) < 0 && progress.pct < 100 : false;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <ProjectDot project={p} />
                        <span className="truncate" dir="auto">
                          {p.name}
                        </span>
                        <span className="font-mono text-xs font-normal text-muted-foreground">{p.key}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={update?.health} />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-md:hidden">{t(STATUS_LABEL[p.status])}</TableCell>
                    <TableCell className="max-md:hidden">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <PersonAvatar person={lead} size="xs" />
                        <span className={cn(!lead && "text-muted-foreground")}>{lead?.name ?? t("No lead")}</span>
                      </span>
                    </TableCell>
                    <TableCell className={cn("tabular-nums max-sm:hidden", late ? "text-[var(--viz-critical)]" : "text-muted-foreground")}>
                      {p.targetDate
                        ? `${fmtShort(p.targetDate)}${days !== null && p.status === "active" ? ` · ${days < 0 ? t("{n} d late", { n: -days }) : t("{n} d", { n: days })}` : ""}`
                        : "–"}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{open}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs">
                        <Meter pct={progress.pct} overdue={msOverdue} className="w-20 shrink-0 sm:w-28" />
                        <span className="tabular-nums text-muted-foreground">
                          {progress.done}/{progress.total}
                        </span>
                        <span className="truncate text-muted-foreground max-lg:hidden" dir="auto">
                          {milestone ? milestone.title : t("all issues")}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
