import { describe, expect, it } from "vitest";
import { burnUp, cumulativeFlow, cycleTimeHistogram, cycleTimeSummary, milestoneProgress, percentile, throughputByWeek } from "../metrics";
import type { Issue, IssueEvent, Milestone } from "../types";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12));

function issue(over: Partial<Issue>): Issue {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    projectId: "p",
    seq: 1,
    title: "t",
    description: "",
    status: "backlog",
    priority: "none",
    labels: [],
    order: 0,
    createdAt: day(0).toISOString(),
    updatedAt: day(0).toISOString(),
    ...over,
  };
}

describe("burnUp", () => {
  it("counts scope and done cumulatively and ignores cancelled", () => {
    const issues = [
      issue({ id: "a", createdAt: day(0).toISOString(), status: "done", completedAt: day(2).toISOString() }),
      issue({ id: "b", createdAt: day(1).toISOString() }),
      issue({ id: "c", createdAt: day(1).toISOString(), status: "cancelled" }),
    ];
    const series = burnUp(issues, day(0), day(3));
    expect(series.map((p) => p.scope)).toEqual([1, 2, 2, 2]);
    expect(series.map((p) => p.done)).toEqual([0, 0, 1, 1]);
  });
});

describe("cumulativeFlow", () => {
  it("reconstructs status per day from the event log", () => {
    const a = issue({ id: "a", createdAt: day(0).toISOString(), status: "done" });
    const events: IssueEvent[] = [
      { id: "1", issueId: "a", projectId: "p", at: day(0).toISOString(), from: null, to: "backlog" },
      { id: "2", issueId: "a", projectId: "p", at: day(1).toISOString(), from: "backlog", to: "in_progress" },
      { id: "3", issueId: "a", projectId: "p", at: day(3).toISOString(), from: "in_progress", to: "done" },
    ];
    const s = cumulativeFlow([a], events, day(0), day(3));
    expect(s[0].backlog).toBe(1);
    expect(s[1].in_progress).toBe(1);
    expect(s[1].backlog).toBe(0);
    expect(s[3].done).toBe(1);
  });

  it("falls back to the current status when an issue has no events", () => {
    const a = issue({ id: "a", status: "todo", createdAt: day(0).toISOString() });
    const s = cumulativeFlow([a], [], day(0), day(0));
    expect(s[0].todo).toBe(1);
  });
});

describe("cycle time", () => {
  it("bins and summarises completed issues only", () => {
    const issues = [
      issue({ id: "a", status: "done", startedAt: day(0).toISOString(), completedAt: day(1).toISOString() }),
      issue({ id: "b", status: "done", startedAt: day(0).toISOString(), completedAt: day(5).toISOString() }),
      issue({ id: "c", status: "in_progress", startedAt: day(0).toISOString() }),
    ];
    const bins = cycleTimeHistogram(issues);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(2);
    const sum = cycleTimeSummary(issues);
    expect(sum.n).toBe(2);
    expect(sum.p50).toBeGreaterThan(0);
    expect(sum.p85).toBeGreaterThanOrEqual(sum.p50);
  });

  it("percentile handles empty and single values", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([4], 85)).toBe(4);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});

describe("throughputByWeek", () => {
  it("returns the requested number of buckets", () => {
    expect(throughputByWeek([], 8)).toHaveLength(8);
  });
});

describe("milestoneProgress", () => {
  it("computes percent done excluding cancelled", () => {
    const m: Milestone = { id: "m", projectId: "p", title: "m", description: "", status: "active", order: 0, createdAt: "", updatedAt: "" };
    const issues = [
      issue({ milestoneId: "m", status: "done" }),
      issue({ milestoneId: "m", status: "todo" }),
      issue({ milestoneId: "m", status: "cancelled" }),
    ];
    expect(milestoneProgress(m, issues)).toEqual({ total: 2, done: 1, pct: 50 });
  });
});
