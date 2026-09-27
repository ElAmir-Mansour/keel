"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { PRIORITIES, type Cycle, type Issue, type IssueEvent, type Milestone, type Priority } from "@/lib/types";

// Reads and small pure helpers shared by the issue pages. Writes still go
// through repo.ts; safeWrite only turns a failed write into a toast.

const EMPTY: never[] = [];

/** Done issues older than this are hidden from the list and the board. */
export const DONE_WINDOW_DAYS = 14;

export function useProjectIssues(projectId?: string) {
  return useLiveQuery(
    () => (projectId ? db.issues.where({ projectId }).toArray() : []),
    [projectId],
    EMPTY as Issue[],
  );
}

export function useProjectMilestones(projectId?: string) {
  return useLiveQuery(
    () => (projectId ? db.milestones.where({ projectId }).sortBy("order") : []),
    [projectId],
    EMPTY as Milestone[],
  );
}

export function useProjectCycles(projectId?: string) {
  return useLiveQuery(() => (projectId ? db.cycles.where({ projectId }).toArray() : []), [projectId], [] as Cycle[]);
}

export function useIssueEvents(issueId?: string) {
  return useLiveQuery(
    () => (issueId ? db.issueEvents.where({ issueId }).sortBy("at") : []),
    [issueId],
    EMPTY as IssueEvent[],
  );
}

export function priorityRank(p: Priority) {
  return PRIORITIES.find((x) => x.value === p)?.rank ?? 99;
}

/** True for a done issue completed within the window (or with no timestamp). */
export function isRecentlyDone(i: Issue, days = DONE_WINDOW_DAYS) {
  if (i.status !== "done") return false;
  if (!i.completedAt) return true;
  return differenceInCalendarDays(new Date(), parseISO(i.completedAt)) <= days;
}

/** Default list order: priority, then soonest due date (none last), then newest. */
export function compareIssues(a: Issue, b: Issue) {
  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr) return pr;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** Board order inside a column: manual order, then creation. */
export function compareBoard(a: Issue, b: Issue) {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

export function issueHref(i: Pick<Issue, "projectId" | "seq">) {
  return `/projects/${i.projectId}/issues/${i.seq}`;
}

/** Run a repo write; failures surface as a toast instead of an unhandled rejection. Callers pass an already-translated message. */
export async function safeWrite(fn: () => Promise<unknown>, what?: string) {
  try {
    await fn();
  } catch (e) {
    toast.error(what ?? t("Could not save"), { description: e instanceof Error ? e.message : undefined });
  }
}

export function isEditableTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** True when the key event happened inside an open menu, dialog or popover. */
export function inOverlay(el: EventTarget | null) {
  return el instanceof HTMLElement && Boolean(el.closest('[role="dialog"],[role="menu"],[role="listbox"],[data-slot="popover-content"]'));
}
