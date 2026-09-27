"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowRightToLine, CalendarRange, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Section, StatusIcon } from "@/components/ui-bits";
import { IssueRow } from "@/components/issues/issue-row";
import { useProject } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { fmtShort, todayYMD } from "@/lib/dates";
import { cycleLabel, daysLeft, DEFAULT_CYCLE_CONFIG, ensureCycles, isUnfinished } from "@/lib/cycles";
import { updateIssue, updateProject } from "@/lib/repo";
import type { Cycle, CycleConfig, Issue } from "@/lib/types";

// Cycles: one active, one upcoming, the rest history. Assign issues from the
// list or here; unfinished work rolls forward on the day a cycle ends.

export function CyclesView({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const cycles = useLiveQuery(() => db.cycles.where({ projectId }).toArray(), [projectId], [] as Cycle[]);
  const issues = useLiveQuery(() => db.issues.where({ projectId }).toArray(), [projectId], [] as Issue[]);
  const [busy, setBusy] = useState(false);
  const config: CycleConfig = project?.cycleConfig ?? DEFAULT_CYCLE_CONFIG;

  const sorted = useMemo(() => [...cycles].sort((a, b) => b.number - a.number), [cycles]);
  const active = sorted.find((c) => c.status === "active");
  const upcoming = sorted.filter((c) => c.status === "upcoming").sort((a, b) => a.number - b.number)[0];
  const past = sorted.filter((c) => c.status === "done");
  const byCycle = (c?: Cycle) => (c ? issues.filter((i) => i.cycleId === c.id) : []);
  const unplanned = issues.filter((i) => !i.cycleId && isUnfinished(i) && i.status !== "triage");

  async function setConfig(patch: Partial<CycleConfig>) {
    if (!project) return;
    const next = { ...config, ...patch };
    await updateProject(project.id, { cycleConfig: next });
    if (next.enabled) {
      const moved = await ensureCycles({ ...project, cycleConfig: next });
      if (moved) toast(`${moved} issues rolled forward`);
    }
  }

  async function rollNow() {
    if (!project || !active) return;
    setBusy(true);
    try {
      const unfinished = byCycle(active).filter(isUnfinished);
      const target = upcoming;
      if (!target) return;
      for (const i of unfinished) await updateIssue(i.id, { cycleId: target.id });
      toast.success(`Moved ${unfinished.length} unfinished issue${unfinished.length === 1 ? "" : "s"} to ${cycleLabel(target)}`);
    } finally {
      setBusy(false);
    }
  }

  async function plan(issue: Issue, cycle?: Cycle) {
    await updateIssue(issue.id, { cycleId: cycle?.id });
  }

  if (!project) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <Switch checked={config.enabled} onCheckedChange={(v) => void setConfig({ enabled: v })} /> Cycles
        </label>
        <Select value={String(config.lengthWeeks)} onValueChange={(v) => void setConfig({ lengthWeeks: Number(v) as CycleConfig["lengthWeeks"] })}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Cycle length">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((w) => (
              <SelectItem key={w} value={String(w)}>
                {w} week{w === 1 ? "" : "s"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Fixed windows, back to back. Unfinished work rolls into the next cycle automatically; nothing to plan on a Monday morning.</span>
      </div>

      {!config.enabled ? (
        <EmptyState icon={<CalendarRange />} title="Cycles are off for this project" description="Turn them on to plan work in fixed windows. Milestones stay as they are; cycles are the rhythm, milestones are the destination." />
      ) : (
        <>
          {active ? (
            <CycleCard cycle={active} issues={byCycle(active)} headline>
              {upcoming && byCycle(active).some(isUnfinished) ? (
                <Button size="sm" variant="outline" onClick={rollNow} disabled={busy}>
                  <ArrowRightToLine /> Move unfinished to {cycleLabel(upcoming)}
                </Button>
              ) : null}
            </CycleCard>
          ) : null}
          {upcoming ? <CycleCard cycle={upcoming} issues={byCycle(upcoming)} /> : null}

          <Section title={`Not in a cycle · ${unplanned.length}`}>
            {unplanned.length ? (
              <div className="divide-y rounded-lg border">
                {unplanned.slice(0, 50).map((i) => (
                  <div key={i.id} className="flex items-center gap-2 pe-2">
                    <div className="min-w-0 flex-1">
                      <IssueRow issue={i} project={project} />
                    </div>
                    {active ? (
                      <Button size="xs" variant="ghost" onClick={() => void plan(i, active)}>
                        + {cycleLabel(active)}
                      </Button>
                    ) : null}
                    {upcoming ? (
                      <Button size="xs" variant="ghost" onClick={() => void plan(i, upcoming)}>
                        + {cycleLabel(upcoming)}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Every open issue is planned.</p>
            )}
          </Section>

          {past.length ? (
            <Section title="Past cycles">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead className="text-end">Done</TableHead>
                    <TableHead className="text-end">Planned</TableHead>
                    <TableHead>Completion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((c) => {
                    const planned = byCycle(c);
                    const done = issues.filter((i) => i.completedAt && i.completedAt.slice(0, 10) >= c.startDate && i.completedAt.slice(0, 10) <= c.endDate).length;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>{cycleLabel(c)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {fmtShort(c.startDate)} – {fmtShort(c.endDate)}
                        </TableCell>
                        <TableCell className="text-end tabular">{done}</TableCell>
                        <TableCell className="text-end tabular">{planned.length}</TableCell>
                        <TableCell className="w-40">
                          <Progress value={planned.length ? Math.min(100, (done / planned.length) * 100) : 0} className="h-1.5" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function CycleCard({ cycle, issues, headline, children }: { cycle: Cycle; issues: Issue[]; headline?: boolean; children?: React.ReactNode }) {
  const done = issues.filter((i) => i.status === "done").length;
  const live = issues.filter((i) => i.status !== "cancelled");
  const pct = live.length ? Math.round((done / live.length) * 100) : 0;
  const left = daysLeft(cycle, todayYMD());
  const grouped = useMemo(() => {
    const order = ["in_review", "in_progress", "todo", "backlog", "done", "cancelled"] as const;
    return order.map((s) => ({ status: s, items: issues.filter((i) => i.status === s) })).filter((g) => g.items.length);
  }, [issues]);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {cycleLabel(cycle)}
            <span className="text-xs font-normal text-muted-foreground">
              {fmtShort(cycle.startDate)} – {fmtShort(cycle.endDate)} · {cycle.status === "active" ? (left >= 0 ? `${left} day${left === 1 ? "" : "s"} left` : "ended") : cycle.status}
            </span>
          </CardTitle>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Progress value={pct} className="h-1.5 w-40" />
            {done}/{live.length} done
          </div>
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        {issues.length ? (
          grouped.map((g) => (
            <div key={g.status}>
              <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusIcon status={g.status} /> {g.items.length}
              </div>
              <div className="divide-y rounded-md border">
                {g.items.map((i) => (
                  <IssueRowWithProject key={i.id} issue={i} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {headline ? "Nothing planned yet. Add issues below, or from the issue list with the cycle picker." : "Nothing planned for this cycle yet."}
          </p>
        )}
        {headline ? (
          <p className="text-xs text-muted-foreground">
            <RotateCcw className="me-1 inline size-3" />
            When this cycle ends, anything unfinished moves to the next one on its own. <Link href="?" className="underline underline-offset-2">Learn more in the issue list</Link>.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IssueRowWithProject({ issue }: { issue: Issue }) {
  const project = useProject(issue.projectId);
  if (!project) return null;
  return <IssueRow issue={issue} project={project} />;
}
