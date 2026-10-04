"use client";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { GraphSource } from "@/lib/graph/model";
import type { Milestone, Person, Risk, Timeline } from "@/lib/types";
import { useLinkIndex } from "./use-data";

const EMPTY: never[] = [];

/** Every table the workspace graph draws from, live. `ready` is false until the first read lands. */
export function useGraphSource(): { source: GraphSource; ready: boolean } {
  const { notes, issues, decisions, projects } = useLinkIndex();
  const milestones = useLiveQuery(() => db.milestones.toArray(), [], null as Milestone[] | null);
  const people = useLiveQuery(() => db.people.toArray(), [], EMPTY as Person[]);
  const risks = useLiveQuery(() => db.risks.toArray(), [], EMPTY as Risk[]);
  const timelines = useLiveQuery(() => db.timelines.toArray(), [], EMPTY as Timeline[]);
  const source = useMemo(
    () => ({ notes, issues, decisions, projects, milestones: milestones ?? EMPTY, people, risks, timelines }),
    [notes, issues, decisions, projects, milestones, people, risks, timelines],
  );
  return { source, ready: milestones !== null };
}
