import { describe, expect, it } from "vitest";
import { approxMeasure } from "../timeline/layout";
import { autoHeadline, execEntries, lastReview, layoutSlide, ragOf, reviewDiff, slideDomain, slipDays, snapshotItems, trendOf, worstRag } from "../timeline/management";
import type { TimelineEntry, TimelineSnapshot } from "../types";

const TODAY = "2026-10-01";
const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (v && k in v ? String(v[k]) : m));

const e = (over: Partial<TimelineEntry> & { id: string; title: string; start: string }): TimelineEntry => ({ exec: true, ...over });

describe("ragOf", () => {
  it("is green when done, red when late against today, amber or red by slip against the baseline", () => {
    expect(ragOf(e({ id: "1", title: "a", start: "2026-09-01" }), TODAY)).toBe("on"); // done
    expect(ragOf(e({ id: "2", title: "a", start: "2026-09-01", end: "2026-09-20", status: "active" }), TODAY)).toBe("off"); // overdue
    expect(ragOf(e({ id: "3", title: "a", start: "2026-10-20" }), TODAY)).toBe("on"); // no baseline
    expect(ragOf(e({ id: "4", title: "a", start: "2026-10-20", baseline: "2026-10-10" }), TODAY)).toBe("risk"); // +10d
    expect(ragOf(e({ id: "5", title: "a", start: "2026-11-20", baseline: "2026-10-10" }), TODAY)).toBe("off"); // +41d
    expect(ragOf(e({ id: "6", title: "a", start: "2026-10-05", baseline: "2026-10-10" }), TODAY)).toBe("on"); // ahead
    expect(ragOf(e({ id: "7", title: "a", start: "2026-11-20", baseline: "2026-10-10", rag: "on" }), TODAY)).toBe("on"); // override
  });
  it("measures slip against the end of a range", () => {
    expect(slipDays(e({ id: "1", title: "a", start: "2026-10-01", end: "2026-10-22", baseline: "2026-10-10" }))).toBe(12);
    expect(slipDays(e({ id: "1", title: "a", start: "2026-10-01" }))).toBeNull();
  });
  it("rolls up to the worst colour and trends against the previous one", () => {
    expect(worstRag(["on", "risk", "on"])).toBe("risk");
    expect(worstRag([])).toBe("on");
    expect(trendOf("on", "risk")).toBe("up");
    expect(trendOf("off", "risk")).toBe("down");
    expect(trendOf("risk", "risk")).toBe("steady");
    expect(trendOf("risk")).toBe("steady");
  });
});

describe("reviews", () => {
  const entries = [
    e({ id: "a", title: "Kickoff", start: "2026-09-12" }),
    e({ id: "b", title: "Gateway", start: "2026-10-01", end: "2026-10-22", baseline: "2026-10-10" }),
    e({ id: "c", title: "Go-live", start: "2026-12-01", kind: "milestone" }),
    e({ id: "d", title: "New thing", start: "2026-11-01" }),
  ];
  const snap: TimelineSnapshot = {
    id: "s1",
    at: "2026-09-17",
    items: [
      { id: "a", title: "Kickoff", date: "2026-09-12", rag: "on", state: "planned" },
      { id: "b", title: "Gateway", date: "2026-10-10", rag: "on", state: "active" },
      { id: "c", title: "Go-live", date: "2026-12-01", rag: "on", state: "planned" },
      { id: "z", title: "Dropped", date: "2026-10-05", rag: "risk", state: "planned" },
    ],
  };
  it("lists done, slipped, added and removed items and the RAG change", () => {
    const d = reviewDiff(entries, snap, TODAY);
    expect(d.done.map((x) => x.id)).toEqual(["a"]);
    expect(d.slipped).toEqual([{ entry: entries[1], days: 12 }]);
    expect(d.added.map((x) => x.id)).toEqual(["d"]);
    expect(d.removed.map((x) => x.id)).toEqual(["z"]);
    expect(d.ragChanges).toEqual([{ entry: entries[1], from: "on", to: "risk" }]);
    expect(d.before).toBe("risk");
    expect(d.after).toBe("risk");
  });
  it("compares with the latest review before the as-of date", () => {
    const tl = { snapshots: [snap, { ...snap, id: "s2", at: "2026-10-01" }, { ...snap, id: "s0", at: "2026-09-01" }] };
    expect(lastReview(tl, "2026-10-01")?.id).toBe("s1");
    expect(lastReview(tl, "2026-10-02")?.id).toBe("s2");
    expect(lastReview({ snapshots: [] }, TODAY)).toBeUndefined();
  });
  it("snapshots carry date, rag and state per item", () => {
    const items = snapshotItems(entries, TODAY);
    expect(items[1]).toEqual({ id: "b", title: "Gateway", date: "2026-10-22", rag: "risk", state: "active" });
  });
  it("writes a headline from the numbers", () => {
    expect(autoHeadline(entries, [{ id: "k", decision: "Approve vendor", neededBy: "2026-10-15" }], TODAY, t)).toBe("2 of 3 open milestones on track · 1 at risk · 1 decisions needed by 15 Oct");
    expect(autoHeadline([], [], TODAY, t)).toBe("Nothing marked for management yet");
  });
});

describe("slide layout", () => {
  const entries: TimelineEntry[] = [
    e({ id: "a", title: "Kickoff", start: "2026-09-12", group: "Tenancy", kind: "milestone" }),
    e({ id: "b", title: "Gateway", start: "2026-10-01", end: "2026-10-22", baseline: "2026-10-10", group: "Identity" }),
    e({ id: "c", title: "Go-live", start: "2026-12-01", kind: "milestone", baseline: "2026-11-10", group: "Platform" }),
    { id: "x", title: "Engineering only", start: "2026-10-03", group: "Ops" },
  ];
  it("snaps the window to whole months and keeps at least a quarter", () => {
    const d = slideDomain(execEntries({ entries }), TODAY);
    expect(d.start.getDate()).toBe(1);
    expect(d.start.getMonth()).toBe(8);
    expect(d.end.getMonth()).toBe(11);
    const short = slideDomain([e({ id: "s", title: "s", start: "2026-10-05" })], TODAY);
    expect(short.end.getTime() - short.start.getTime()).toBeGreaterThan(84 * 86400000);
  });
  it("draws only executive items, one lane per group, with baseline ghosts and slip", () => {
    const l = layoutSlide({ entries }, { today: TODAY, measure: approxMeasure });
    expect(l.lanes.map((x) => x.group)).toEqual(["Tenancy", "Identity", "Platform"]);
    expect(l.bars).toHaveLength(1);
    expect(l.points).toHaveLength(2);
    expect(l.hidden).toBe(0);
    const gw = l.bars[0];
    expect(gw.slip).toBe(12);
    expect(gw.baselineX).not.toBeNull();
    expect(gw.baselineX!).toBeLessThan(gw.x + gw.width);
    const gl = l.points.find((p) => p.entry.id === "c")!;
    expect(gl.slip).toBe(21);
    expect(gl.rag).toBe("off");
    expect(l.lanes[2].rag).toBe("off");
    expect(l.lanes[1].rag).toBe("risk");
    expect(l.todayX).not.toBeNull();
    for (const lane of l.lanes) expect(lane.y + lane.height).toBeLessThanOrEqual(l.bodyBottom + 0.5);
  });
  it("folds extra groups into Other and caps the item count", () => {
    const many: TimelineEntry[] = Array.from({ length: 15 }, (_, i) => e({ id: `m${i}`, title: `Item ${i}`, start: `2026-10-${String(1 + i).padStart(2, "0")}`, group: `G${i}` }));
    const l = layoutSlide({ entries: many }, { today: TODAY, measure: approxMeasure });
    expect(l.hidden).toBe(3);
    expect(l.lanes).toHaveLength(5);
    expect(l.lanes[4].group).toBe("Other");
  });
  it("shrinks type and rows so five busy lanes still fit above the footer", () => {
    const busy: TimelineEntry[] = [];
    for (let g = 0; g < 5; g++) {
      busy.push(e({ id: `b${g}`, title: `Phase ${g} with a long name`, start: "2026-10-01", end: "2026-11-15", group: `Lane ${g}` }));
      busy.push(e({ id: `p${g}`, title: `Milestone ${g}`, start: "2026-10-20", kind: "milestone", group: `Lane ${g}` }));
    }
    const l = layoutSlide({ entries: busy }, { today: TODAY, measure: approxMeasure });
    expect(l.lanes).toHaveLength(5);
    expect(l.fontSize).toBeLessThan(26);
    for (const lane of l.lanes) expect(lane.y + lane.height).toBeLessThanOrEqual(l.bodyBottom + 0.5);
    for (const b of l.bars) expect(b.y + b.height).toBeLessThanOrEqual(l.bodyBottom);
    for (const p of l.points) expect(p.y).toBeLessThanOrEqual(l.bodyBottom);
  });
  it("puts a bar's label before it when the window ends right after the bar", () => {
    const l = layoutSlide(
      { entries: [e({ id: "x", title: "Quarter-end phase", start: "2026-12-10", end: "2026-12-31", group: "Platform" })], from: "2026-09-01", to: "2026-12-31" },
      { today: TODAY, measure: approxMeasure },
    );
    const bar = l.bars[0];
    expect(bar.labelInside).toBe(false);
    expect(bar.labelSide).toBe("left");
    expect(bar.label).toBe("Quarter-end phase");
    expect(bar.labelX).toBeLessThan(bar.x);
  });
  it("marks a lane's trend against the previous review", () => {
    const prev: TimelineSnapshot = { id: "p", at: "2026-09-17", items: [{ id: "b", title: "Gateway", date: "2026-10-10", rag: "on", state: "active" }] };
    const l = layoutSlide({ entries }, { today: TODAY, measure: approxMeasure, previous: prev });
    expect(l.lanes.find((x) => x.group === "Identity")?.trend).toBe("down");
    expect(l.lanes.find((x) => x.group === "Tenancy")?.trend).toBe("steady");
  });
});
