"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subDays } from "date-fns";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { ago, fmtDate, parseYMD, todayYMD } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { burnUp, cumulativeFlow, isOpen } from "@/lib/metrics";
import { riskScore } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { HealthBadge } from "@/components/ui-bits";
import { MarkdownView } from "@/components/markdown";
import { BurnUpChart } from "@/components/charts/burn-up";
import { CumulativeFlowChart } from "@/components/charts/cumulative-flow";
import { TopRisksTable } from "@/components/charts/risk-matrix";
import { StatTile } from "@/components/dashboard/stat-tile";
import { RecentDecisionsList, RecentNotesList } from "@/components/dashboard/lists";
import { completedBetween, latestUpdates } from "@/components/dashboard/data";
import { MilestoneProgressList, activeMilestones } from "./milestone-progress";

const DAYS = 30;

export function ProjectOverview({ id }: { id: string }) {
  const t = useT();
  const { openAI } = useUi();
  const data = useLiveQuery(
    async () => {
      const [project, issues, events, milestones, risks, updates, decisions, notes] = await Promise.all([
        db.projects.get(id),
        db.issues.where({ projectId: id }).toArray(),
        db.issueEvents.where({ projectId: id }).toArray(),
        db.milestones.where({ projectId: id }).toArray(),
        db.risks.where({ projectId: id }).toArray(),
        db.updates.where({ projectId: id }).toArray(),
        db.decisions.where({ projectId: id }).toArray(),
        db.notes.where({ projectId: id }).toArray(),
      ]);
      return { project, issues, events, milestones, risks, updates, decisions, notes };
    },
    [id],
    null,
  );

  const todayStr = todayYMD();
  const m = useMemo(() => {
    if (!data) return null;
    const today = parseYMD(todayStr);
    const from = subDays(today, DAYS - 1);
    const open = data.issues.filter(isOpen);
    const openRisks = data.risks.filter((r) => r.status !== "closed");
    return {
      latest: latestUpdates(data.updates).get(id),
      open: open.length,
      doing: open.filter((i) => i.status === "in_progress" || i.status === "in_review").length,
      done7: completedBetween(data.issues, subDays(today, 6), today).length,
      overdue: open.filter((i) => i.dueDate && i.dueDate < todayStr).length,
      openRisks: openRisks.length,
      highRisks: openRisks.filter((r) => riskScore(r) >= 12).length,
      burn: burnUp(data.issues, from, today),
      flow: cumulativeFlow(data.issues, data.events, from, today),
      milestones: activeMilestones(data.milestones),
      topRisks: [...openRisks].sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 5),
      decisions: [...data.decisions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
      notes: [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    };
  }, [data, id, todayStr]);

  if (!data || !m || !data.project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }
  const projectById = new Map([[data.project.id, data.project]]);

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            {t("Latest update")}
            <HealthBadge health={m.latest?.health} />
          </CardTitle>
          <CardDescription className="text-xs">
            {m.latest ? t("{date} · posted {ago}", { date: fmtDate(m.latest.date), ago: ago(m.latest.createdAt) }) : t("No update posted yet")}
          </CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/projects/${id}/updates`}>
                <MessageSquarePlus className="size-4" />
                {t("Post update")}
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        {m.latest?.summary.trim() ? (
          <CardContent>
            <MarkdownView body={m.latest.summary} className="text-sm" />
          </CardContent>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label={t("Open")} value={m.open} />
        <StatTile label={t("In progress")} value={m.doing} hint={t("Including review")} />
        <StatTile label={t("Done last 7 days")} value={m.done7} />
        <StatTile label={t("Overdue")} value={m.overdue} />
        <StatTile
          label={t("Open risks")}
          value={m.openRisks}
          hint={m.highRisks ? <span className="font-medium text-[var(--viz-critical)]">{t("{n} scored 12 or higher", { n: m.highRisks })}</span> : undefined}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <BurnUpChart data={m.burn} subtitle={t("Cumulative done against scope, last {n} days", { n: DAYS })} />
        <CumulativeFlowChart data={m.flow} subtitle={t("Issues in each stage, last {n} days", { n: DAYS })} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card size="sm" className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">{t("Milestones")}</CardTitle>
            <CardDescription className="text-xs">{t("Progress and due dates")}</CardDescription>
            <CardAction>
              <Button size="xs" variant="ghost" asChild>
                <Link href={`/projects/${id}/roadmap`}>{t("Roadmap")}</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <MilestoneProgressList milestones={m.milestones} issues={data.issues} className="-my-2" />
          </CardContent>
        </Card>
        <Card size="sm" className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">{t("Top risks")}</CardTitle>
            <CardDescription className="text-xs">{t("Open, by likelihood × impact")}</CardDescription>
            <CardAction>
              <Button size="xs" variant="ghost" asChild>
                <Link href={`/projects/${id}/risks`}>{t("Register")}</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <TopRisksTable risks={m.topRisks} projectById={projectById} showProject={false} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <RecentDecisionsList decisions={m.decisions} projectById={projectById} />
        <RecentNotesList notes={m.notes} projectById={projectById} />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => openAI({ projectId: id, action: "ask" })}>
          <Sparkles className="size-4" />
          {t("Ask AI about this project")}
        </Button>
      </div>
    </div>
  );
}
