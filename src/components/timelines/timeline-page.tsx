"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { CalendarRange, Presentation, Table2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ProjectDot } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { useIsMobile } from "@/hooks/use-mobile";
import { db } from "@/lib/db";
import { fmtDate, todayYMD } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { deleteTimeline, updateTimeline } from "@/lib/repo";
import type { Timeline } from "@/lib/types";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { useDraft } from "@/components/notes/use-draft";
import { ExportMenu } from "./export-menu";
import { TimelineChart, TimelineLegend } from "./timeline-chart";
import { TimelineEditor } from "./timeline-editor";
import { TimelineStory } from "./timeline-story";
import { ManagementSlide } from "./management-slide";
import { ManagementPanel } from "./management-panel";
import { execEntries } from "@/lib/timeline/management";

/** /timelines/[id] — one timeline: chart, story, editor. */
export function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  const timeline = useLiveQuery(() => db.timelines.get(id).then((x) => x ?? null), [id], undefined);
  const t = useT();
  if (timeline === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (timeline === null) {
    return (
      <EmptyState icon={<CalendarRange />} title={t("Timeline not found")} description={t("It may have been deleted, or the link is from another workspace.")}>
        <Button asChild variant="outline">
          <Link href="/timelines">{t("All timelines")}</Link>
        </Button>
      </EmptyState>
    );
  }
  return <TimelineView key={timeline.id} timeline={timeline} />;
}

function TimelineView({ timeline }: { timeline: Timeline }) {
  const t = useT();
  const router = useRouter();
  const projects = useProjects();
  const isMobile = useIsMobile();
  const svgRef = useRef<SVGSVGElement>(null);
  const slideRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<"chart" | "management">("chart");
  const today = useMemo(() => todayYMD(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusTitle, setFocusTitle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [title, setTitle] = useDraft(timeline.title, (v) => updateTimeline(timeline.id, { title: v.trim() || timeline.title }));
  const [description, setDescription] = useDraft(timeline.description, (v) => updateTimeline(timeline.id, { description: v }));
  const project = projects.find((p) => p.id === timeline.projectId);

  function select(id: string | null) {
    setSelectedId(id);
    setFocusTitle(true);
  }

  async function remove() {
    await deleteTimeline(timeline.id);
    toast.success(t("Timeline deleted"));
    router.replace("/timelines");
  }

  const dates = timeline.entries.flatMap((e) => [e.start, e.end ?? e.start]);
  const span = dates.length ? `${fmtDate(dates.reduce((a, b) => (a < b ? a : b)))} → ${fmtDate(dates.reduce((a, b) => (a > b ? a : b)))}` : null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Link href="/timelines" className="hover:underline">
            {t("Timelines")}
          </Link>
          {project ? (
            <>
              <span>/</span>
              <Link href={`/projects/${project.id}/timelines`} className="inline-flex items-center gap-1 hover:underline">
                <ProjectDot project={project} /> {project.name}
              </Link>
            </>
          ) : null}
          {span ? <span className="ms-auto tabular-nums">{span}</span> : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              }}
              dir="auto"
              aria-label={t("Title")}
              className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              }}
              dir="auto"
              aria-label={t("Description")}
              placeholder={t("One line on what this timeline covers (shown on the export).")}
              className="mt-0.5 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as "chart" | "management")}>
              <TabsList>
                <TabsTrigger value="chart">
                  <CalendarRange /> {t("Detail")}
                </TabsTrigger>
                <TabsTrigger value="management">
                  <Presentation /> {t("Management")}
                  {execEntries(timeline).length ? <span className="ms-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{execEntries(timeline).length}</span> : null}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {view === "management" ? <ExportMenu timeline={timeline} svgRef={slideRef} today={today} variant="slide" /> : <ExportMenu timeline={timeline} svgRef={svgRef} today={today} />}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={t("Delete timeline")} onClick={() => setConfirmDelete(true)}>
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("Delete timeline")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">{t("Project")}</Label>
            <Select value={timeline.projectId ?? "__none"} onValueChange={(v) => void updateTimeline(timeline.id, { projectId: v === "__none" ? undefined : v })}>
              <SelectTrigger size="sm" className="h-7 w-auto text-xs" aria-label={t("Project")}>
                <SelectValue placeholder={t("No project")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t("No project")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <ProjectDot project={p} /> {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`from-${timeline.id}`} className="text-muted-foreground">
              {t("Window")}
            </Label>
            <Input id={`from-${timeline.id}`} type="date" value={timeline.from ?? ""} onChange={(e) => void updateTimeline(timeline.id, { from: e.target.value || undefined })} aria-label={t("From")} className="h-7 w-auto px-1.5 text-xs" />
            <span className="text-muted-foreground">→</span>
            <Input type="date" value={timeline.to ?? ""} min={timeline.from} onChange={(e) => void updateTimeline(timeline.id, { to: e.target.value || undefined })} aria-label={t("To")} className="h-7 w-auto px-1.5 text-xs" />
            {timeline.from || timeline.to ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void updateTimeline(timeline.id, { from: undefined, to: undefined })}>
                {t("Fit to entries")}
              </Button>
            ) : (
              <span className="text-muted-foreground">{t("fits the entries")}</span>
            )}
          </div>
        </div>
      </div>

      {view === "management" ? (
        <>
          <Card size="sm" className="min-w-0 overflow-hidden">
            <CardContent className="px-0 pb-0">
              <div className="border-b px-3 pb-2 text-xs text-muted-foreground">{t("One slide for a steering meeting: executive items only, status from the dates, slippage against the baseline, decisions needed. Export it as a 16:9 PNG or PDF.")}</div>
              <ManagementSlide timeline={timeline} today={today} svgRef={slideRef} />
            </CardContent>
          </Card>
          <ManagementPanel timeline={timeline} today={today} />
        </>
      ) : null}

      <Card size="sm" className={view === "management" ? "hidden" : "relative min-w-0 overflow-hidden"}>
        <CardContent className="px-0 pb-0">
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <TimelineLegend />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-pressed={showTable} aria-label={showTable ? t("Show chart") : t("Show as list")} onClick={() => setShowTable((v) => !v)}>
                  {showTable ? <CalendarRange className="size-3.5" /> : <Table2 className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showTable ? t("Show chart") : t("Show as list")}</TooltipContent>
            </Tooltip>
          </div>
          {timeline.entries.length === 0 ? (
            <div className="flex h-40 items-center justify-center border-t px-4 text-center text-sm text-muted-foreground">{t("The chart appears as soon as there is one dated entry.")}</div>
          ) : showTable || isMobile ? (
            <div className="border-t px-3 py-3">
              <TimelineStory entries={timeline.entries} today={today} selectedId={selectedId} onSelect={select} columns={!isMobile} />
              {isMobile ? (
                <p className="mt-3 text-center text-xs text-muted-foreground">{t("The chart draws on wider screens; exports always include it.")}</p>
              ) : null}
            </div>
          ) : (
            <div className="border-t">
              <TimelineChart timeline={timeline} today={today} selectedId={selectedId} onSelect={select} svgRef={svgRef} />
            </div>
          )}
          {/* Keep an SVG on screen for export even when the list is shown. */}
          {timeline.entries.length && (showTable || isMobile) ? (
            <div className="pointer-events-none absolute top-0 w-[1100px] opacity-0" style={{ left: -20000 }} aria-hidden>
              <TimelineChart timeline={timeline} today={today} svgRef={svgRef} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {view === "chart" && !isMobile && !showTable && timeline.entries.length ? <TimelineStory entries={timeline.entries} today={today} selectedId={selectedId} onSelect={select} /> : null}

      <TimelineEditor timeline={timeline} selectedId={selectedId} onSelect={setSelectedId} focusTitle={focusTitle} />

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("Delete this timeline?")} description={t('"{title}" and its {n} entries will be removed.', { title: timeline.title, n: timeline.entries.length })} confirmLabel="Delete" destructive onConfirm={remove} />
    </div>
  );
}
