"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { parseISO } from "date-fns";
import { db } from "@/lib/db";
import type { Decision, Issue, IssueEvent, Milestone, Note, Person, Project, Risk, Update } from "@/lib/types";

// One live query for the whole dashboard. `null` until the first result so
// the page can show skeletons instead of an empty chart; later changes swap
// the data in place, so refetches never flash.

export interface Workspace {
  projects: Project[];
  milestones: Milestone[];
  issues: Issue[];
  events: IssueEvent[];
  risks: Risk[];
  notes: Note[];
  decisions: Decision[];
  people: Person[];
  updates: Update[];
}

export function useWorkspace(): Workspace | null {
  return useLiveQuery(
    async () => {
      const [projects, milestones, issues, events, risks, notes, decisions, people, updates] = await Promise.all([
        db.projects.toArray(),
        db.milestones.toArray(),
        db.issues.toArray(),
        db.issueEvents.toArray(),
        db.risks.toArray(),
        db.notes.toArray(),
        db.decisions.toArray(),
        db.people.toArray(),
        db.updates.toArray(),
      ]);
      return { projects, milestones, issues, events, risks, notes, decisions, people, updates } satisfies Workspace;
    },
    [],
    null,
  );
}

/** Narrow every table to one project, or return the workspace untouched. */
export function sliceByProject(ws: Workspace, projectId?: string): Workspace {
  if (!projectId) return ws;
  const p = (x: { projectId?: string }) => x.projectId === projectId;
  return {
    ...ws,
    projects: ws.projects.filter((x) => x.id === projectId),
    milestones: ws.milestones.filter(p),
    issues: ws.issues.filter(p),
    events: ws.events.filter(p),
    risks: ws.risks.filter(p),
    notes: ws.notes.filter(p),
    decisions: ws.decisions.filter(p),
    updates: ws.updates.filter(p),
  };
}

/** Latest posted update per project, by date then by post time. */
export function latestUpdates(updates: Update[]) {
  const map = new Map<string, Update>();
  for (const u of updates) {
    const cur = map.get(u.projectId);
    if (!cur || u.date > cur.date || (u.date === cur.date && u.createdAt > cur.createdAt)) map.set(u.projectId, u);
  }
  return map;
}

export function completedBetween(issues: Issue[], from: Date, to: Date) {
  const end = new Date(to.getTime() + 86400000);
  return issues.filter((i) => {
    if (i.status !== "done" || !i.completedAt) return false;
    const c = parseISO(i.completedAt);
    return c >= from && c < end;
  });
}

/** Open issues as of the start of `at`, reconstructed from creation and completion times. */
export function openAt(issues: Issue[], at: Date) {
  return issues.filter((i) => {
    if (i.status === "cancelled") return false;
    if (parseISO(i.createdAt) >= at) return false;
    return !(i.completedAt && parseISO(i.completedAt) < at);
  }).length;
}
