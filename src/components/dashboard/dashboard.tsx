"use client";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsEmptyWorkspace } from "@/hooks/use-data";
import { daysUntil, todayYMD } from "@/lib/dates";
import { burnUp, cumulativeFlow, cycleTimeHistogram, cycleTimeSummary, isOpen, throughputByWeek, workloadByAssignee } from "@/lib/metrics";
import { riskScore } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { PageHeader } from "@/components/ui-bits";
import { DateRangeRow, useDateRange } from "@/components/date-range";
import { BurnUpChart } from "@/components/charts/burn-up";
import { CumulativeFlowChart } from "@/components/charts/cumulative-flow";
import { CycleTimeChart, fmtDays } from "@/components/charts/cycle-time";
import { RiskMatrixCard } from "@/components/charts/risk-matrix";
import { ThroughputChart } from "@/components/charts/throughput";
import { WorkloadChart, type WorkloadRow } from "@/components/charts/workload";
import { MilestoneProgressList, activeMilestones } from "@/components/projects/milestone-progress";
import { completedBetween, latestUpdates, openAt, sliceByProject, useWorkspace } from "./data";
import { DueSoonList, RecentDecisionsList, RecentNotesList } from "./lists";
import { Onboarding } from "./onboarding";
import { ProjectHealthCards } from "./project-health-cards";
import { StatTile } from "./stat-tile";

export function Dashboard() {
  const ws = useWorkspace();
  const empty = useIsEmptyWorkspace();
  const range = useDateRange();
  const { openQuickCreate } = useUi();
  const loading = ws === null;

  const model = useMemo(() => (ws ? buildModel(ws, range) : null), [ws, range]);

  if (loading || !model) return <DashboardSkeleton range={range} />;
  if (empty) {
    return (
      <>
        <PageHeader title="Home" description="Projects, health and what needs you this week." />
        <Onboarding />
      </>
    );
  }

  const m = model;
  const prevLabel = range.range === "q" ? "vs previous quarter" : `vs previous ${range.days} days`;

  return (
    <>
      <PageHeader
        title="Home"
        description="Projects, health and what needs you this week."
        actions={
          <Button size="sm" onClick={() => openQuickCreate("issue", range.projectId)}>
            <Plus className="size-4" />
            New issue
          </Button>
        }
      >
        <DateRangeRow value={range} projects={m.filterProjects} />
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Open issues" value={m.open} delta={m.openDelta} deltaLabel="since range start" />
          <StatTile label="Done in range" value={m.done} delta={m.doneDelta} deltaLabel={prevLabel} upIsGood />
          <StatTile label="Overdue" value={m.overdue} hint={m.dueThisWeek ? `${m.dueThisWeek} more due this week` : undefined} />
          <StatTile
            label="Open risks"
            value={m.openRisks}
            hint={
              m.highRisks ? (
                <span className="font-medium text-[var(--viz-critical)]">
                  {m.highRisks} scored 12 or higher
                </span>
              ) : (
                "None scored 12 or higher"
              )
            }
          />
          <StatTile
            label="Cycle time p50 / p85 (days)"
            value={m.cycle.n ? `${fmtDays(m.cycle.p50)} / ${fmtDays(m.cycle.p85)}` : "–"}
            delta={m.cycle.n && m.prevCycle.n ? m.cycle.p50 - m.prevCycle.p50 : undefined}
            deltaLabel={`p50 ${prevLabel}`}
            upIsGood={false}
            hint={m.cycle.n ? `${m.cycle.n} completed` : "No completed issues"}
          />
        </div>

        <ProjectHealthCards projects={m.cardProjects} issues={m.issues} milestones={m.milestones} latest={m.latest} />

        <div className="grid gap-3 lg:grid-cols-2">
          <BurnUpChart data={m.burn} />
          <CumulativeFlowChart data={m.flow} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ThroughputChart data={m.throughput} subtitle={`Issues completed per week, last ${m.weeks} weeks`} />
          <CycleTimeChart data={m.histogram} summary={m.cycle} />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <Card size="sm" className="min-w-0">
            <CardHeader>
              <CardTitle className="text-sm">Milestones</CardTitle>
              <CardDescription className="text-xs">Progress and due dates for milestones in flight</CardDescription>
            </CardHeader>
            <CardContent>
              <MilestoneProgressList milestones={m.activeMilestones} issues={m.issues} projects={m.projects} showProject={!range.projectId} className="-my-2" />
            </CardContent>
          </Card>
          <RiskMatrixCard risks={m.risks} projects={m.projects} showProject={!range.projectId} />
          <WorkloadChart data={m.workload} />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <DueSoonList issues={m.dueSoon} projectById={m.projectById} />
          <RecentNotesList notes={m.recentNotes} projectById={m.projectById} />
          <RecentDecisionsList decisions={m.recentDecisions} projectById={m.projectById} />
        </div>
      </div>
    </>
  );
}

type Range = ReturnType<typeof useDateRange>;

function buildModel(all: NonNullable<ReturnType<typeof useWorkspace>>, range: Range) {
  const ws = sliceByProject(all, range.projectId);
  const { issues, events, risks, milestones, notes, decisions, people, updates, projects } = ws;
  const today = todayYMD();

  const openIssues = issues.filter(isOpen);
  const doneNow = completedBetween(issues, range.from, range.to);
  const donePrev = completedBetween(issues, range.prevFrom, range.prevTo);
  const openRisksList = risks.filter((r) => r.status === "open" || r.status === "mitigating");
  const cycle = cycleTimeSummary(doneNow);
  const prevCycle = cycleTimeSummary(donePrev);
  const weeks = Math.min(16, Math.max(4, Math.ceil(range.days / 7)));

  const personName = new Map(people.map((p) => [p.id, p.name]));
  const workload: WorkloadRow[] = [...workloadByAssignee(issues).entries()].map(([id, w]) => ({
    id,
    name: id === "__unassigned" ? "Unassigned" : (personName.get(id) ?? "Unknown"),
    doing: w.doing,
    open: w.open,
  }));

  const dueSoon = openIssues
    .filter((i) => {
      const d = daysUntil(i.dueDate);
      return d !== null && d <= 7;
    })
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, 8);

  return {
    projects,
    filterProjects: all.projects.filter((p) => p.status !== "archived").sort((a, b) => a.name.localeCompare(b.name)),
    cardProjects: projects.filter((p) => p.status === "active" || p.status === "paused").sort((a, b) => a.name.localeCompare(b.name)),
    projectById: new Map(all.projects.map((p) => [p.id, p])),
    issues,
    milestones,
    risks,
    latest: latestUpdates(updates),
    open: openIssues.length,
    openDelta: openIssues.length - openAt(issues, range.from),
    done: doneNow.length,
    doneDelta: doneNow.length - donePrev.length,
    overdue: openIssues.filter((i) => i.dueDate && i.dueDate < today).length,
    dueThisWeek: openIssues.filter((i) => {
      const d = daysUntil(i.dueDate);
      return d !== null && d >= 0 && d <= 7;
    }).length,
    openRisks: openRisksList.length,
    highRisks: openRisksList.filter((r) => riskScore(r) >= 12).length,
    cycle,
    prevCycle,
    burn: burnUp(issues, range.from, range.to),
    flow: cumulativeFlow(issues, events, range.from, range.to),
    throughput: throughputByWeek(issues, weeks),
    weeks,
    histogram: cycleTimeHistogram(doneNow),
    activeMilestones: activeMilestones(milestones),
    workload,
    dueSoon,
    recentNotes: [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    recentDecisions: [...decisions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
  };
}

export function DashboardSkeleton({ range }: { range?: Range }) {
  return (
    <>
      <PageHeader title="Home" description="Projects, health and what needs you this week.">
        {range ? <DateRangeRow value={range} /> : null}
      </PageHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <StatTile key={i} label=" " value="" loading />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </>
  );
}
