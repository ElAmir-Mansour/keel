"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { CheckCircle2, CircleDot, GitBranch, LayoutGrid, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePeople, useProject } from "@/hooks/use-data";
import { useLang, useT } from "@/lib/i18n";
import { useUi } from "@/lib/ui-store";
import { EmptyState } from "@/components/ui-bits";
import { IssueRow } from "./issue-row";
import { IssueFilters, applyIssueFilters, groupIssues, useIssueFilters } from "./issue-filters";
import { DONE_WINDOW_DAYS, issueHref, useProjectCycles, useProjectIssues, useProjectMilestones } from "./issue-utils";
import { SavedViews } from "./saved-views";
import { useListNav } from "./use-list-nav";

export function IssueListView() {
  const t = useT();
  const lang = useLang();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openQuickCreate } = useUi();
  const project = useProject(id);
  const issues = useProjectIssues(id);
  const milestones = useProjectMilestones(id);
  const cycles = useProjectCycles(id);
  const people = usePeople();
  const { filters, set, clear, active } = useIssueFilters();
  const activeCycleId = useMemo(() => cycles.find((c) => c.status === "active")?.id, [cycles]);

  const visible = useMemo(() => applyIssueFilters(issues, filters, project, activeCycleId), [issues, filters, project, activeCycleId]);
  // `lang` is a dependency because groupIssues translates its static labels.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupIssues(visible, filters.group, { milestones, people }), [visible, filters.group, milestones, people, lang]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const milestoneById = useMemo(() => new Map(milestones.map((m) => [m.id, m])), [milestones]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const closed = useMemo(() => {
    const shown = new Set(visible.map((i) => i.id));
    return issues.filter((i) => (i.status === "done" || i.status === "cancelled") && !shown.has(i.id)).length;
  }, [issues, visible]);
  const total = issues.filter((i) => i.status !== "triage").length;

  const nav = useListNav(flat.length, { onOpen: (i) => router.push(issueHref(flat[i])) });
  const indexOf = useMemo(() => new Map(flat.map((i, idx) => [i.id, idx])), [flat]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <IssueFilters milestones={milestones} people={people} cycles={project?.cycleConfig?.enabled ? cycles : []} />
        <SavedViews projectId={id} />
        <div className="ms-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant={filters.done ? "secondary" : "ghost"} size="sm" aria-pressed={filters.done} onClick={() => set({ done: !filters.done })} className="h-7 text-xs font-normal">
                <CheckCircle2 className="size-3.5" />
                {filters.done ? t("Hide closed") : t("Show closed")}
                {!filters.done && closed ? <span className="tabular text-muted-foreground">{closed}</span> : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Done issues older than {n} days and cancelled issues are hidden by default", { n: DONE_WINDOW_DAYS })}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" aria-label={t("Board")}>
                <Link href={`/projects/${id}/board`}><LayoutGrid /></Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Board")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" aria-label={t("Roadmap")}>
                <Link href={`/projects/${id}/roadmap`}><GitBranch /></Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Roadmap")}</TooltipContent>
          </Tooltip>
          <Button type="button" size="sm" className="ms-1 h-7" onClick={() => openQuickCreate("issue", id)}>
            <Plus /> {t("New issue")} <Kbd className="ms-1 bg-primary-foreground/20 text-primary-foreground">C</Kbd>
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState icon={<CircleDot />} title={t("No issues yet")} description={t("Capture the first one. Press C anywhere, or paste a list — one issue per line.")}>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" size="sm" onClick={() => openQuickCreate("issue", id)}>
              <Plus /> {t("New issue")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openQuickCreate("issue", id)}>
              {t("Paste a list")}
            </Button>
          </div>
        </EmptyState>
      ) : flat.length === 0 ? (
        <EmptyState title={t("No issues match")} description={active ? t("Loosen the filters or clear them.") : t("Everything is closed. Show closed to see the {n} done and cancelled issues.", { n: closed })}>
          {active ? (
            <Button type="button" variant="outline" size="sm" onClick={clear}>{t("Clear filters")}</Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => set({ done: true })}>{t("Show closed")}</Button>
          )}
        </EmptyState>
      ) : (
        <div data-list-nav className="overflow-hidden rounded-lg border">
          {groups.map((g) => (
            <div key={g.key} className="border-b last:border-b-0">
              {g.label !== null ? (
                <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
                  {g.icon}
                  <span dir="auto">{g.label}</span>
                  <span className="tabular text-muted-foreground">{g.items.length}</span>
                </div>
              ) : null}
              <div className="divide-y divide-border/60">
                {g.items.map((issue) => {
                  const i = indexOf.get(issue.id) ?? -1;
                  return (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      project={project}
                      milestone={filters.group === "milestone" ? null : milestoneById.get(issue.milestoneId ?? "")}
                      assignee={personById.get(issue.assigneeId ?? "")}
                      selected={nav.index === i}
                      onSelect={() => nav.index !== i && nav.setIndex(i)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className={cn("mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", flat.length === 0 && "hidden")}>
        <span className="tabular">{t("{shown} of {total}", { shown: flat.length, total })}</span>
        <span className="inline-flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> {t("move")}</span>
        <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> {t("open")}</span>
        <span className="inline-flex items-center gap-1"><Kbd>C</Kbd> {t("new")}</span>
      </p>
    </div>
  );
}
