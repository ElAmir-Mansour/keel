"use client";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { DEFAULT_RULES, creditsOf, kpiCountsIssue } from "@/lib/points";
import type { Issue, IssueEvent, Kpi, PointEntry, PointRules } from "@/lib/types";
import { useAllIssues, usePeople } from "./use-data";

const EMPTY: never[] = [];
const FALLBACK_RULES: PointRules = { ...DEFAULT_RULES, createdAt: "", updatedAt: "" };

/** Everything points and KPI views read, live. */
export function usePointsData() {
  const kpis = useLiveQuery(() => db.kpis.toArray(), [], EMPTY as Kpi[]);
  const entries = useLiveQuery(() => db.pointEntries.toArray(), [], EMPTY as PointEntry[]);
  const rulesRow = useLiveQuery(() => db.pointRules.get("default"), []);
  const events = useLiveQuery(() => db.issueEvents.toArray(), [], EMPTY as IssueEvent[]);
  const issues = useAllIssues();
  const people = usePeople();
  const rules = rulesRow ?? FALLBACK_RULES;
  return { kpis, entries, rules, events, issues, people };
}

export function usePointRules() {
  return useLiveQuery(() => db.pointRules.get("default"), []) ?? FALLBACK_RULES;
}

export interface IssueKpiLink {
  kpi: Kpi;
  personId: string;
  /** Counted because the filter matches (auto) or because someone linked it (explicit). */
  how: "auto" | "explicit";
}

/** The KPIs an issue counts toward, for every person who earns its points. */
export function kpiLinksFor(issue: Issue, kpis: Kpi[]): { counted: IssueKpiLink[]; available: Kpi[] } {
  const people = new Set(creditsOf(issue).map((c) => c.personId));
  const theirs = kpis.filter((k) => !k.archived && people.has(k.personId));
  const counted: IssueKpiLink[] = [];
  const available: Kpi[] = [];
  for (const k of theirs) {
    const explicit = (issue.kpiIds ?? []).includes(k.id);
    const auto = kpiCountsIssue({ ...k }, { ...issue, kpiIds: (issue.kpiIds ?? []).filter((x) => x !== k.id) });
    if (auto) counted.push({ kpi: k, personId: k.personId, how: "auto" });
    else if (explicit) counted.push({ kpi: k, personId: k.personId, how: "explicit" });
    else available.push(k);
  }
  return { counted, available };
}

export function useIssueKpis(issue: Issue | undefined) {
  const kpis = useLiveQuery(() => db.kpis.toArray(), [], EMPTY as Kpi[]);
  return useMemo(() => (issue ? kpiLinksFor(issue, kpis) : { counted: [], available: [] }), [issue, kpis]);
}
