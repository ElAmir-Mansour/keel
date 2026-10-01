"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarRange, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, ProjectChip, ProjectDot } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { ago, fmtDate, todayYMD } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { approxMeasure, layoutTimeline, splitByState } from "@/lib/timeline/layout";
import type { Timeline } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { useUrlFilters } from "@/components/notes/use-url-filters";
import { TimelineSvg } from "./timeline-chart";

const KEYS = ["project"] as const;

/** A small, non-interactive preview of a timeline for the list. */
function Thumb({ tl, today }: { tl: Timeline; today: string }) {
  const layout = useMemo(() => layoutTimeline(tl, { width: 520, today, measure: approxMeasure, compact: true }), [tl, today]);
  if (!tl.entries.length) return <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">{""}</div>;
  return (
    <div className="ltr-island h-24 overflow-hidden rounded-md border bg-[var(--viz-surface)]">
      <TimelineSvg layout={layout} title={tl.title} className="h-auto w-full" />
    </div>
  );
}

function TimelineCard({ tl, project, today }: { tl: Timeline; project?: { id: string; name: string; color: string; key: string }; today: string }) {
  const t = useT();
  const { done, active, planned } = splitByState(tl.entries, today);
  const next = planned[0] ?? active[0];
  return (
    <Link href={`/timelines/${tl.id}`} className="group grid gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40">
      <Thumb tl={tl} today={today} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium group-hover:underline" dir="auto">
            {tl.title}
          </span>
          {project ? <ProjectChip project={project as never} link={false} className="shrink-0" /> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
          <span>{t("{n} entries", { n: tl.entries.length })}</span>
          {done.length ? <span>· {t("{n} happened", { n: done.length })}</span> : null}
          {active.length ? <span>· {t("{n} in progress", { n: active.length })}</span> : null}
          {next ? <span>· {t("next: {title} ({date})", { title: next.title, date: fmtDate(next.start, "d MMM") })}</span> : null}
          <span className="ms-auto">{ago(tl.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function TimelinesList({ projectId }: { projectId?: string }) {
  const t = useT();
  const { openQuickCreate } = useUi();
  const projects = useProjects();
  const [f, setF] = useUrlFilters(KEYS);
  const timelines = useLiveQuery(() => db.timelines.orderBy("updatedAt").reverse().toArray(), [], null);
  const today = useMemo(() => todayYMD(), []);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const pid = projectId ?? f.project;
  const rows = useMemo(() => (timelines ?? []).filter((x) => !pid || (pid === "__none" ? !x.projectId : x.projectId === pid)), [timelines, pid]);

  const newButton = (
    <Button size="sm" onClick={() => openQuickCreate("timeline", projectId)}>
      <Plus /> {t("New timeline")}
    </Button>
  );

  const header = projectId ? (
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{t("Timelines for this project.")}</p>
      {newButton}
    </div>
  ) : (
    <PageHeader title={t("Timelines")} description={t("Hand-made chronologies: what happened, what is in progress and what comes next, drawn to scale and exportable as PDF or PNG.")} actions={newButton}>
      {projects.length ? (
        <Select value={f.project || "__all"} onValueChange={(v) => setF({ project: v === "__all" ? "" : v })}>
          <SelectTrigger size="sm" className="w-auto min-w-40" aria-label={t("Project")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("All projects")}</SelectItem>
            <SelectItem value="__none">{t("No project")}</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <ProjectDot project={p} /> {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </PageHeader>
  );

  if (timelines === null) {
    return (
      <>
        {header}
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((tl) => (
            <TimelineCard key={tl.id} tl={tl} project={projectById.get(tl.projectId ?? "")} today={today} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<CalendarRange />} title={t("No timelines yet")} description={t("Type dated lines like “2026-09-12: Kickoff” and get a chart of what happened and what comes next. Export it as a PDF handout or a PNG for a slide.")}>
          {newButton}
        </EmptyState>
      )}
    </>
  );
}

/** /projects/[id]/timelines — the same list scoped to one project. */
export function ProjectTimelines() {
  const { id } = useParams<{ id: string }>();
  return <TimelinesList projectId={id} />;
}
