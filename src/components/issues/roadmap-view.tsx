"use client";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePeople, useProject } from "@/hooks/use-data";
import { parseYMD, todayYMD } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { isOpen } from "@/lib/metrics";
import { updateMilestone } from "@/lib/repo";
import type { Milestone } from "@/lib/types";
import { EmptyState, Section } from "@/components/ui-bits";
import { IssueRow } from "./issue-row";
import { MilestonePicker } from "./pickers";
import { MilestoneDialog } from "./milestone-dialog";
import { RoadmapTimeline, computeRange, isMilestoneOverdue } from "./roadmap-timeline";
import { compareIssues, safeWrite, useProjectIssues, useProjectMilestones } from "./issue-utils";

export function RoadmapView() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const project = useProject(id);
  const issues = useProjectIssues(id);
  const milestones = useProjectMilestones(id);
  const people = usePeople();
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const [dialog, setDialog] = useState<{ open: boolean; milestone: Milestone | null }>({ open: false, milestone: null });
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = useMemo(() => parseYMD(todayYMD()), []);
  const range = useMemo(() => computeRange(milestones, today), [milestones, today]);
  const unassigned = useMemo(() => issues.filter((i) => isOpen(i) && i.status !== "triage" && !i.milestoneId).sort(compareIssues), [issues]);

  const done = milestones.filter((m) => m.status === "done").length;
  const overdue = milestones.filter(isMilestoneOverdue).length;

  function move(m: Milestone, dir: -1 | 1) {
    const idx = milestones.findIndex((x) => x.id === m.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= milestones.length) return;
    const next = [...milestones];
    [next[idx], next[target]] = [next[target], next[idx]];
    // Normalise to 0..n so gaps left by deletions do not accumulate.
    const writes = next.map((x, i) => (x.order === i ? null : updateMilestone(x.id, { order: i }))).filter(Boolean);
    void safeWrite(() => Promise.all(writes), t("Could not reorder"));
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {milestones.length ? (
            <span className="tabular">
              {t(milestones.length === 1 ? "{n} milestone" : "{n} milestones", { n: milestones.length })} · {t("{n} done", { n: done })}
              {overdue ? <span className="text-[var(--viz-critical)]"> · {t("{n} overdue", { n: overdue })}</span> : null}
            </span>
          ) : null}
          <Button type="button" size="sm" className="ms-auto h-7" onClick={() => setDialog({ open: true, milestone: null })}>
            <Plus /> {t("New milestone")}
          </Button>
        </div>

        {milestones.length ? (
          <RoadmapTimeline
            milestones={milestones}
            issues={issues}
            project={project}
            personById={personById}
            range={range}
            expanded={expanded}
            onToggle={(mid) => setExpanded((cur) => (cur === mid ? null : mid))}
            onEdit={(m) => setDialog({ open: true, milestone: m })}
            onMove={move}
          />
        ) : (
          <EmptyState icon={<GitBranch />} title={t("No milestones yet")} description={t("Milestones group issues into dated chunks of work: a release, a phase, a demo. The roadmap draws them on a timeline.")}>
            <Button type="button" size="sm" onClick={() => setDialog({ open: true, milestone: null })}>
              <Plus /> {t("New milestone")}
            </Button>
          </EmptyState>
        )}
      </div>

      <Section title={`${t("Issues without a milestone")}${unassigned.length ? ` · ${unassigned.length}` : ""}`}>
        {unassigned.length ? (
          <div data-list-nav className="divide-y overflow-hidden rounded-lg border">
            {unassigned.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                project={project}
                assignee={personById.get(issue.assigneeId ?? "")}
                trailing={<MilestonePicker issue={issue} milestones={milestones} />}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{issues.some(isOpen) ? t("Every open issue has a milestone.") : t("No open issues.")}</p>
        )}
      </Section>

      <MilestoneDialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} projectId={id} milestone={dialog.milestone} />
    </div>
  );
}
