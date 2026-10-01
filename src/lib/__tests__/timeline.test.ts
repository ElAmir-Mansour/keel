import { describe, expect, it } from "vitest";
import { parseDateToken, parseTimelineText, timelineToText } from "../timeline/text";
import { approxMeasure, computeDomain, layoutTimeline, packRows, placePoints, splitByState, stateOf } from "../timeline/layout";
import type { TimelineEntry } from "../types";

const today = new Date(2026, 9, 1); // 1 Oct 2026
const TODAY = "2026-10-01";

describe("parseDateToken", () => {
  it("reads ISO days, months, years and quarters", () => {
    expect(parseDateToken("2026-09-12", today)).toMatchObject({ day: true });
    expect(parseDateToken("2026-09", today)?.end.getDate()).toBe(30);
    expect(parseDateToken("2026", today)?.end.getMonth()).toBe(11);
    expect(parseDateToken("Q4 2026", today)?.start.getMonth()).toBe(9);
  });
  it("reads casual month names with the current year by default", () => {
    const a = parseDateToken("Sep 12", today)!;
    expect([a.start.getFullYear(), a.start.getMonth(), a.start.getDate()]).toEqual([2026, 8, 12]);
    const b = parseDateToken("12 September 2025", today)!;
    expect(b.start.getFullYear()).toBe(2025);
    expect(parseDateToken("Sep", today)?.day).toBe(false);
    expect(parseDateToken("Feb 30", today)).toBeNull();
    expect(parseDateToken("someday", today)).toBeNull();
  });
});

describe("parseTimelineText", () => {
  it("parses events, ranges, groups, milestones, tags, links and notes", () => {
    const text = [
      "## Design",
      "2026-09-12: Kickoff",
      "2026-09 / 2026-10: Discovery",
      "Sep 20 – Oct 3: Wireframes #ux",
      "2026-10-15: !Launch [[PLAT-12]]",
      "> Big day.",
      "> Second line.",
      "endgroup",
      "Nov 10: Retro #done",
      "nonsense line",
    ].join("\n");
    const r = parseTimelineText(text, today);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(10);
    const e = r.entries.map((x) => x.entry);
    expect(e[0]).toMatchObject({ title: "Kickoff", start: "2026-09-12", group: "Design" });
    expect(e[0].end).toBeUndefined();
    expect(e[1]).toMatchObject({ title: "Discovery", start: "2026-09-01", end: "2026-10-31", group: "Design" });
    expect(e[2]).toMatchObject({ title: "Wireframes", start: "2026-09-20", end: "2026-10-03", group: "ux" });
    expect(e[3]).toMatchObject({ title: "Launch", kind: "milestone", link: "PLAT-12", note: "Big day.\nSecond line." });
    expect(e[4]).toMatchObject({ title: "Retro", start: "2026-11-10", status: "done" });
    expect(e[4].group).toBeUndefined();
  });
  it("rolls a month range over the year end and reads the year from the end token", () => {
    const r = parseTimelineText("Nov – Feb: Winter", today);
    expect(r.entries[0].entry).toMatchObject({ start: "2026-11-01", end: "2027-02-28" });
    const r2 = parseTimelineText("2026-12-20 - 2027-01-05: Freeze", today);
    expect(r2.entries[0].entry).toMatchObject({ start: "2026-12-20", end: "2027-01-05" });
  });
  it("round-trips through timelineToText", () => {
    const entries: TimelineEntry[] = [
      { id: "a", title: "Kickoff", start: "2026-09-12", group: "Design" },
      { id: "b", title: "Discovery", start: "2026-09-01", end: "2026-10-31", group: "Design", note: "Two\nlines" },
      { id: "c", title: "Launch", start: "2026-10-15", kind: "milestone", link: "PLAT-12", status: "planned" },
    ];
    const text = timelineToText(entries);
    const back = parseTimelineText(text, today).entries.map((x) => x.entry);
    expect(back).toHaveLength(3);
    for (const e of entries) {
      const { id: _id, ...rest } = e;
      void _id;
      expect(back).toContainEqual(rest);
    }
  });
});

describe("stateOf and splitByState", () => {
  it("derives state from the dates and honours an override", () => {
    expect(stateOf({ id: "1", title: "a", start: "2026-09-01" }, TODAY)).toBe("done");
    expect(stateOf({ id: "1", title: "a", start: "2026-09-01", end: "2026-10-20" }, TODAY)).toBe("active");
    expect(stateOf({ id: "1", title: "a", start: "2026-10-01" }, TODAY)).toBe("done");
    expect(stateOf({ id: "1", title: "a", start: "2026-10-02" }, TODAY)).toBe("planned");
    expect(stateOf({ id: "1", title: "a", start: "2026-09-01", status: "planned" }, TODAY)).toBe("planned");
  });
  it("orders what happened newest first and what is next soonest first", () => {
    const s = splitByState(
      [
        { id: "1", title: "old", start: "2026-08-01" },
        { id: "2", title: "older", start: "2026-07-01" },
        { id: "3", title: "later", start: "2026-12-01" },
        { id: "4", title: "soon", start: "2026-10-05" },
      ],
      TODAY,
    );
    expect(s.done.map((e) => e.title)).toEqual(["old", "older"]);
    expect(s.planned.map((e) => e.title)).toEqual(["soon", "later"]);
  });
});

describe("layout", () => {
  const entries: TimelineEntry[] = [
    { id: "1", title: "Discovery", start: "2026-09-01", end: "2026-09-30", group: "Design" },
    { id: "2", title: "Wireframes", start: "2026-09-20", end: "2026-10-10", group: "Design" },
    { id: "3", title: "Kickoff", start: "2026-09-12", group: "Design" },
    { id: "4", title: "Kickoff follow-up meeting", start: "2026-09-13", group: "Design" },
    { id: "5", title: "Launch", start: "2026-12-01", kind: "milestone" },
  ];
  it("packs overlapping intervals into separate rows", () => {
    expect(packRows([{ left: 0, right: 100 }, { left: 50, right: 150 }, { left: 120, right: 200 }])).toEqual([0, 1, 0]);
  });
  it("includes today in the domain and pads both ends", () => {
    const d = computeDomain({ entries }, TODAY);
    expect(d.start.getTime()).toBeLessThan(new Date(2026, 8, 1).getTime());
    expect(d.end.getTime()).toBeGreaterThan(new Date(2026, 11, 1).getTime());
  });
  it("positions everything inside the width and keeps labels apart", () => {
    const l = layoutTimeline({ entries }, { width: 800, today: TODAY, measure: approxMeasure });
    expect(l.lanes.map((x) => x.group)).toEqual(["Design", null]);
    expect(l.bars).toHaveLength(2);
    expect(l.points).toHaveLength(3);
    expect(l.todayX).not.toBeNull();
    for (const b of l.bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(800);
    }
    // Overlapping bars take different rows.
    expect(l.bars[0].y).not.toBe(l.bars[1].y);
    // Two events a day apart cannot share a row at this width.
    const [k1, k2] = l.points.filter((p) => p.entry.group === "Design");
    expect(k1.y).not.toBe(k2.y);
    expect(l.points.find((p) => p.entry.id === "5")?.shape).toBe("diamond");
    expect(l.height).toBeGreaterThan(l.axisHeight);
    expect(l.bands.length).toBeGreaterThan(0);
    expect(l.ticks.some((t) => t.label)).toBe(true);
  });
  it("leaves entries outside a fixed window out of the chart and counts them", () => {
    const l = layoutTimeline({ entries, from: "2026-09-01", to: "2026-10-31" }, { width: 800, today: TODAY });
    expect(l.hidden).toBe(1);
    expect(l.points.find((p) => p.entry.id === "5")).toBeUndefined();
    expect(l.lanes.map((x) => x.group)).toEqual(["Design"]);
  });
  it("puts a label on the left when the right side has no room", () => {
    const items = [
      { e: { title: "First" }, px: 100 },
      { e: { title: "Second label" }, px: 380 },
    ];
    const placed = placePoints(items, { width: 400, maxLabel: 200, measure: approxMeasure, fontSize: 12 });
    expect(placed.map((p) => p.row)).toEqual([0, 0]);
    expect(placed.map((p) => p.anchor)).toEqual(["start", "end"]);
    const crowded = placePoints(
      [
        { e: { title: "A long label here" }, px: 100 },
        { e: { title: "Another long label" }, px: 104 },
        { e: { title: "Third long label" }, px: 108 },
      ],
      { width: 400, maxLabel: 200, measure: approxMeasure, fontSize: 12 },
    );
    expect(new Set(crowded.map((p) => p.row)).size).toBeGreaterThan(1);
  });
  it("renders an empty timeline with a single empty lane", () => {
    const l = layoutTimeline({ entries: [] }, { width: 600, today: TODAY });
    expect(l.lanes).toHaveLength(1);
    expect(l.height).toBeGreaterThan(0);
  });
});
