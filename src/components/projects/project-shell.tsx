"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, ChevronDown, ChevronUp, FolderX, MessageSquarePlus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { daysUntil, fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { isOpen } from "@/lib/metrics";
import { updateProject } from "@/lib/repo";
import type { ProjectStatus } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { EmptyState, HealthBadge, ProjectDot } from "@/components/ui-bits";
import { latestUpdates } from "@/components/dashboard/data";

// Header and tab nav shared by every /projects/[id]/* page. Renders the
// not-found state itself so child pages can assume the project exists.

// Labels stay English here and are translated at render with t(label).
const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
];

export function projectTabs(id: string) {
  const base = `/projects/${id}`;
  return [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/issues`, label: "Issues" },
    { href: `${base}/board`, label: "Board" },
    { href: `${base}/roadmap`, label: "Roadmap" },
    { href: `${base}/cycles`, label: "Cycles" },
    { href: `${base}/risks`, label: "Risks" },
    { href: `${base}/updates`, label: "Updates" },
    { href: `${base}/notes`, label: "Notes" },
  ];
}

export function ProjectShell({ id, children }: { id: string; children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { openQuickCreate, openAI } = useUi();
  const [expanded, setExpanded] = useState(false);

  // null while loading, undefined when the id does not exist.
  const project = useLiveQuery(() => db.projects.get(id), [id], null);
  const updates = useLiveQuery(() => db.updates.where({ projectId: id }).toArray(), [id], null);
  const openCount = useLiveQuery(async () => (await db.issues.where({ projectId: id }).toArray()).filter(isOpen).length, [id], null);
  const riskCount = useLiveQuery(async () => (await db.risks.where({ projectId: id }).toArray()).filter((r) => r.status !== "closed").length, [id], null);

  const latest = useMemo(() => (updates ? latestUpdates(updates).get(id) : undefined), [updates, id]);
  const tabs = useMemo(() => projectTabs(id), [id]);

  if (project === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (!project) {
    return (
      <EmptyState icon={<FolderX />} title={t("Project not found")} description={t("It may have been deleted, or the link is from another workspace.")}>
        <Button asChild variant="outline">
          <Link href="/projects">{t("All projects")}</Link>
        </Button>
      </EmptyState>
    );
  }

  const days = daysUntil(project.targetDate);
  const late = days !== null && days < 0 && project.status === "active";
  const hasDescription = project.description.trim().length > 0;

  async function setStatus(v: string) {
    await updateProject(project!.id, { status: v as ProjectStatus });
    const label = STATUSES.find((s) => s.value === v)?.label;
    toast.success(t("Project marked {status}", { status: label ? t(label).toLowerCase() : v }));
  }

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 sm:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ProjectDot project={project} className="size-3" />
              <h1 className="truncate text-xl font-semibold tracking-tight" dir="auto">
                {project.name}
              </h1>
              <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
              <HealthBadge health={latest?.health} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Select value={project.status} onValueChange={(v) => void setStatus(v)}>
                <SelectTrigger size="sm" className="h-6 gap-1 border-none bg-transparent px-1 text-xs shadow-none dark:bg-transparent" aria-label={t("Project status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {project.targetDate ? (
                <span className={cn("inline-flex items-center gap-1 tabular-nums", late && "text-[var(--viz-critical)]")}>
                  <CalendarDays className="size-3" aria-hidden />
                  {t("Target {date}", { date: fmtDate(project.targetDate) })}
                  {days !== null && project.status === "active" ? ` · ${days < 0 ? t("{n} d late", { n: -days }) : days === 0 ? t("today") : t("in {n} d", { n: days })}` : ""}
                </span>
              ) : null}
              {latest ? <span>{t("Last update {date}", { date: fmtDate(latest.date) })}</span> : null}
            </div>
            {hasDescription ? (
              <div className="mt-1.5 flex items-start gap-1 text-sm text-muted-foreground">
                <p className={cn("min-w-0 whitespace-pre-line", !expanded && "truncate")} dir="auto">
                  {project.description}
                </p>
                <button type="button" className="inline-flex shrink-0 items-center gap-0.5 text-xs hover:text-foreground" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                  {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {expanded ? t("Less") : t("More")}
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Button size="sm" variant="ghost" onClick={() => openAI({ projectId: id, action: "ask" })}>
              <Sparkles className="size-4" />
              <span className="max-sm:hidden">{t("Ask AI")}</span>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/projects/${id}/updates`}>
                <MessageSquarePlus className="size-4" />
                {t("Post update")}
              </Link>
            </Button>
            <Button size="sm" onClick={() => openQuickCreate("issue", id)}>
              <Plus className="size-4" />
              {t("New issue")}
            </Button>
          </div>
        </div>

        <nav aria-label={t("Project sections")} className="-mx-1 overflow-x-auto">
          <ul className="flex min-w-max gap-1 border-b px-1">
            {tabs.map((tab) => {
              const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(tab.href + "/");
              const count = tab.label === "Issues" ? openCount : tab.label === "Risks" ? riskCount : null;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors",
                      active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(tab.label)}
                    {count ? <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{count}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      {children}
    </>
  );
}
