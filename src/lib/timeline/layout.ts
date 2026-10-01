import { addDays, addMonths, differenceInCalendarDays, eachWeekOfInterval, format, startOfMonth, startOfQuarter, startOfYear } from "date-fns";
import { parseYMD } from "@/lib/dates";
import type { Timeline, TimelineEntry, TimelineEntryStatus } from "@/lib/types";

// Pure layout for the timeline chart. Given entries, a width and today's
// date it returns positioned shapes: a two-tier time axis, one lane per group,
// range bars packed into rows, point markers whose labels never overlap, and
// the today line. The component only draws what comes out; the export clones
// the same SVG, so there is one layout for screen, PNG and PDF.

export type Measure = (text: string, fontSize: number) => number;

/** Rough text width when no canvas is available (tests, server). */
export const approxMeasure: Measure = (text, size) => {
  let w = 0;
  for (const ch of text) w += /[؀-ۿ]/.test(ch) ? 0.5 : /[A-Z0-9]/.test(ch) ? 0.62 : ch === " " ? 0.3 : 0.53;
  return w * size;
};

export interface LayoutOptions {
  width: number;
  today: string; // YYYY-MM-DD
  measure?: Measure;
  /** Narrower rows and smaller type for small cards. */
  compact?: boolean;
}

export interface Tick {
  x: number;
  label: string;
}
export interface Band {
  x: number;
  width: number;
  label: string;
}
export interface LaneBox {
  group: string | null;
  y: number;
  height: number;
  index: number;
}
export interface BarShape {
  entry: TimelineEntry;
  state: TimelineEntryStatus;
  x: number;
  width: number;
  y: number;
  height: number;
  label: string;
  labelInside: boolean;
  labelX: number;
}
export interface PointShape {
  entry: TimelineEntry;
  state: TimelineEntryStatus;
  shape: "dot" | "diamond";
  x: number;
  y: number;
  label: string;
  labelX: number;
  anchor: "start" | "end";
}

export interface TimelineLayout {
  width: number;
  height: number;
  /** Entries left out because they fall outside the fixed window. */
  hidden: number;
  axisHeight: number;
  domain: { start: Date; end: Date };
  bands: Band[];
  ticks: Tick[];
  todayX: number | null;
  lanes: LaneBox[];
  bars: BarShape[];
  points: PointShape[];
  fontSize: number;
  x: (d: Date) => number;
}

export const PAD_X = 10;

/** done / active / planned from the dates, unless the entry says otherwise. */
export function stateOf(e: TimelineEntry, today: string): TimelineEntryStatus {
  if (e.status) return e.status;
  const end = e.end ?? e.start;
  if (end < today) return "done";
  if (e.start <= today) return e.end ? "active" : "done";
  return "planned";
}

/** The date window: entries, today when it is near them, and a little air at both ends. */
export function computeDomain(tl: Pick<Timeline, "entries" | "from" | "to">, today: string) {
  const dates = tl.entries.flatMap((e) => [e.start, e.end ?? e.start]);
  let min = tl.from ?? (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today);
  let max = tl.to ?? (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : today);
  if (!tl.from && !tl.to) {
    const span = Math.max(1, differenceInCalendarDays(parseYMD(max), parseYMD(min)));
    const near = Math.max(45, Math.round(span * 0.5));
    const dToday = parseYMD(today);
    if (differenceInCalendarDays(parseYMD(min), dToday) > 0 && differenceInCalendarDays(parseYMD(min), dToday) <= near) min = today;
    if (differenceInCalendarDays(dToday, parseYMD(max)) > 0 && differenceInCalendarDays(dToday, parseYMD(max)) <= near) max = today;
  }
  let start = parseYMD(min);
  let end = parseYMD(max);
  let span = differenceInCalendarDays(end, start);
  if (span < 14) {
    const grow = Math.ceil((14 - span) / 2);
    start = addDays(start, -grow);
    end = addDays(end, grow);
    span = differenceInCalendarDays(end, start);
  }
  if (!tl.from) start = addDays(start, -Math.max(2, Math.round(span * 0.04)));
  if (!tl.to) end = addDays(end, Math.max(2, Math.round(span * 0.06)));
  return { start, end };
}

function unitFor(spanDays: number): "day" | "week" | "month" | "quarter" {
  if (spanDays <= 35) return "day";
  if (spanDays <= 220) return "week";
  if (spanDays <= 900) return "month";
  return "quarter";
}

/** Two-tier axis: coarse bands (months or years) and fine ticks (days, weeks, months or quarters). */
export function computeAxis(domain: { start: Date; end: Date }, x: (d: Date) => number, width: number, measure: Measure, fontSize: number) {
  const spanDays = differenceInCalendarDays(domain.end, domain.start);
  const unit = unitFor(spanDays);
  const ticks: Tick[] = [];
  const bands: Band[] = [];
  const left = PAD_X;
  const right = width - PAD_X;

  const push = (d: Date, label: string) => {
    const px = x(d);
    if (px >= left - 0.5 && px <= right + 0.5) ticks.push({ x: px, label });
  };
  if (unit === "day") {
    for (let d = domain.start; d <= domain.end; d = addDays(d, 1)) push(d, format(d, "d"));
  } else if (unit === "week") {
    for (const w of eachWeekOfInterval({ start: domain.start, end: domain.end }, { weekStartsOn: 1 })) push(w, format(w, "d MMM"));
  } else if (unit === "month") {
    for (let d = startOfMonth(domain.start); d <= domain.end; d = addMonths(d, 1)) push(d, format(d, "MMM"));
  } else {
    for (let d = startOfQuarter(domain.start); d <= domain.end; d = addMonths(d, 3)) push(d, `Q${Math.floor(d.getMonth() / 3) + 1}`);
  }
  // Thin the fine labels until neighbours do not touch.
  const need = Math.max(...ticks.map((t) => measure(t.label, fontSize)), 1) + 8;
  const gap = ticks.length > 1 ? ticks[1].x - ticks[0].x : Infinity;
  const every = Math.max(1, Math.ceil(need / gap));
  const thinned = ticks.map((t, i) => (i % every === 0 ? t : { ...t, label: "" }));

  const coarseMonths = unit === "day" || unit === "week";
  const starts: Date[] = [];
  if (coarseMonths) for (let d = startOfMonth(domain.start); d <= domain.end; d = addMonths(d, 1)) starts.push(d);
  else for (let d = startOfYear(domain.start); d <= domain.end; d = addMonths(d, 12)) starts.push(d);
  starts.forEach((s, i) => {
    const next = starts[i + 1] ?? addMonths(s, coarseMonths ? 1 : 12);
    const x0 = Math.max(left, x(s));
    const x1 = Math.min(right, x(next));
    if (x1 - x0 < 2) return;
    const full = coarseMonths ? format(s, "MMMM yyyy") : format(s, "yyyy");
    const short = coarseMonths ? format(s, "MMM yy") : format(s, "yyyy");
    const label = measure(full, fontSize) + 10 <= x1 - x0 ? full : measure(short, fontSize) + 6 <= x1 - x0 ? short : "";
    bands.push({ x: x0, width: x1 - x0, label });
  });
  return { ticks: thinned, bands, unit };
}

/** Greedy interval packing: the first row whose right edge is clear of the new left edge. */
export function packRows(items: { left: number; right: number }[], gap = 6): number[] {
  const rows: number[] = [];
  return items.map((it) => {
    let r = rows.findIndex((right) => right + gap <= it.left);
    if (r < 0) {
      r = rows.length;
      rows.push(-Infinity);
    }
    rows[r] = it.right;
    return r;
  });
}

/**
 * Point markers with labels, packed into rows. Each marker tries, in order:
 * label to the right in an existing row, label to the left in an existing
 * row, then a new row. Rows track occupied intervals, not just a right edge,
 * because a left-anchored label can sit before an earlier marker.
 */
export function placePoints<T>(items: { e: T; px: number }[], o: { width: number; maxLabel: number; measure: Measure; fontSize: number; gap?: number; extraWidth?: (e: T) => number }) {
  const gap = o.gap ?? 6;
  const r = 7;
  const extraOf = o.extraWidth ?? (() => 0);
  const rows: { left: number; right: number }[][] = [];
  const free = (row: { left: number; right: number }[], left: number, right: number) => row.every((iv) => right + gap <= iv.left || left - gap >= iv.right);
  const out: { e: T; px: number; row: number; anchor: "start" | "end"; label: string; r: number }[] = [];
  for (const it of [...items].sort((a, b) => a.px - b.px)) {
    const title = String((it.e as { title?: string }).title ?? "");
    const extra = extraOf(it.e);
    const full = o.measure(title, o.fontSize) + extra;
    const roomRight = o.width - PAD_X - (it.px + r + gap) - extra;
    const roomLeft = it.px - r - gap - PAD_X - extra;
    const sides: { anchor: "start" | "end"; room: number }[] = [
      { anchor: "start", room: roomRight },
      { anchor: "end", room: roomLeft },
    ];
    // A whole label beats a truncated one; then the lowest row; then the right side.
    let choice: { anchor: "start" | "end"; label: string; left: number; right: number; row: number; cut: boolean } | null = null;
    for (const side of sides) {
      if (side.room < 40 && side.room < full) continue;
      const label = truncate(title, Math.min(o.maxLabel, Math.max(24, side.room)), o.measure, o.fontSize);
      const cut = label !== title;
      const lw = o.measure(label, o.fontSize) + extra;
      const left = side.anchor === "start" ? it.px - r : it.px - r - gap - lw;
      const right = side.anchor === "start" ? it.px + r + gap + lw : it.px + r;
      const row = rows.findIndex((rw) => free(rw, left, right));
      if (row < 0) continue;
      const better = !choice || (choice.cut && !cut) || (choice.cut === cut && row < choice.row);
      if (better) choice = { anchor: side.anchor, label, left, right, row, cut };
    }
    // No row takes a whole label: open a new row for it rather than cutting it,
    // on whichever side has the room (the right when both do).
    if (!choice || choice.cut) {
      const side = sides.find((sd) => sd.room >= full) ?? (sides[0].room >= sides[1].room ? sides[0] : sides[1]);
      const label = truncate(title, Math.min(o.maxLabel, Math.max(24, side.room)), o.measure, o.fontSize);
      const lw = o.measure(label, o.fontSize) + extra;
      const left = side.anchor === "start" ? it.px - r : it.px - r - gap - lw;
      const right = side.anchor === "start" ? it.px + r + gap + lw : it.px + r;
      const cut = label !== title;
      if (!choice || (choice.cut && !cut)) {
        choice = { anchor: side.anchor, label, left, right, row: rows.length, cut };
        rows.push([]);
      }
    }
    rows[choice.row].push({ left: choice.left, right: choice.right });
    out.push({ e: it.e, px: it.px, row: choice.row, anchor: choice.anchor, label: choice.label, r });
  }
  return out;
}

function truncate(text: string, max: number, measure: Measure, size: number) {
  if (measure(text, size) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`, size) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 1 ? "…" : `${text.slice(0, lo).trimEnd()}…`;
}

export function layoutTimeline(tl: Pick<Timeline, "entries" | "from" | "to">, opts: LayoutOptions): TimelineLayout {
  const measure = opts.measure ?? approxMeasure;
  const compact = opts.compact ?? false;
  const fontSize = compact ? 11 : 12;
  const barH = compact ? 16 : 20;
  const barRowH = barH + 8;
  const pointRowH = compact ? 20 : 24;
  const laneHeader = compact ? 18 : 22;
  const lanePad = 10;
  const axisHeight = compact ? 34 : 40;
  const width = Math.max(240, opts.width);
  const domain = computeDomain(tl, opts.today);
  const spanMs = Math.max(1, domain.end.getTime() - domain.start.getTime());
  const inner = width - PAD_X * 2;
  const x = (d: Date) => PAD_X + ((d.getTime() - domain.start.getTime()) / spanMs) * inner;
  const xOf = (ymd: string) => x(parseYMD(ymd));
  const maxLabel = Math.min(260, Math.max(120, inner * 0.42));

  const { ticks, bands } = computeAxis(domain, x, width, measure, fontSize - 1);
  const todayD = parseYMD(opts.today);
  const todayX = todayD >= domain.start && todayD <= domain.end ? x(todayD) : null;

  // With a fixed window, entries outside it stay in the story but leave the chart,
  // rather than piling up on the edge and reading as if they happened there.
  const lo = tl.from ? parseYMD(tl.from) : null;
  const hi = tl.to ? parseYMD(tl.to) : null;
  const visible = tl.entries.filter((e) => (!hi || parseYMD(e.start) <= hi) && (!lo || parseYMD(e.end ?? e.start) >= lo));
  const hidden = tl.entries.length - visible.length;

  // Lanes in first-appearance order by date; ungrouped entries share one lane.
  const sorted = [...visible].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const groupNames: (string | null)[] = [];
  for (const e of sorted) {
    const g = e.group ?? null;
    if (!groupNames.includes(g)) groupNames.push(g);
  }
  const hasGroups = groupNames.some((g) => g !== null);

  const lanes: LaneBox[] = [];
  const bars: BarShape[] = [];
  const points: PointShape[] = [];
  let y = axisHeight;
  groupNames.forEach((g, gi) => {
    const mine = sorted.filter((e) => (e.group ?? null) === g);
    const laneTop = y;
    let cursor = laneTop + (hasGroups ? laneHeader : 0) + lanePad / 2;

    const ranged = mine.filter((e) => e.end);
    const barItems = ranged.map((e) => {
      const x0 = Math.max(PAD_X, Math.min(width - PAD_X, xOf(e.start)));
      const x1 = Math.max(PAD_X, Math.min(width - PAD_X, x(addDays(parseYMD(e.end!), 1))));
      const w = Math.max(6, x1 - x0);
      const full = e.title;
      const inside = measure(full, fontSize) + 14 <= w;
      const outsideRoom = width - PAD_X - (x0 + w) - 8;
      const label = inside ? full : truncate(full, Math.min(maxLabel, Math.max(24, outsideRoom)), measure, fontSize);
      const right = inside ? x0 + w : x0 + w + 8 + measure(label, fontSize);
      return { e, x0, w, inside, label, left: x0, right };
    });
    const barRows = packRows(barItems);
    const barRowCount = barRows.length ? Math.max(...barRows) + 1 : 0;
    barItems.forEach((it, i) => {
      bars.push({
        entry: it.e,
        state: stateOf(it.e, opts.today),
        x: it.x0,
        width: it.w,
        y: cursor + barRows[i] * barRowH,
        height: barH,
        label: it.label,
        labelInside: it.inside,
        labelX: it.inside ? it.x0 + 7 : it.x0 + it.w + 8,
      });
    });
    cursor += barRowCount * barRowH;

    const pts = mine.filter((e) => !e.end);
    const placed = placePoints(
      pts.map((e) => ({ e, px: Math.max(PAD_X, Math.min(width - PAD_X, xOf(e.start))) })),
      { width, maxLabel, measure, fontSize },
    );
    const ptRowCount = placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0;
    for (const it of placed) {
      points.push({
        entry: it.e,
        state: stateOf(it.e, opts.today),
        shape: it.e.kind === "milestone" ? "diamond" : "dot",
        x: it.px,
        y: cursor + it.row * pointRowH + pointRowH / 2,
        label: it.label,
        labelX: it.anchor === "start" ? it.px + it.r + 6 : it.px - it.r - 6,
        anchor: it.anchor,
      });
    }
    cursor += ptRowCount * pointRowH;

    const height = Math.max(cursor + lanePad / 2 - laneTop, hasGroups ? laneHeader + pointRowH : pointRowH);
    lanes.push({ group: g, y: laneTop, height, index: gi });
    y = laneTop + height;
  });

  if (!lanes.length) {
    lanes.push({ group: null, y, height: pointRowH * 2, index: 0 });
    y += pointRowH * 2;
  }

  return { width, height: y + 8, hidden, axisHeight, domain, bands, ticks, todayX, lanes, bars, points, fontSize, x };
}

/** Entries split for the story under the chart: what happened, what is happening, what comes next. */
export function splitByState(entries: TimelineEntry[], today: string) {
  const done: TimelineEntry[] = [];
  const active: TimelineEntry[] = [];
  const planned: TimelineEntry[] = [];
  for (const e of entries) {
    const s = stateOf(e, today);
    (s === "done" ? done : s === "active" ? active : planned).push(e);
  }
  const byStart = (a: TimelineEntry, b: TimelineEntry) => a.start.localeCompare(b.start);
  done.sort((a, b) => (b.end ?? b.start).localeCompare(a.end ?? a.start));
  active.sort(byStart);
  planned.sort(byStart);
  return { done, active, planned };
}
