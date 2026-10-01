"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { approxMeasure, layoutTimeline, type Measure, type TimelineLayout } from "@/lib/timeline/layout";
import type { Timeline, TimelineEntry, TimelineEntryStatus } from "@/lib/types";

// The timeline drawn as one SVG. Colour carries state (done / active /
// planned, three steps of one hue so it survives print and colour blindness),
// lanes carry category, shape carries kind: bars for ranges, diamonds for
// milestones, dots for events. The same SVG is cloned for PNG, SVG and PDF
// export, so nothing here depends on HTML outside the element.

export const STATE_FILL: Record<TimelineEntryStatus, string> = {
  done: "var(--viz-ordinal-4)",
  active: "var(--viz-series-1)",
  planned: "var(--viz-ordinal-1)",
};
export const STATE_STROKE: Record<TimelineEntryStatus, string> = {
  done: "var(--viz-ordinal-4)",
  active: "var(--viz-series-1)",
  planned: "var(--viz-ordinal-3)",
};
export const TODAY_COLOR = "var(--viz-series-2)";

/** Text width from a canvas using the chart's own font, so labels pack as drawn. */
export function useMeasure(ref: RefObject<Element | null>): Measure {
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fontRef = useRef<string>("");
  return useCallback<Measure>(
    (text, size) => {
      if (typeof document === "undefined") return approxMeasure(text, size);
      if (!ctxRef.current) ctxRef.current = document.createElement("canvas").getContext("2d");
      const ctx = ctxRef.current;
      if (!ctx) return approxMeasure(text, size);
      if (!fontRef.current && ref.current) fontRef.current = getComputedStyle(ref.current).fontFamily || "sans-serif";
      ctx.font = `${size}px ${fontRef.current || "sans-serif"}`;
      return ctx.measureText(text).width;
    },
    [ref],
  );
}

/** Width of a container, updated by ResizeObserver; 0 until measured. */
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? el.clientWidth;
      setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function entryDates(e: TimelineEntry) {
  return e.end ? `${fmtDate(e.start)} → ${fmtDate(e.end)}` : fmtDate(e.start);
}

function diamond(cx: number, cy: number, r: number) {
  return `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`;
}

export function TimelineSvg({
  layout,
  title,
  selectedId,
  onSelect,
  onHover,
  svgRef,
  className,
}: {
  layout: TimelineLayout;
  title?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (hit: { entry: TimelineEntry; x: number; y: number } | null) => void;
  svgRef?: RefObject<SVGSVGElement | null>;
  className?: string;
}) {
  const t = useT();
  const { width, height, axisHeight, bands, ticks, todayX, lanes, bars, points, fontSize } = layout;
  const hasGroups = lanes.some((l) => l.group !== null);
  const interactive = Boolean(onSelect || onHover);

  const hit = (e: TimelineEntry, x: number, y: number) => ({
    onMouseEnter: () => onHover?.({ entry: e, x, y }),
    onMouseLeave: () => onHover?.(null),
    onFocus: () => onHover?.({ entry: e, x, y }),
    onBlur: () => onHover?.(null),
    onClick: () => onSelect?.(e.id),
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onSelect?.(e.id);
      }
    },
    tabIndex: interactive ? 0 : undefined,
    role: interactive ? "button" : undefined,
    style: { cursor: interactive ? "pointer" : undefined, outline: "none" } as React.CSSProperties,
  });

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      direction="ltr"
      role="img"
      aria-label={title ?? t("Timeline")}
      className={cn("block max-w-full select-none", className)}
      style={{ fontSize, fill: "var(--viz-ink)" }}
    >
      <rect x={0} y={0} width={width} height={height} fill="var(--viz-surface)" />
      {/* Lane bands */}
      {lanes.map((l) => (
        <g key={`lane-${l.index}`}>
          {l.index % 2 === 1 ? <rect x={0} y={l.y} width={width} height={l.height} fill="var(--viz-grid)" opacity={0.28} /> : null}
          <line x1={0} x2={width} y1={l.y} y2={l.y} stroke="var(--viz-grid)" strokeWidth={1} />
          {hasGroups ? (
            <text x={10} y={l.y + 15} fontSize={fontSize - 1} fontWeight={600} fill="var(--viz-muted)" style={{ letterSpacing: 0.4, textTransform: "uppercase" }}>
              {l.group ?? t("Other")}
            </text>
          ) : null}
        </g>
      ))}
      {/* Past shading */}
      {todayX !== null ? <rect x={0} y={axisHeight} width={Math.max(0, todayX)} height={Math.max(0, height - axisHeight)} fill="var(--viz-ink)" opacity={0.035} /> : null}
      {/* Axis: coarse bands */}
      <rect x={0} y={0} width={width} height={axisHeight} fill="var(--viz-surface)" />
      {bands.map((b, i) => (
        <g key={`band-${i}`}>
          <line x1={b.x} x2={b.x} y1={0} y2={axisHeight} stroke="var(--viz-axis)" strokeWidth={1} />
          {b.label ? (
            <text x={b.x + 6} y={14} fontSize={fontSize - 1} fontWeight={600} fill="var(--viz-ink)">
              {b.label}
            </text>
          ) : null}
        </g>
      ))}
      {/* Axis: fine ticks */}
      {ticks.map((tk, i) => (
        <g key={`tick-${i}`}>
          <line x1={tk.x} x2={tk.x} y1={axisHeight - (tk.label ? 14 : 8)} y2={height} stroke="var(--viz-grid)" strokeWidth={1} />
          {tk.label ? (
            <text x={tk.x + 3} y={axisHeight - 5} fontSize={fontSize - 2} fill="var(--viz-muted)">
              {tk.label}
            </text>
          ) : null}
        </g>
      ))}
      <line x1={0} x2={width} y1={axisHeight} y2={axisHeight} stroke="var(--viz-axis)" strokeWidth={1} />

      {/* Bars */}
      {bars.map((b) => {
        const selected = selectedId === b.entry.id;
        return (
          <g key={b.entry.id} {...hit(b.entry, b.x + b.width / 2, b.y)} aria-label={`${b.entry.title}, ${entryDates(b.entry)}`}>
            <title>{`${b.entry.title} · ${entryDates(b.entry)}`}</title>
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={4}
              fill={STATE_FILL[b.state]}
              stroke={selected ? "var(--viz-ink)" : STATE_STROKE[b.state]}
              strokeWidth={selected ? 2 : 1}
              strokeDasharray={b.state === "planned" ? "4 3" : undefined}
            />
            <text
              x={b.labelX}
              y={b.y + b.height / 2}
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={500}
              fill={b.labelInside && b.state !== "planned" ? "var(--viz-surface)" : "var(--viz-ink)"}
            >
              {b.label}
            </text>
          </g>
        );
      })}

      {/* Points */}
      {points.map((p) => {
        const selected = selectedId === p.entry.id;
        const r = p.shape === "diamond" ? 7 : 5.5;
        return (
          <g key={p.entry.id} {...hit(p.entry, p.x, p.y)} aria-label={`${p.entry.title}, ${entryDates(p.entry)}`}>
            <title>{`${p.entry.title} · ${entryDates(p.entry)}`}</title>
            {p.shape === "diamond" ? (
              <path d={diamond(p.x, p.y, r)} fill={STATE_FILL[p.state]} stroke={selected ? "var(--viz-ink)" : STATE_STROKE[p.state]} strokeWidth={selected ? 2 : 1.5} />
            ) : (
              <circle cx={p.x} cy={p.y} r={r} fill={STATE_FILL[p.state]} stroke={selected ? "var(--viz-ink)" : STATE_STROKE[p.state]} strokeWidth={selected ? 2 : 1.5} strokeDasharray={p.state === "planned" ? "3 2" : undefined} />
            )}
            <text x={p.labelX} y={p.y} dominantBaseline="central" textAnchor={p.anchor} fontSize={fontSize} fontWeight={p.shape === "diamond" ? 600 : 500} fill="var(--viz-ink)">
              {p.label}
            </text>
          </g>
        );
      })}

      {/* Today */}
      {todayX !== null ? (
        <g aria-hidden>
          <line x1={todayX} x2={todayX} y1={axisHeight - 2} y2={height} stroke={TODAY_COLOR} strokeWidth={1.5} strokeDasharray="5 4" />
          <rect x={todayX - 22} y={axisHeight - 2 - 13} width={44} height={14} rx={7} fill={TODAY_COLOR} />
          <text x={todayX} y={axisHeight - 2 - 6} textAnchor="middle" dominantBaseline="central" fontSize={fontSize - 2} fontWeight={600} fill="var(--viz-surface)">
            {t("Today")}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** Legend for state and shape, rendered as HTML next to the chart. */
export function TimelineLegend({ className }: { className?: string }) {
  const t = useT();
  const items: { label: string; swatch: React.ReactNode }[] = [
    { label: t("Happened"), swatch: <span className="inline-block size-2.5 rounded-[3px]" style={{ background: STATE_FILL.done }} /> },
    { label: t("In progress"), swatch: <span className="inline-block size-2.5 rounded-[3px]" style={{ background: STATE_FILL.active }} /> },
    { label: t("Planned"), swatch: <span className="inline-block size-2.5 rounded-[3px] border border-dashed" style={{ background: STATE_FILL.planned, borderColor: STATE_STROKE.planned }} /> },
    { label: t("Milestone"), swatch: <span className="inline-block size-2.5 rotate-45 rounded-[1px]" style={{ background: STATE_FILL.done }} /> },
    { label: t("Today"), swatch: <span className="inline-block h-3 w-0.5" style={{ background: TODAY_COLOR }} /> },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Responsive wrapper: measures its container, lays the timeline out for that
 * width and draws it, with a hover card and selection.
 */
export function TimelineChart({
  timeline,
  today,
  selectedId,
  onSelect,
  svgRef,
  compact,
  minWidth = 560,
  className,
}: {
  timeline: Pick<Timeline, "entries" | "from" | "to" | "title">;
  today: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  svgRef?: RefObject<SVGSVGElement | null>;
  compact?: boolean;
  /** Below this the chart scrolls sideways instead of squeezing. */
  minWidth?: number;
  className?: string;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useWidth(boxRef);
  const measure = useMeasure(boxRef);
  const [hover, setHover] = useState<{ entry: TimelineEntry; x: number; y: number } | null>(null);
  const drawWidth = Math.max(width, minWidth);
  const layout = useMemo(() => (width ? layoutTimeline(timeline, { width: drawWidth, today, measure, compact }) : null), [timeline, drawWidth, today, measure, compact, width]);

  return (
    <div ref={boxRef} className={cn("ltr-island relative w-full min-w-0", className)}>
      {layout ? (
        <>
          <div className="overflow-x-auto">
            <TimelineSvg layout={layout} title={timeline.title} selectedId={selectedId} onSelect={onSelect} onHover={setHover} svgRef={svgRef} />
          </div>
          {layout.hidden ? <p className="px-3 py-1.5 text-xs text-muted-foreground">{t(layout.hidden === 1 ? "{n} entry falls outside the window and is listed below only." : "{n} entries fall outside the window and are listed below only.", { n: layout.hidden })}</p> : null}
        </>
      ) : (
        <div style={{ height: 160 }} />
      )}
      {hover && layout ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-64 rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.min(Math.max(8, hover.x + 12), Math.max(8, width - 260)), top: hover.y + 14 }}
        >
          <div className="font-medium" dir="auto">
            {hover.entry.title}
          </div>
          <div className="text-muted-foreground tabular-nums">{entryDates(hover.entry)}</div>
          {hover.entry.group ? <div className="text-muted-foreground">{hover.entry.group}</div> : null}
          {hover.entry.note ? (
            <div className="mt-1 line-clamp-3 text-muted-foreground" dir="auto">
              {hover.entry.note}
            </div>
          ) : null}
          {hover.entry.link ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">[[{hover.entry.link}]]</div> : null}
          {onSelect ? <div className="mt-1 text-[11px] text-muted-foreground">{t("Click to edit")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
