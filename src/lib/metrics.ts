import { addDays, differenceInHours, parseISO, startOfDay, startOfWeek, subDays } from "date-fns";
import { eachDay, ymd } from "./dates";
import { BOARD_STATUSES, type Issue, type IssueEvent, type IssueStatus, type Milestone, type Risk } from "./types";

// Pure functions from records to chart series. No database access here, so
// every metric is unit-testable and the dashboard can filter in memory.

export interface DayPoint {
  day: string; // YYYY-MM-DD
  [k: string]: number | string;
}

/** Burn-up: cumulative scope (created) vs cumulative done, per day. */
export function burnUp(issues: Issue[], from: Date, to: Date): DayPoint[] {
  const live = issues.filter((i) => i.status !== "cancelled");
  return eachDay(from, to).map((d) => {
    const end = addDays(startOfDay(d), 1);
    const scope = live.filter((i) => parseISO(i.createdAt) < end).length;
    const done = live.filter(
      (i) => i.completedAt && parseISO(i.completedAt) < end,
    ).length;
    return { day: ymd(d), scope, done };
  });
}

/**
 * Cumulative flow: how many issues sat in each status at the end of each day,
 * reconstructed from the transition log. Statuses in flow order.
 */
export function cumulativeFlow(
  issues: Issue[],
  events: IssueEvent[],
  from: Date,
  to: Date,
): DayPoint[] {
  const byIssue = new Map<string, IssueEvent[]>();
  for (const e of events) {
    const arr = byIssue.get(e.issueId) ?? [];
    arr.push(e);
    byIssue.set(e.issueId, arr);
  }
  for (const arr of byIssue.values()) arr.sort((a, b) => a.at.localeCompare(b.at));

  return eachDay(from, to).map((d) => {
    const end = addDays(startOfDay(d), 1);
    const counts: Record<string, number> = {};
    for (const s of BOARD_STATUSES) counts[s] = 0;
    for (const issue of issues) {
      if (parseISO(issue.createdAt) >= end) continue;
      const evs = byIssue.get(issue.id);
      let status: IssueStatus | null = null;
      if (evs && evs.length) {
        for (const e of evs) {
          if (parseISO(e.at) < end) status = e.to;
          else break;
        }
      } else {
        status = issue.status;
      }
      if (status && status in counts) counts[status] += 1;
    }
    return { day: ymd(d), ...counts };
  });
}

/** Throughput: issues completed per ISO week (Monday start). */
export function throughputByWeek(issues: Issue[], weeks = 8) {
  const now = new Date();
  const start = startOfWeek(subDays(now, (weeks - 1) * 7), { weekStartsOn: 1 });
  const buckets: { week: string; done: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    buckets.push({ week: ymd(ws), done: 0 });
  }
  for (const i of issues) {
    if (!i.completedAt || i.status !== "done") continue;
    const c = parseISO(i.completedAt);
    if (c < start) continue;
    const idx = Math.floor((startOfDay(c).getTime() - start.getTime()) / 86400000 / 7);
    if (buckets[idx]) buckets[idx].done += 1;
  }
  return buckets;
}

/** Cycle time in days for each issue that has both started and completed. */
export function cycleTimes(issues: Issue[]) {
  return issues
    .filter((i) => i.status === "done" && i.startedAt && i.completedAt)
    .map((i) => ({
      id: i.id,
      days: Math.max(
        0.1,
        differenceInHours(parseISO(i.completedAt!), parseISO(i.startedAt!)) / 24,
      ),
    }));
}

export function cycleTimeHistogram(issues: Issue[]) {
  const bins = [
    { label: "<1d", max: 1 },
    { label: "1–2d", max: 2 },
    { label: "2–4d", max: 4 },
    { label: "4–7d", max: 7 },
    { label: "1–2w", max: 14 },
    { label: "2w+", max: Infinity },
  ].map((b) => ({ ...b, count: 0 }));
  for (const { days } of cycleTimes(issues)) {
    const bin = bins.find((b) => days < b.max) ?? bins[bins.length - 1];
    bin.count += 1;
  }
  return bins.map(({ label, count }) => ({ label, count }));
}

export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export function cycleTimeSummary(issues: Issue[]) {
  const v = cycleTimes(issues).map((c) => c.days);
  return { n: v.length, p50: percentile(v, 50), p85: percentile(v, 85) };
}

export function milestoneProgress(m: Milestone, issues: Issue[]) {
  const mine = issues.filter((i) => i.milestoneId === m.id && i.status !== "cancelled");
  const done = mine.filter((i) => i.status === "done").length;
  return { total: mine.length, done, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 };
}

export function workloadByAssignee(issues: Issue[]) {
  const map = new Map<string, { open: number; doing: number }>();
  for (const i of issues) {
    if (i.status === "done" || i.status === "cancelled") continue;
    const key = i.assigneeId ?? "__unassigned";
    const cur = map.get(key) ?? { open: 0, doing: 0 };
    if (i.status === "in_progress" || i.status === "in_review") cur.doing += 1;
    else cur.open += 1;
    map.set(key, cur);
  }
  return map;
}

export function riskMatrix(risks: Risk[]) {
  // grid[impact][likelihood] counts, 1..5 each
  const grid: number[][] = Array.from({ length: 6 }, () => Array(6).fill(0));
  for (const r of risks) {
    if (r.status === "closed") continue;
    grid[r.impact][r.likelihood] += 1;
  }
  return grid;
}

export function isOpen(i: Issue) {
  return i.status !== "done" && i.status !== "cancelled";
}
