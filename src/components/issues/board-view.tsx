"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CheckCircle2, Inbox, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePeople, useProject } from "@/hooks/use-data";
import { createIssue, transitionIssue, updateIssue } from "@/lib/repo";
import { BOARD_STATUSES, type Issue, type IssueStatus } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { CardBody } from "./board-card";
import { BoardColumn } from "./board-column";
import { IssueFilters, useIssueFilters } from "./issue-filters";
import { DONE_WINDOW_DAYS, compareBoard, isRecentlyDone, issueHref, safeWrite, useProjectIssues, useProjectMilestones } from "./issue-utils";

type Cols = Record<IssueStatus, string[]>;

const emptyCols = (): Cols => ({ triage: [], backlog: [], todo: [], in_progress: [], in_review: [], done: [], cancelled: [] });

function findContainer(id: string, cols: Cols): IssueStatus | undefined {
  if (id in cols) return id as IssueStatus;
  return BOARD_STATUSES.find((s) => cols[s].includes(id));
}

export function BoardView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openQuickCreate } = useUi();
  const project = useProject(id);
  const issues = useProjectIssues(id);
  const milestones = useProjectMilestones(id);
  const people = usePeople();
  const { filters, set } = useIssueFilters();

  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const triageCount = useMemo(() => issues.filter((i) => i.status === "triage").length, [issues]);

  // Columns as the database sees them, after the URL filters.
  const { cols: liveCols, hiddenDone } = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const buckets = new Map<IssueStatus, Issue[]>();
    let hiddenDone = 0;
    for (const i of issues) {
      if (!BOARD_STATUSES.includes(i.status)) continue;
      if (filters.assignee === "none" ? i.assigneeId : filters.assignee && i.assigneeId !== filters.assignee) continue;
      if (filters.milestone === "none" ? i.milestoneId : filters.milestone && i.milestoneId !== filters.milestone) continue;
      if (q && !i.title.toLowerCase().includes(q) && !i.labels.some((l) => l.toLowerCase().includes(q))) continue;
      if (i.status === "done" && !filters.done && !isRecentlyDone(i)) {
        hiddenDone += 1;
        continue;
      }
      buckets.set(i.status, [...(buckets.get(i.status) ?? []), i]);
    }
    const cols = emptyCols();
    for (const s of BOARD_STATUSES) cols[s] = (buckets.get(s) ?? []).sort(compareBoard).map((i) => i.id);
    return { cols, hiddenDone };
  }, [issues, filters]);

  // While dragging, the layout is optimistic; it is dropped once the writes land.
  const [override, setOverride] = useState<Cols | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cols = override ?? liveCols;
  const justDragged = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space lifts and drops; Enter stays free to open a card.
      keyboardCodes: { start: [KeyboardCode.Space], cancel: [KeyboardCode.Esc], end: [KeyboardCode.Space] },
    }),
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOverride(cols);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const aId = String(active.id);
    const oId = String(over.id);
    setOverride((prev) => {
      const c = prev ?? liveCols;
      const from = findContainer(aId, c);
      const to = findContainer(oId, c);
      if (!from || !to || from === to) return prev;
      const fromItems = c[from].filter((x) => x !== aId);
      const toItems = c[to].filter((x) => x !== aId);
      const overIndex = toItems.indexOf(oId);
      let insertAt = toItems.length;
      if (overIndex >= 0) {
        const translated = active.rect.current.translated;
        const below = translated && translated.top > over.rect.top + over.rect.height / 2;
        insertAt = overIndex + (below ? 1 : 0);
      }
      toItems.splice(insertAt, 0, aId);
      return { ...c, [from]: fromItems, [to]: toItems };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const aId = String(active.id);
    setActiveId(null);
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 150);
    const c = override ?? liveCols;
    const from = findContainer(aId, c);
    if (!over || !from) {
      setOverride(null);
      return;
    }
    const oId = String(over.id);
    const to = findContainer(oId, c) ?? from;
    let items = c[to];
    if (from === to) {
      const oi = items.indexOf(aId);
      const ni = items.indexOf(oId);
      if (oi !== -1 && ni !== -1 && oi !== ni) items = arrayMove(items, oi, ni);
    } else {
      items = [...items.filter((x) => x !== aId), aId];
    }
    const final: Cols = { ...c, [from]: c[from].filter((x) => x !== aId || from === to), [to]: items };
    setOverride(final);
    await persist(final);
    // The live query re-runs right after the commit; a short grace period
    // keeps the optimistic layout on screen until it does.
    window.setTimeout(() => setOverride(null), 250);
  }

  async function persist(final: Cols) {
    const writes: Promise<unknown>[] = [];
    for (const status of BOARD_STATUSES) {
      if (final[status].join() === liveCols[status].join()) continue;
      final[status].forEach((iid, idx) => {
        const issue = byId.get(iid);
        if (!issue) return;
        if (issue.status !== status) writes.push(transitionIssue(iid, status, { order: idx }));
        else if (issue.order !== idx) writes.push(updateIssue(iid, { order: idx }));
      });
    }
    if (writes.length) await safeWrite(() => Promise.all(writes), "Could not move issue");
  }

  function openIssue(issue: Issue) {
    if (justDragged.current) return;
    router.push(issueHref(issue));
  }

  const activeIssue = activeId ? byId.get(activeId) : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <IssueFilters milestones={milestones} people={people} fields={["q", "assignee", "milestone"]} />
        <div className="ms-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant={filters.done ? "secondary" : "ghost"} size="sm" aria-pressed={filters.done} className="h-7 text-xs font-normal" onClick={() => set({ done: !filters.done })}>
                <CheckCircle2 className="size-3.5" />
                {filters.done ? "Recent done only" : "All done"}
                {!filters.done && hiddenDone ? <span className="tabular text-muted-foreground">{hiddenDone}</span> : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent>The Done column shows the last {DONE_WINDOW_DAYS} days by default</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" aria-label="List">
                <Link href={`/projects/${id}/issues`}><List /></Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>List</TooltipContent>
          </Tooltip>
          <Button type="button" size="sm" className="ms-1 h-7" onClick={() => openQuickCreate("issue", id)}>
            <Plus /> New issue <Kbd className="ms-1 bg-primary-foreground/20 text-primary-foreground">C</Kbd>
          </Button>
        </div>
      </div>

      {triageCount ? (
        <Link href="/inbox" className="mb-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted">
          <Inbox className="size-3.5 text-muted-foreground" />
          <span>
            <span className="font-medium">{triageCount}</span> {triageCount === 1 ? "issue" : "issues"} in triage
          </span>
          <span className="ms-auto text-muted-foreground">Open inbox →</span>
        </Link>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setOverride(null); }}>
        <div className="thin-scroll -mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
          <div className="grid grid-flow-col gap-3" style={{ gridAutoColumns: "minmax(280px, 1fr)" }}>
            {BOARD_STATUSES.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                issues={cols[status].map((iid) => byId.get(iid)).filter((i): i is Issue => Boolean(i))}
                project={project}
                personById={personById}
                onOpen={openIssue}
                onAdd={(title) => safeWrite(() => createIssue({ projectId: id, title, status }), "Could not create issue")}
              />
            ))}
          </div>
        </div>
        <DragOverlay>{activeIssue ? <CardBody issue={activeIssue} project={project} assignee={personById.get(activeIssue.assigneeId ?? "")} overlay /> : null}</DragOverlay>
      </DndContext>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Drag to move · <Kbd>Space</Kbd> lifts a focused card, arrows move it, <Kbd>Space</Kbd> drops</span>
        <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
      </p>
    </div>
  );
}
