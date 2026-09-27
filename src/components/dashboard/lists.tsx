"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, daysUntil, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { DECISION_STATUSES, issueKey, type Decision, type Issue, type Note, type Project } from "@/lib/types";
import { IssueKey, KindBadge, PriorityIcon, ProjectDot, StatusIcon } from "@/components/ui-bits";

// The three "what needs me" lists under the charts. Every row is a link.

export function ListCard({
  title,
  subtitle,
  loading,
  empty,
  emptyText,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  emptyText: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle ? <CardDescription className="text-xs">{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
          </div>
        ) : empty ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="-my-1 divide-y">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DueSoonList({ issues, projectById, loading }: { issues: Issue[]; projectById: Map<string, Project>; loading?: boolean }) {
  const t = useT();
  return (
    <ListCard title={t("Due soon")} subtitle={t("Overdue and due in the next 7 days")} loading={loading} empty={!issues.length} emptyText={t("Nothing due this week.")}>
      {issues.map((i) => {
        const p = projectById.get(i.projectId);
        const d = daysUntil(i.dueDate);
        const overdue = d !== null && d < 0;
        return (
          <li key={i.id} className="py-1.5">
            <Link href={`/projects/${i.projectId}/issues/${i.seq}`} className="flex items-center gap-2 text-xs hover:underline">
              <StatusIcon status={i.status} />
              <PriorityIcon priority={i.priority} />
              {p ? <IssueKey>{issueKey(p, i)}</IssueKey> : null}
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {i.title}
              </span>
              <span className={cn("shrink-0 tabular-nums", overdue ? "font-medium text-[var(--viz-critical)]" : "text-muted-foreground")}>
                {d === null ? "" : overdue ? t("{n} d overdue", { n: -d }) : d === 0 ? t("Today") : d === 1 ? t("Tomorrow") : fmtShort(i.dueDate)}
              </span>
            </Link>
          </li>
        );
      })}
    </ListCard>
  );
}

export function RecentNotesList({ notes, projectById, loading }: { notes: Note[]; projectById: Map<string, Project>; loading?: boolean }) {
  const t = useT();
  return (
    <ListCard title={t("Recent notes")} subtitle={t("Last edited")} loading={loading} empty={!notes.length} emptyText={t("No notes yet. Press N to write one.")}>
      {notes.map((n) => {
        const p = n.projectId ? projectById.get(n.projectId) : undefined;
        return (
          <li key={n.id} className="py-1.5">
            <Link href={`/notes/${n.id}`} className="flex items-center gap-2 text-xs hover:underline">
              <KindBadge kind={n.kind} className="h-5 shrink-0 px-1.5 text-[10px]" />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {n.title}
              </span>
              {p ? <ProjectDot project={p} /> : null}
              <span className="shrink-0 text-muted-foreground">{ago(n.updatedAt)}</span>
            </Link>
          </li>
        );
      })}
    </ListCard>
  );
}

export function RecentDecisionsList({ decisions, projectById, loading }: { decisions: Decision[]; projectById: Map<string, Project>; loading?: boolean }) {
  const t = useT();
  return (
    <ListCard title={t("Recent decisions")} subtitle={t("Latest ADRs")} loading={loading} empty={!decisions.length} emptyText={t("No decisions recorded yet.")}>
      {decisions.map((d) => {
        const p = d.projectId ? projectById.get(d.projectId) : undefined;
        return (
          <li key={d.id} className="py-1.5">
            <Link href={`/decisions/${d.id}`} className="flex items-center gap-2 text-xs hover:underline">
              <IssueKey>ADR-{d.seq}</IssueKey>
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {d.title}
              </span>
              {p ? <ProjectDot project={p} /> : null}
              <span className="shrink-0 text-muted-foreground">{t(DECISION_STATUSES.find((s) => s.value === d.status)?.label ?? d.status)}</span>
            </Link>
          </li>
        );
      })}
    </ListCard>
  );
}
