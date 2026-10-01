"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Decision, Issue, Note, Person, Project, Timeline } from "@/lib/types";

const EMPTY: never[] = [];

// Small live queries reused across pages. Each returns [] until the first
// result so server render and first client render match.

export function useProjects() {
  return useLiveQuery(() => db.projects.orderBy("updatedAt").reverse().toArray(), [], EMPTY as Project[]);
}

export function useActiveProjects() {
  return useLiveQuery(
    () => db.projects.where("status").anyOf("active", "paused").sortBy("name"),
    [],
    EMPTY as Project[],
  );
}

export function useProject(id?: string) {
  return useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id]);
}

export function usePeople() {
  return useLiveQuery(() => db.people.orderBy("name").toArray(), [], EMPTY as Person[]);
}

export function useAllIssues() {
  return useLiveQuery(() => db.issues.toArray(), [], EMPTY as Issue[]);
}

export function useAllNotes() {
  return useLiveQuery(() => db.notes.toArray(), [], EMPTY as Note[]);
}

export function useAllDecisions() {
  return useLiveQuery(() => db.decisions.orderBy("seq").reverse().toArray(), [], EMPTY as Decision[]);
}

export function useAllTimelines() {
  return useLiveQuery(() => db.timelines.orderBy("updatedAt").reverse().toArray(), [], EMPTY as Timeline[]);
}

/** Everything wikilinks can resolve against. */
export function useLinkIndex() {
  const notes = useAllNotes();
  const issues = useAllIssues();
  const decisions = useAllDecisions();
  const projects = useProjects();
  return { notes, issues, decisions, projects };
}

export function useIsEmptyWorkspace() {
  const n = useLiveQuery(async () => (await db.projects.count()) + (await db.notes.count()), [], -1);
  return n === 0;
}
