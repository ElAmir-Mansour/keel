import { describe, expect, it } from "vitest";
import {
  attainment,
  blendedMultiplier,
  creditsOf,
  derivedLedger,
  kpiResult,
  payoutCurve,
  periodKey,
  periodLabel,
  periodRange,
  personPeriod,
  scorecard,
  shiftPeriod,
  teamScore,
  tierFor,
  DEFAULT_RULES,
  elapsedFraction,
  paceFor,
} from "../points";
import type { Issue, IssueEvent, Kpi } from "../types";

let n = 0;
const issue = (over: Partial<Issue>): Issue => ({
  id: `i${++n}`,
  projectId: "p1",
  seq: n,
  title: `Issue ${n}`,
  description: "",
  status: "todo",
  priority: "none",
  labels: [],
  order: 0,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
  ...over,
});
const ev = (issueId: string, at: string, from: Issue["status"] | null, to: Issue["status"]): IssueEvent => ({ id: `${issueId}-${at}`, issueId, projectId: "p1", at, from, to });
const kpi = (over: Partial<Kpi>): Kpi => ({
  id: `k${++n}`,
  personId: "sara",
  name: "KPI",
  metric: "points_delivered",
  direction: "higher",
  target: 10,
  cadence: "quarter",
  weight: 1,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("periods", () => {
  it("keys, ranges, labels and shifts months and quarters", () => {
    expect(periodKey("month", new Date(2026, 9, 4))).toBe("2026-10");
    expect(periodKey("quarter", new Date(2026, 9, 4))).toBe("2026-Q4");
    const q = periodRange("2026-Q4");
    expect([q.start.getMonth(), q.end.getFullYear(), q.end.getMonth()]).toEqual([9, 2027, 0]);
    expect(periodLabel("2026-Q4")).toBe("Q4 2026");
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(shiftPeriod("2026-Q1", -1)).toBe("2025-Q4");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });
});

describe("ledger", () => {
  it("earns the locked points on done, reverses on reopen, earns again on re-done", () => {
    const a = issue({ assigneeId: "sara", estimate: 8, lockedPoints: 5, status: "done", completedAt: "2026-10-20T10:00:00.000Z" });
    const lines = derivedLedger(
      [a],
      [ev(a.id, "2026-10-01T09:00:00.000Z", null, "todo"), ev(a.id, "2026-10-05T09:00:00.000Z", "todo", "done"), ev(a.id, "2026-10-06T09:00:00.000Z", "done", "in_progress"), ev(a.id, "2026-10-20T10:00:00.000Z", "in_progress", "done")],
    );
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([
      ["earned", 5],
      ["reversed", -5],
      ["earned", 5],
    ]);
  });
  it("splits points by credit shares and normalises them", () => {
    expect(creditsOf({ assigneeId: "sara" })).toEqual([{ personId: "sara", share: 1 }]);
    expect(creditsOf({ assigneeId: "sara", credits: [{ personId: "sara", share: 3 }, { personId: "omar", share: 1 }] })).toEqual([
      { personId: "sara", share: 0.75 },
      { personId: "omar", share: 0.25 },
    ]);
    const a = issue({ estimate: 8, credits: [{ personId: "sara", share: 0.5 }, { personId: "omar", share: 0.5 }], status: "done" });
    const lines = derivedLedger([a], [ev(a.id, "2026-10-05T09:00:00.000Z", "todo", "done")]);
    expect(lines.map((l) => [l.personId, l.amount])).toEqual([
      ["sara", 4],
      ["omar", 4],
    ]);
  });
  it("counts an imported done issue without history once, and skips unestimated work", () => {
    const a = issue({ assigneeId: "sara", estimate: 3, status: "done", completedAt: "2026-10-02T09:00:00.000Z" });
    const b = issue({ assigneeId: "sara", status: "done", completedAt: "2026-10-02T09:00:00.000Z" });
    expect(derivedLedger([a, b], []).map((l) => l.amount)).toEqual([3]);
  });
});

describe("attainment", () => {
  it("reads actual/target for higher-is-better and caps at 150%", () => {
    expect(attainment({ direction: "higher", target: 20 }, 10)).toBe(0.5);
    expect(attainment({ direction: "higher", target: 20 }, 40)).toBe(1.5);
  });
  it("uses 2 − actual/target for lower-is-better, which stays finite at zero", () => {
    expect(attainment({ direction: "lower", target: 4 }, 2)).toBe(1.5);
    expect(attainment({ direction: "lower", target: 4 }, 6)).toBe(0.5);
    expect(attainment({ direction: "lower", target: 10 }, 0)).toBe(1.5);
    expect(attainment({ direction: "lower", target: 4 }, 12)).toBe(0);
  });
  it("reaches the cap at a stretch goal when one is set", () => {
    expect(attainment({ direction: "higher", target: 20, stretch: 30 }, 25)).toBe(1.25);
    expect(attainment({ direction: "lower", target: 4, stretch: 2 }, 3)).toBe(1.25);
  });
});

describe("KPI results", () => {
  const sara = "sara";
  const done = (over: Partial<Issue>) => issue({ assigneeId: sara, status: "done", ...over });
  it("measures on-time delivery, cycle time and commitment", () => {
    const a = done({ estimate: 3, dueDate: "2026-10-10", startedAt: "2026-10-01T09:00:00.000Z", completedAt: "2026-10-03T09:00:00.000Z" });
    const b = done({ estimate: 5, dueDate: "2026-10-10", startedAt: "2026-10-01T09:00:00.000Z", completedAt: "2026-10-12T09:00:00.000Z" });
    const c = issue({ assigneeId: sara, estimate: 2, dueDate: "2026-10-20", status: "in_progress" });
    const ctx = { issues: [a, b, c], events: [] };
    expect(kpiResult(kpi({ metric: "on_time_rate", target: 90, minSample: 2 }), ctx, "2026-10")).toMatchObject({ actual: 50, sample: 2, enough: true });
    expect(kpiResult(kpi({ metric: "cycle_time_median", direction: "lower", target: 5, minSample: 2 }), ctx, "2026-10")).toMatchObject({ actual: 6.5, sample: 2 });
    expect(kpiResult(kpi({ metric: "commitment_ratio", target: 80, minSample: 2 }), ctx, "2026-10")).toMatchObject({ actual: 80, sample: 3 });
  });
  it("marks a rate with too few items as not enough data", () => {
    const a = done({ dueDate: "2026-10-10", completedAt: "2026-10-03T09:00:00.000Z" });
    expect(kpiResult(kpi({ metric: "on_time_rate", target: 90 }), { issues: [a], events: [] }, "2026-10")).toMatchObject({ actual: 100, sample: 1, enough: false });
  });
  it("counts reopened work and time spent in review", () => {
    const a = done({ completedAt: "2026-10-09T09:00:00.000Z" });
    const b = done({ completedAt: "2026-10-04T09:00:00.000Z" });
    const events = [
      ev(a.id, "2026-10-02T09:00:00.000Z", "in_progress", "in_review"),
      ev(a.id, "2026-10-04T09:00:00.000Z", "in_review", "done"),
      ev(a.id, "2026-10-05T09:00:00.000Z", "done", "in_progress"),
      ev(a.id, "2026-10-09T09:00:00.000Z", "in_progress", "done"),
      ev(b.id, "2026-10-03T09:00:00.000Z", "in_progress", "in_review"),
      ev(b.id, "2026-10-04T09:00:00.000Z", "in_review", "done"),
    ];
    const ctx = { issues: [a, b], events };
    expect(kpiResult(kpi({ metric: "reopen_rate", direction: "lower", target: 10, minSample: 2 }), ctx, "2026-10")).toMatchObject({ actual: 50, sample: 2 });
    expect(kpiResult(kpi({ metric: "review_wait", direction: "lower", target: 1, minSample: 2 }), ctx, "2026-10")).toMatchObject({ actual: 1.5, sample: 2 });
  });
  it("filters by project and label, and an explicit link adds an issue the filter misses", () => {
    const k = kpi({ id: "kp", filter: { projectIds: ["p1"], labels: ["backend"] } });
    const a = done({ estimate: 3, labels: ["backend"], completedAt: "2026-11-02T09:00:00.000Z" });
    const b = done({ estimate: 5, labels: ["frontend"], completedAt: "2026-11-02T09:00:00.000Z" });
    const c = done({ estimate: 8, projectId: "p2", labels: [], kpiIds: ["kp"], completedAt: "2026-11-02T09:00:00.000Z" });
    const r = kpiResult(k, { issues: [a, b, c], events: [ev(a.id, a.completedAt!, "todo", "done"), ev(b.id, b.completedAt!, "todo", "done"), ev(c.id, c.completedAt!, "todo", "done")] }, "2026-Q4");
    expect(r.actual).toBe(11);
  });
  it("reads manual results per period", () => {
    expect(kpiResult(kpi({ metric: "manual", manual: { "2026-Q4": 4 } }), { issues: [], events: [] }, "2026-Q4")).toMatchObject({ actual: 4, enough: true });
    expect(kpiResult(kpi({ metric: "manual" }), { issues: [], events: [] }, "2026-Q4")).toMatchObject({ actual: null, enough: false });
  });
});

describe("scorecard and payout", () => {
  it("weights KPIs and moves the weight of one without enough data to the others", () => {
    const a = issue({ assigneeId: "sara", estimate: 10, status: "done", completedAt: "2026-10-03T09:00:00.000Z" });
    const ctx = { issues: [a], events: [ev(a.id, a.completedAt!, "todo", "done")] };
    const kpis = [kpi({ metric: "points_delivered", target: 10, weight: 60 }), kpi({ metric: "on_time_rate", target: 90, weight: 40 })];
    const card = scorecard("sara", kpis, ctx, "2026-Q4");
    expect(card.kpis[1].attainment).toBeNull();
    expect(card.kpis[0].effectiveWeight).toBe(1);
    expect(card.score).toBe(1);
  });
  it("pays nothing below the threshold and follows the curve above it", () => {
    expect(payoutCurve(0.79, 80)).toBe(0);
    expect(payoutCurve(0.8, 80)).toBe(0.5);
    expect(payoutCurve(0.9, 80)).toBeCloseTo(0.75);
    expect(payoutCurve(1, 80)).toBe(1);
    expect(payoutCurve(1.2, 80)).toBe(1.2);
    expect(payoutCurve(null, 80)).toBe(0);
    expect(blendedMultiplier(1.2, 1, { thresholdPct: 80, teamSharePct: 70 })).toBe(1.06);
  });
  it("picks the highest bonus tier reached and suggests extra points", () => {
    expect(tierFor(1.2, DEFAULT_RULES.tiers)?.label).toBe("Exceeds");
    expect(tierFor(1.35, DEFAULT_RULES.tiers)?.label).toBe("Outstanding");
    expect(tierFor(1.0, DEFAULT_RULES.tiers)).toBeNull();
    const a = issue({ assigneeId: "sara", estimate: 20, status: "done", completedAt: "2026-10-03T09:00:00.000Z" });
    const data = { kpis: [kpi({ target: 16 })], issues: [a], events: [ev(a.id, a.completedAt!, "todo", "done")], entries: [], rules: DEFAULT_RULES };
    const pp = personPeriod("sara", "2026-Q4", data, teamScore(["sara"], data.kpis, data, "2026-Q4"));
    expect(pp.card.score).toBe(1.25);
    expect(pp.tier?.label).toBe("Exceeds");
    expect(pp.suggestedBonus).toBe(2);
    expect(pp.earned).toBe(20);
  });
  it("adds approved adjustments and bonuses, and keeps drafts apart", () => {
    const data = {
      kpis: [],
      issues: [],
      events: [],
      rules: DEFAULT_RULES,
      entries: [
        { id: "e1", personId: "sara", kind: "adjustment" as const, amount: 3, reason: "Ran the incident review", status: "approved" as const, at: "2026-10-10T09:00:00.000Z", createdAt: "", updatedAt: "" },
        { id: "e2", personId: "sara", kind: "bonus" as const, amount: 5, reason: "Q4", period: "2026-Q4", status: "draft" as const, at: "2026-12-30T09:00:00.000Z", createdAt: "", updatedAt: "" },
        { id: "e3", personId: "sara", kind: "bonus" as const, amount: 2, reason: "Q4", period: "2026-Q4", status: "approved" as const, at: "2026-12-30T09:00:00.000Z", createdAt: "", updatedAt: "" },
      ],
    };
    const pp = personPeriod("sara", "2026-Q4", data, null);
    expect([pp.adjustments, pp.bonuses, pp.pendingBonuses, pp.total]).toEqual([3, 2, 5, 5]);
  });
});

describe("pace", () => {
  it("expects a share of a cumulative target by today, and nothing for rates or past periods", () => {
    const mid = new Date(2026, 10, 15, 12); // mid Q4
    expect(elapsedFraction("2026-Q4", mid)).toBeGreaterThan(0.45);
    expect(elapsedFraction("2026-Q3", mid)).toBe(1);
    const p = paceFor({ metric: "points_delivered", direction: "higher", target: 30 }, 10, "2026-Q4", mid)!;
    expect(p.expected).toBeGreaterThan(14);
    expect(p.onPace).toBe(false);
    expect(paceFor({ metric: "on_time_rate", direction: "higher", target: 90 }, 50, "2026-Q4", mid)).toBeNull();
    expect(paceFor({ metric: "points_delivered", direction: "higher", target: 30 }, 10, "2026-Q3", mid)).toBeNull();
  });
});

describe("projected score", () => {
  it("projects cumulative KPIs to the end of a running period", () => {
    const mid = new Date(2026, 10, 15, 12);
    const a = issue({ assigneeId: "sara", estimate: 10, status: "done", completedAt: "2026-10-20T09:00:00.000Z" });
    const ctx = { issues: [a], events: [ev(a.id, a.completedAt!, "todo", "done")] };
    const card = scorecard("sara", [kpi({ target: 20, weight: 1 })], ctx, "2026-Q4", mid);
    expect(card.score).toBe(0.5);
    expect(card.projected!).toBeGreaterThan(0.9);
    expect(scorecard("sara", [kpi({ target: 20, weight: 1 })], ctx, "2026-Q4", new Date(2027, 1, 1)).projected).toBeNull();
  });
});
