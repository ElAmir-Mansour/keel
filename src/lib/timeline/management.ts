import { addMonths, differenceInCalendarDays, endOfMonth, format, startOfMonth, startOfQuarter } from "date-fns";
import { parseYMD } from "@/lib/dates";
import { approxMeasure, packRows, placePoints, stateOf, type Measure } from "./layout";
import type { Rag, Timeline, TimelineAsk, TimelineEntry, TimelineEntryStatus, TimelineSnapshot } from "@/lib/types";

// The management view: the same timeline reduced to what a steering meeting
// needs. Executive items only, RAG computed from dates against a baseline
// (so the colour cannot be wished green), slippage drawn rather than
// narrated, a change strip against the last review, and the decisions
// leadership owes, with dates. Everything here is pure; the slide component
// only draws what comes out.

export const EXEC_LIMIT = 12;
export const LANE_LIMIT = 5;
/** Slip thresholds in days: up to RISK_DAYS late is amber, beyond is red. */
export const RISK_DAYS = 14;

export const RAG_RANK: Record<Rag, number> = { on: 0, risk: 1, off: 2 };

/** Executive items, in date order, capped at what fits on a slide. */
export function execEntries(tl: Pick<Timeline, "entries">) {
  return tl.entries.filter((e) => e.exec).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** The date a manager cares about: when it is (or was) due. */
export function dueOf(e: TimelineEntry) {
  return e.end ?? e.start;
}

/** Days late against the baseline; negative when ahead; null without a baseline. */
export function slipDays(e: TimelineEntry) {
  if (!e.baseline) return null;
  return differenceInCalendarDays(parseYMD(dueOf(e)), parseYMD(e.baseline));
}

/**
 * RAG from the facts: done is green; late against today is red; slipped past
 * the baseline is amber up to RISK_DAYS, red beyond; otherwise green. An
 * explicit `rag` overrides, which is why `why` exists next to it.
 */
export function ragOf(e: TimelineEntry, today: string): Rag {
  if (e.rag) return e.rag;
  const state = stateOf(e, today);
  if (state === "done") return "on";
  if (dueOf(e) < today) return "off";
  const slip = slipDays(e);
  if (slip === null || slip <= 0) return "on";
  return slip <= RISK_DAYS ? "risk" : "off";
}

export function worstRag(rags: Rag[]): Rag {
  return rags.reduce<Rag>((w, r) => (RAG_RANK[r] > RAG_RANK[w] ? r : w), "on");
}

export type Trend = "up" | "down" | "steady";

/** Which way an item moved since the last review: better, worse, or the same. */
export function trendOf(now: Rag, before?: Rag): Trend {
  if (!before) return "steady";
  if (RAG_RANK[now] < RAG_RANK[before]) return "up";
  if (RAG_RANK[now] > RAG_RANK[before]) return "down";
  return "steady";
}

export function snapshotItems(entries: TimelineEntry[], today: string): TimelineSnapshot["items"] {
  return entries.map((e) => ({ id: e.id, title: e.title, date: dueOf(e), rag: ragOf(e, today), state: stateOf(e, today) }));
}

/** The most recent review strictly before `asOf`, which is what "since last review" compares with. */
export function lastReview(tl: Pick<Timeline, "snapshots">, asOf: string) {
  return [...(tl.snapshots ?? [])].filter((s) => s.at < asOf).sort((a, b) => b.at.localeCompare(a.at))[0];
}

export interface ReviewDiff {
  since: string;
  done: TimelineEntry[];
  slipped: { entry: TimelineEntry; days: number }[];
  pulledIn: { entry: TimelineEntry; days: number }[];
  added: TimelineEntry[];
  removed: TimelineSnapshot["items"];
  ragChanges: { entry: TimelineEntry; from: Rag; to: Rag }[];
  before: Rag;
  after: Rag;
}

export function reviewDiff(entries: TimelineEntry[], snap: TimelineSnapshot, today: string): ReviewDiff {
  const was = new Map(snap.items.map((i) => [i.id, i]));
  const now = new Map(entries.map((e) => [e.id, e]));
  const done: TimelineEntry[] = [];
  const slipped: ReviewDiff["slipped"] = [];
  const pulledIn: ReviewDiff["pulledIn"] = [];
  const added: TimelineEntry[] = [];
  const ragChanges: ReviewDiff["ragChanges"] = [];
  for (const e of entries) {
    const b = was.get(e.id);
    if (!b) {
      added.push(e);
      continue;
    }
    const state = stateOf(e, today);
    if (state === "done" && b.state !== "done") done.push(e);
    const delta = differenceInCalendarDays(parseYMD(dueOf(e)), parseYMD(b.date));
    if (delta > 0 && state !== "done") slipped.push({ entry: e, days: delta });
    if (delta < 0 && state !== "done") pulledIn.push({ entry: e, days: -delta });
    const rag = ragOf(e, today);
    if (rag !== b.rag) ragChanges.push({ entry: e, from: b.rag, to: rag });
  }
  const removed = snap.items.filter((i) => !now.has(i.id));
  return {
    since: snap.at,
    done,
    slipped,
    pulledIn,
    added,
    removed,
    ragChanges,
    before: worstRag(snap.items.map((i) => i.rag)),
    after: worstRag(entries.map((e) => ragOf(e, today))),
  };
}

/** A headline from the numbers, used when the lead has not written one. */
export function autoHeadline(entries: TimelineEntry[], asks: TimelineAsk[], today: string, t: (s: string, v?: Record<string, string | number>) => string) {
  if (!entries.length) return t("Nothing marked for management yet");
  const rags = entries.map((e) => ragOf(e, today));
  const open = entries.filter((e) => stateOf(e, today) !== "done");
  const onTrack = open.filter((e) => ragOf(e, today) === "on").length;
  const late = rags.filter((r) => r === "off").length;
  const risk = rags.filter((r) => r === "risk").length;
  const pendingAsks = asks.filter((a) => !a.done);
  const parts: string[] = [];
  if (!open.length) parts.push(t("Everything on this timeline is complete"));
  else if (!late && !risk) parts.push(t("All {n} open milestones on track", { n: open.length }));
  else parts.push(t("{on} of {n} open milestones on track", { on: onTrack, n: open.length }));
  if (late) parts.push(t(late === 1 ? "{n} off track" : "{n} off track", { n: late }));
  if (risk) parts.push(t("{n} at risk", { n: risk }));
  if (pendingAsks.length) {
    const soonest = pendingAsks.map((a) => a.neededBy).filter(Boolean).sort()[0];
    parts.push(soonest ? t("{n} decisions needed by {date}", { n: pendingAsks.length, date: format(parseYMD(soonest), "d MMM") }) : t("{n} decisions needed", { n: pendingAsks.length }));
  }
  return parts.join(" · ");
}

// ----- slide layout -----------------------------------------------------------

export const SLIDE_W = 1600;
export const SLIDE_H = 900;
const MARGIN = 48;
const LABEL_COL = 300;

export interface SlideBand {
  x: number;
  width: number;
  label: string;
  quarter?: boolean;
}
export interface SlideLane {
  group: string | null;
  y: number;
  height: number;
  rag: Rag;
  trend: Trend;
  index: number;
}
export interface SlideBar {
  entry: TimelineEntry;
  state: TimelineEntryStatus;
  rag: Rag;
  x: number;
  width: number;
  y: number;
  height: number;
  label: string;
  labelInside: boolean;
  labelX: number;
  baselineX: number | null;
  slip: number | null;
}
export interface SlidePoint {
  entry: TimelineEntry;
  state: TimelineEntryStatus;
  rag: Rag;
  shape: "dot" | "diamond";
  x: number;
  y: number;
  label: string;
  labelX: number;
  anchor: "start" | "end";
  baselineX: number | null;
  slip: number | null;
}

export interface SlideLayout {
  width: number;
  height: number;
  margin: number;
  labelCol: number;
  trackX: number;
  trackWidth: number;
  bodyTop: number;
  bodyBottom: number;
  axisY: number;
  domain: { start: Date; end: Date };
  bands: SlideBand[];
  months: { x: number; label: string }[];
  todayX: number | null;
  lanes: SlideLane[];
  bars: SlideBar[];
  points: SlidePoint[];
  hidden: number;
  fontSize: number;
  x: (d: Date) => number;
}

export interface SlideOptions {
  today: string;
  measure?: Measure;
  previous?: TimelineSnapshot;
  /** Height reserved for the header above the body. */
  headerHeight?: number;
  /** Height reserved for the footer (legend and asks) below the body. */
  footerHeight?: number;
}

/** Window for the slide: executive items and their baselines, snapped to whole months, today included. */
export function slideDomain(entries: TimelineEntry[], today: string, fixed?: { from?: string; to?: string }) {
  const dates = entries.flatMap((e) => [e.start, dueOf(e), e.baseline ?? e.start]);
  if (!fixed?.from && !fixed?.to) dates.push(today);
  const min = fixed?.from ?? (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today);
  const max = fixed?.to ?? (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : today);
  let start = startOfMonth(parseYMD(min));
  let end = endOfMonth(parseYMD(max));
  // At least three months, so a short plan still reads as a timeline.
  while (differenceInCalendarDays(end, start) < 85) {
    end = endOfMonth(addMonths(end, 1));
    if (differenceInCalendarDays(end, start) < 85) start = startOfMonth(addMonths(start, -1));
  }
  return { start, end };
}

interface Preset {
  fontSize: number;
  barH: number;
  barRowH: number;
  pointRowH: number;
  lanePad: number;
}
/** Type and row sizes, largest first; the layout takes the first that fits the body. */
const PRESETS: Preset[] = [
  { fontSize: 26, barH: 34, barRowH: 48, pointRowH: 46, lanePad: 16 },
  { fontSize: 23, barH: 28, barRowH: 40, pointRowH: 38, lanePad: 12 },
  { fontSize: 20, barH: 24, barRowH: 34, pointRowH: 32, lanePad: 8 },
];

/** Width a slip label takes after an item's title, at the slide's small label size. */
export function slipLabel(slip: number | null) {
  return slip ? `${slip > 0 ? "+" : "−"}${Math.abs(slip)}d` : "";
}

export function layoutSlide(tl: Pick<Timeline, "entries" | "from" | "to">, opts: SlideOptions): SlideLayout {
  const measure = opts.measure ?? approxMeasure;
  const headerHeight = opts.headerHeight ?? 196;
  const footerHeight = opts.footerHeight ?? 172;
  const all = execEntries(tl);
  const entries = all.slice(0, EXEC_LIMIT);
  const hidden = all.length - entries.length;
  const domain = slideDomain(entries, opts.today, { from: tl.from, to: tl.to });
  const trackX = MARGIN + LABEL_COL;
  const trackWidth = SLIDE_W - MARGIN - trackX;
  const spanMs = Math.max(1, domain.end.getTime() - domain.start.getTime());
  const x = (d: Date) => trackX + ((d.getTime() - domain.start.getTime()) / spanMs) * trackWidth;
  const clampX = (d: Date) => Math.max(trackX, Math.min(trackX + trackWidth, x(d)));
  const xOf = (ymd: string) => clampX(parseYMD(ymd));

  // Axis: month ticks, quarter bands (or year bands beyond two years).
  const months: { x: number; label: string }[] = [];
  for (let d = startOfMonth(domain.start); d <= domain.end; d = addMonths(d, 1)) {
    months.push({ x: x(d), label: format(d, differenceInCalendarDays(domain.end, domain.start) > 400 ? "MMM yy" : "MMM") });
  }
  const bands: SlideBand[] = [];
  for (let q = startOfQuarter(domain.start); q <= domain.end; q = addMonths(q, 3)) {
    const x0 = Math.max(trackX, x(q));
    const x1 = Math.min(trackX + trackWidth, x(addMonths(q, 3)));
    if (x1 - x0 < 4) continue;
    bands.push({ x: x0, width: x1 - x0, label: `Q${Math.floor(q.getMonth() / 3) + 1} ${format(q, "yyyy")}`, quarter: true });
  }
  const todayD = parseYMD(opts.today);
  const todayX = todayD >= domain.start && todayD <= domain.end ? x(todayD) : null;

  const bodyTop = headerHeight;
  const axisY = bodyTop + 54;
  const bodyBottom = SLIDE_H - footerHeight;

  // Lanes by group, worst RAG wins, at most LANE_LIMIT; extra groups fold into "Other".
  const groups: (string | null)[] = [];
  for (const e of entries) {
    const g = e.group ?? null;
    if (!groups.includes(g)) groups.push(g);
  }
  const laneGroups = groups.length > LANE_LIMIT ? [...groups.slice(0, LANE_LIMIT - 1), "__other"] : groups;
  const laneOf = (e: TimelineEntry) => {
    const g = e.group ?? null;
    return laneGroups.includes(g) ? g : "__other";
  };
  const prevRag = new Map((opts.previous?.items ?? []).map((i) => [i.id, i.rag]));
  const maxLabel = 360;
  const available = bodyBottom - (axisY + 12);

  // Pack every lane at one size preset; fall back to smaller type when the
  // rows would not fit the body, and as a last resort squeeze the rows.
  const pack = (ps: Preset) => {
    const { fontSize, barH, barRowH, pointRowH, lanePad } = ps;
    const laneNeeds: { group: string | null; bars: SlideBar[]; points: SlidePoint[]; barRows: number; pointRows: number }[] = [];
    for (const g of laneGroups) {
      const mine = entries.filter((e) => laneOf(e) === g);
      const ranged = mine.filter((e) => e.end);
      const barItems = ranged.map((e) => {
        const x0 = xOf(e.start);
        const x1 = clampX(parseYMD(e.end!));
        const w = Math.max(10, x1 - x0);
        const glyph = ragOf(e, opts.today) === "on" ? 0 : 24;
        const inside = measure(e.title, fontSize) + 24 + glyph <= w;
        const room = trackX + trackWidth - (x0 + w) - 12 - glyph;
        const label = inside ? e.title : truncateLabel(e.title, Math.min(maxLabel, Math.max(40, room)), measure, fontSize);
        const slip = slipDays(e);
        const baselineX = e.baseline && slip ? xOf(e.baseline) : null;
        const slipW = slip ? measure(slipLabel(slip), 22) + 14 : 0;
        const right = Math.max(inside ? x0 + w : x0 + w + 12 + glyph + measure(label, fontSize), baselineX ?? 0) + slipW;
        return { e, x0, w, inside, label, slip, baselineX, left: Math.min(x0, baselineX ?? x0), right };
      });
      const barRows = packRows(barItems, 12);
      const laneBars: SlideBar[] = barItems.map((it, i) => ({
        entry: it.e,
        state: stateOf(it.e, opts.today),
        rag: ragOf(it.e, opts.today),
        x: it.x0,
        width: it.w,
        y: barRows[i] * barRowH,
        height: barH,
        label: it.label,
        labelInside: it.inside,
        labelX: it.inside ? it.x0 + 12 : it.x0 + it.w + 12,
        baselineX: it.baselineX,
        slip: it.slip,
      }));
      const pts = mine.filter((e) => !e.end);
      const placed = placePoints(
        pts.map((e) => ({ e, px: xOf(e.start) })),
        {
          width: trackX + trackWidth + 10,
          maxLabel,
          measure,
          fontSize,
          gap: 10,
          // The RAG glyph before the label and the slip figure after it take room too.
          extraWidth: (e) => (ragOf(e, opts.today) === "on" ? 0 : 24) + (slipDays(e) ? measure(slipLabel(slipDays(e)), 22) + 12 : 0),
        },
      );
      const lanePoints: SlidePoint[] = placed.map((it) => {
        const slip = slipDays(it.e);
        return {
          entry: it.e,
          state: stateOf(it.e, opts.today),
          rag: ragOf(it.e, opts.today),
          shape: it.e.kind === "milestone" ? "diamond" : "dot",
          x: it.px,
          y: it.row * pointRowH + pointRowH / 2,
          label: it.label,
          labelX: it.anchor === "start" ? it.px + 22 : it.px - 22,
          anchor: it.anchor,
          baselineX: it.e.baseline && slip ? xOf(it.e.baseline) : null,
          slip,
        };
      });
      laneNeeds.push({ group: g === "__other" ? "Other" : g, bars: laneBars, points: lanePoints, barRows: barRows.length ? Math.max(...barRows) + 1 : 0, pointRows: placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0 });
    }
    const needed = laneNeeds.map((l) => lanePad + l.barRows * barRowH + l.pointRows * pointRowH + lanePad);
    return { ps, laneNeeds, needed, total: needed.reduce((a, b) => a + b, 0) };
  };
  let packed = pack(PRESETS[0]);
  for (const ps of PRESETS.slice(1)) {
    if (packed.total <= available) break;
    packed = pack(ps);
  }
  const squeeze = packed.total > available ? available / packed.total : 1;
  const { fontSize, barRowH, pointRowH } = packed.ps;
  const bars: SlideBar[] = [];
  const points: SlidePoint[] = [];

  // Lane heights: what the rows need, then share the leftover space evenly.
  const needed = packed.needed.map((n) => n * squeeze);
  const extra = Math.max(0, available - needed.reduce((a, b) => a + b, 0));
  const share = packed.laneNeeds.length ? extra / packed.laneNeeds.length : 0;
  const lanes: SlideLane[] = [];
  let y = axisY + 12;
  packed.laneNeeds.forEach((l, i) => {
    const height = needed[i] + share;
    const inner = (l.barRows * barRowH + l.pointRows * pointRowH) * squeeze;
    const offset = y + (height - inner) / 2;
    for (const b of l.bars) bars.push({ ...b, y: offset + b.y * squeeze, height: Math.min(b.height, Math.max(18, b.height * squeeze)) });
    for (const p of l.points) points.push({ ...p, y: offset + (l.barRows * barRowH + p.y) * squeeze });
    const mine = entries.filter((e) => (laneOf(e) === "__other" ? "Other" : laneOf(e)) === l.group);
    const rag = worstRag(mine.map((e) => ragOf(e, opts.today)));
    const before = opts.previous ? worstRag(mine.map((e) => prevRag.get(e.id)).filter((r): r is Rag => Boolean(r))) : undefined;
    lanes.push({ group: l.group, y, height, rag, trend: opts.previous && mine.some((e) => prevRag.has(e.id)) ? trendOf(rag, before) : "steady", index: i });
    y += height;
  });

  return { width: SLIDE_W, height: SLIDE_H, margin: MARGIN, labelCol: LABEL_COL, trackX, trackWidth, bodyTop, bodyBottom, axisY, domain, bands, months, todayX, lanes, bars, points, hidden, fontSize, x };
}

function truncateLabel(text: string, max: number, measure: Measure, size: number) {
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
