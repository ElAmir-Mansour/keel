"use client";
import { useId, useMemo, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { autoHeadline, execEntries, lastReview, layoutSlide, reviewDiff, SLIDE_H, SLIDE_W, type SlideLayout, type Trend } from "@/lib/timeline/management";
import type { Measure } from "@/lib/timeline/layout";
import type { Rag, Timeline } from "@/lib/types";
import { useMeasure } from "./timeline-chart";

// The management slide: a 16:9 SVG at 1600×900 that scales to fit. Executive
// items only, lanes by theme with a RAG verdict and trend, bars and diamonds
// with baseline ghosts and slip labels, a change strip against the last
// review, and the decisions leadership owes. Drawn once for screen, PNG and PDF.

const RAG_FILL: Record<Rag, string> = { on: "var(--viz-good)", risk: "var(--viz-warning)", off: "var(--viz-critical)" };
const RAG_LABEL: Record<Rag, string> = { on: "On track", risk: "At risk", off: "Off track" };
const INK = "var(--viz-ink)";
const MUTED = "var(--viz-muted)";

function RagGlyph({ rag, x, y, size = 18 }: { rag: Rag; x: number; y: number; size?: number }) {
  const h = size / 2;
  if (rag === "on") return <circle cx={x} cy={y} r={h} fill={RAG_FILL.on} />;
  if (rag === "risk") return <path d={`M${x},${y - h - 1} L${x + h + 1},${y + h - 1} L${x - h - 1},${y + h - 1} Z`} fill={RAG_FILL.risk} />;
  return <rect x={x - h} y={y - h} width={size} height={size} rx={2} fill={RAG_FILL.off} />;
}

function trendArrow(t: Trend) {
  return t === "up" ? "↑" : t === "down" ? "↓" : "→";
}

function diamond(cx: number, cy: number, r: number) {
  return `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`;
}

export function ManagementSvg({
  timeline,
  layout,
  today,
  measure,
  svgRef,
  className,
}: {
  timeline: Timeline;
  layout: SlideLayout;
  today: string;
  measure: Measure;
  svgRef?: RefObject<SVGSVGElement | null>;
  className?: string;
}) {
  const t = useT();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const hatch = `hatch-${uid}`;
  const mirror = Boolean(timeline.mirror);
  const W = SLIDE_W;
  const H = SLIDE_H;
  const M = layout.margin;
  const mx = (x: number) => (mirror ? W - x : x);
  type Anchor = "start" | "end" | "middle";
  const anchorOf = (a: "start" | "end"): Anchor => (mirror ? (a === "start" ? "end" : "start") : a);
  const tx = (x: number, a: Anchor): { x: number; textAnchor: Anchor } => ({ x: mx(x), textAnchor: a === "middle" ? "middle" : anchorOf(a) });
  const entries = execEntries(timeline);
  const asks = (timeline.asks ?? []).filter((a) => !a.done);
  const asOf = timeline.asOf || today;
  const previous = lastReview(timeline, asOf);
  const diff = previous ? reviewDiff(entries, previous, today) : null;
  const headline = timeline.headline?.trim() || autoHeadline(entries, timeline.asks ?? [], today, t);

  const fit = (text: string, max: number, size: number) => {
    if (measure(text, size) <= max) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(`${text.slice(0, mid)}…`, size) <= max) lo = mid;
      else hi = mid - 1;
    }
    return `${text.slice(0, lo).trimEnd()}…`;
  };

  const subtitle = [
    timeline.title,
    timeline.owner ? t("Owner: {name}", { name: timeline.owner }) : null,
    t("As of {date}", { date: fmtDate(asOf) }),
    timeline.nextReview ? t("Next review {date}", { date: fmtDate(timeline.nextReview) }) : null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const changeLine = diff
    ? [
        t("Since {date}:", { date: fmtDate(diff.since, "d MMM") }),
        diff.done.length ? t("✓ {n} done", { n: diff.done.length }) : null,
        diff.slipped.length ? t("▲ {n} slipped ({names})", { n: diff.slipped.length, names: diff.slipped.map((s) => `${s.entry.title} +${s.days}d`).join(", ") }) : null,
        diff.pulledIn.length ? t("▼ {n} earlier", { n: diff.pulledIn.length }) : null,
        diff.added.length ? t("+ {n} new", { n: diff.added.length }) : null,
        diff.removed.length ? t("− {n} removed", { n: diff.removed.length }) : null,
        `${t(RAG_LABEL[diff.before])} → ${t(RAG_LABEL[diff.after])}`,
      ]
        .filter(Boolean)
        .join("  ·  ")
    : t("First review: nothing to compare with yet. Record this review to track changes.");

  const legend = [
    { glyph: "on" as const, label: t("On track") },
    { glyph: "risk" as const, label: t("At risk") },
    { glyph: "off" as const, label: t("Off track") },
  ];

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      direction="ltr"
      role="img"
      aria-label={t("Management view: {title}", { title: timeline.title })}
      className={cn("block h-auto w-full max-w-full select-none", className)}
      style={{ fill: INK }}
    >
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width={10} height={10} patternTransform="rotate(45)">
          <rect width={10} height={10} fill="var(--viz-surface)" />
          <line x1={0} y1={0} x2={0} y2={10} stroke="var(--viz-ordinal-3)" strokeWidth={3} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="var(--viz-surface)" />

      {/* Header */}
      <text {...tx(M, "start")} y={92} fontSize={44} fontWeight={700} fill={INK} style={{ unicodeBidi: "plaintext" }}>
        {fit(headline, W - 2 * M, 44)}
      </text>
      <text {...tx(M, "start")} y={132} fontSize={24} fill={MUTED} style={{ unicodeBidi: "plaintext" }}>
        {fit(subtitle, W - 2 * M, 24)}
      </text>
      <rect x={M} y={152} width={W - 2 * M} height={34} rx={8} fill="var(--viz-grid)" opacity={0.45} />
      <text {...tx(M + 14, "start")} y={175} fontSize={22} fill={INK} style={{ unicodeBidi: "plaintext" }}>
        {fit(changeLine, W - 2 * M - 28, 22)}
      </text>

      {/* Axis */}
      {layout.bands.map((b, i) => (
        <g key={`b-${i}`}>
          <rect x={mx(mirror ? b.x + b.width : b.x)} y={layout.axisY - 48} width={b.width} height={30} fill={i % 2 ? "var(--viz-grid)" : "var(--viz-grid)"} opacity={i % 2 ? 0.5 : 0.25} />
          <text {...tx(b.x + b.width / 2, "middle")} y={layout.axisY - 27} fontSize={22} fontWeight={600} fill={INK}>
            {b.label}
          </text>
        </g>
      ))}
      {layout.months.map((m, i) => (
        <g key={`m-${i}`}>
          <line x1={mx(m.x)} x2={mx(m.x)} y1={layout.axisY - 18} y2={layout.bodyBottom} stroke="var(--viz-grid)" strokeWidth={1.5} />
          <text {...tx(m.x + 8, "start")} y={layout.axisY - 2} fontSize={22} fill={MUTED}>
            {m.label}
          </text>
        </g>
      ))}
      <line x1={M} x2={W - M} y1={layout.axisY + 8} y2={layout.axisY + 8} stroke="var(--viz-axis)" strokeWidth={1.5} />

      {/* Past shading */}
      {layout.todayX !== null ? (
        <rect x={mx(mirror ? layout.todayX : layout.trackX)} y={layout.axisY + 10} width={Math.max(0, layout.todayX - layout.trackX)} height={Math.max(0, layout.bodyBottom - layout.axisY - 10)} fill={INK} opacity={0.04} />
      ) : null}

      {/* Lanes */}
      {layout.lanes.map((l) => (
        <g key={`lane-${l.index}`}>
          <line x1={M} x2={W - M} y1={l.y} y2={l.y} stroke="var(--viz-grid)" strokeWidth={1.5} />
          {l.index % 2 === 1 ? <rect x={M} y={l.y} width={W - 2 * M} height={l.height} fill="var(--viz-grid)" opacity={0.18} /> : null}
          <text {...tx(M + 4, "start")} y={l.y + l.height / 2 - 8} fontSize={28} fontWeight={600} fill={INK} style={{ unicodeBidi: "plaintext" }}>
            {fit(l.group ?? t("General"), layout.labelCol - 24, 28)}
          </text>
          <RagGlyph rag={l.rag} x={mx(M + 13) + (mirror ? -0 : 0)} y={l.y + l.height / 2 + 22} />
          <text {...tx(M + 30, "start")} y={l.y + l.height / 2 + 30} fontSize={22} fill={MUTED}>
            {t(RAG_LABEL[l.rag])} {trendArrow(l.trend)}
          </text>
        </g>
      ))}
      <line x1={mx(layout.trackX)} x2={mx(layout.trackX)} y1={layout.axisY + 8} y2={layout.bodyBottom} stroke="var(--viz-axis)" strokeWidth={1.5} />

      {/* Bars */}
      {layout.bars.map((b) => {
        const fill = b.state === "done" ? "var(--viz-ordinal-4)" : b.state === "active" ? "var(--viz-series-1)" : `url(#${hatch})`;
        const x0 = mx(mirror ? b.x + b.width : b.x);
        return (
          <g key={b.entry.id}>
            <title>{`${b.entry.title} · ${fmtDate(b.entry.start)} → ${fmtDate(b.entry.end)}`}</title>
            <rect x={x0} y={b.y} width={b.width} height={b.height} rx={6} fill={fill} stroke={b.state === "planned" ? "var(--viz-ordinal-3)" : b.state === "active" ? "var(--viz-series-1)" : "var(--viz-ordinal-4)"} strokeWidth={2} />
            {b.baselineX !== null && b.slip ? (
              // Slip rail under the bar: hollow diamond at the baseline, a coloured run to where the end is now.
              <>
                <line x1={mx(b.baselineX)} x2={mx(b.x + b.width)} y1={b.y + b.height + 7} y2={b.y + b.height + 7} stroke={b.slip > 0 ? RAG_FILL.off : "var(--viz-good-text)"} strokeWidth={3} />
                <path d={diamond(mx(b.baselineX), b.y + b.height + 7, 8)} fill="var(--viz-surface)" stroke={INK} strokeWidth={2} />
                <path d={diamond(mx(b.x + b.width), b.y + b.height + 7, 6)} fill={b.slip > 0 ? RAG_FILL.off : "var(--viz-good-text)"} />
              </>
            ) : null}
            {b.labelInside && b.state === "planned" ? (
              <rect x={mx(mirror ? b.labelX - 6 + measure(b.label, layout.fontSize) + 12 + (b.rag !== "on" ? 24 : 0) : b.labelX - 6)} y={b.y + 4} width={measure(b.label, layout.fontSize) + 12 + (b.rag !== "on" ? 24 : 0)} height={b.height - 8} rx={4} fill="var(--viz-surface)" opacity={0.92} />
            ) : null}
            {b.rag !== "on" ? <RagGlyph rag={b.rag} x={mx(b.labelSide === "left" ? b.labelX - 9 : b.labelX + 9)} y={b.y + b.height / 2} size={14} /> : null}
            <text
              {...tx(b.labelX + (b.rag !== "on" ? (b.labelSide === "left" ? -24 : 24) : 0), b.labelSide === "left" ? "end" : "start")}
              y={b.y + b.height / 2}
              dominantBaseline="central"
              fontSize={layout.fontSize}
              fontWeight={600}
              fill={b.labelInside && b.state !== "planned" ? "var(--viz-surface)" : INK}
              style={{ unicodeBidi: "plaintext" }}
            >
              {b.label}
            </text>
            {b.slip
              ? (() => {
                  const text = b.slip > 0 ? `+${b.slip}d` : `−${Math.abs(b.slip)}d`;
                  const tw = measure(text, 22);
                  const after = Math.max(b.x + b.width, b.baselineX ?? 0) + 14 + (b.labelInside || b.labelSide === "left" ? 0 : (b.rag !== "on" ? 24 : 0) + measure(b.label, layout.fontSize) + 12);
                  const fits = after + tw <= layout.trackX + layout.trackWidth;
                  const before = Math.min(b.x, b.baselineX ?? b.x) - 14 - (b.labelSide === "left" ? (b.rag !== "on" ? 24 : 0) + measure(b.label, layout.fontSize) + 12 : 0);
                  const sx = fits ? after : before;
                  return (
                    <text {...tx(sx, fits ? "start" : "end")} y={b.y + b.height / 2} dominantBaseline="central" fontSize={22} fontWeight={700} fill={b.slip > 0 ? RAG_FILL.off : "var(--viz-good-text)"}>
                      {text}
                    </text>
                  );
                })()
              : null}
          </g>
        );
      })}

      {/* Points */}
      {layout.points.map((p) => {
        const r = p.shape === "diamond" ? 13 : 10;
        const fill = p.state === "done" ? "var(--viz-ordinal-4)" : p.state === "planned" ? "var(--viz-ordinal-1)" : "var(--viz-series-1)";
        const stroke = p.state === "planned" ? "var(--viz-ordinal-3)" : fill;
        const slipColor = p.slip && p.slip > 0 ? RAG_FILL.off : "var(--viz-good-text)";
        return (
          <g key={p.entry.id}>
            <title>{`${p.entry.title} · ${fmtDate(p.entry.start)}`}</title>
            {p.baselineX !== null && p.slip ? (
              <>
                <line x1={mx(p.baselineX)} x2={mx(p.x)} y1={p.y} y2={p.y} stroke={slipColor} strokeWidth={3} />
                <path d={diamond(mx(p.baselineX), p.y, 9)} fill="var(--viz-surface)" stroke={INK} strokeWidth={2} />
              </>
            ) : null}
            {p.shape === "diamond" ? <path d={diamond(mx(p.x), p.y, r)} fill={fill} stroke={stroke} strokeWidth={2.5} /> : <circle cx={mx(p.x)} cy={p.y} r={r} fill={fill} stroke={stroke} strokeWidth={2.5} />}
            {p.rag !== "on" ? <RagGlyph rag={p.rag} x={mx(p.anchor === "start" ? p.labelX + 8 : p.labelX - 8)} y={p.y} size={14} /> : null}
            <text {...tx(p.labelX + (p.rag !== "on" ? (p.anchor === "start" ? 22 : -22) : 0), p.anchor)} y={p.y} dominantBaseline="central" fontSize={layout.fontSize} fontWeight={p.shape === "diamond" ? 700 : 500} fill={INK} style={{ unicodeBidi: "plaintext" }}>
              {p.label}
              {p.slip ? (
                <tspan fontSize={22} fontWeight={700} fill={slipColor}>
                  {`  ${p.slip > 0 ? "+" : "−"}${Math.abs(p.slip)}d`}
                </tspan>
              ) : null}
            </text>
          </g>
        );
      })}

      {/* Today */}
      {layout.todayX !== null ? (
        <g aria-hidden>
          <line x1={mx(layout.todayX)} x2={mx(layout.todayX)} y1={layout.axisY - 12} y2={layout.bodyBottom} stroke="var(--viz-series-2)" strokeWidth={3} strokeDasharray="10 7" />
          <rect x={mx(layout.todayX) - 44} y={layout.axisY - 12 - 30} width={88} height={30} rx={15} fill="var(--viz-series-2)" />
          <text x={mx(layout.todayX)} y={layout.axisY - 12 - 15} textAnchor="middle" dominantBaseline="central" fontSize={20} fontWeight={700} fill="var(--viz-surface)">
            {t("Today")}
          </text>
        </g>
      ) : null}

      {/* Footer: legend */}
      <line x1={M} x2={W - M} y1={layout.bodyBottom} y2={layout.bodyBottom} stroke="var(--viz-axis)" strokeWidth={1.5} />
      {(() => {
        const y = H - 26;
        let x = M;
        const items: React.ReactNode[] = [];
        const step = (w: number) => (x += w);
        for (const l of legend) {
          items.push(<RagGlyph key={`lg-${l.glyph}`} rag={l.glyph} x={mx(x + 9)} y={y} size={16} />);
          items.push(
            <text key={`lt-${l.glyph}`} {...tx(x + 26, "start")} y={y} dominantBaseline="central" fontSize={21} fill={MUTED}>
              {l.label}
            </text>,
          );
          step(26 + measure(l.label, 21) + 28);
        }
        const swatches: { label: string; fill: string; stroke: string }[] = [
          { label: t("Done"), fill: "var(--viz-ordinal-4)", stroke: "var(--viz-ordinal-4)" },
          { label: t("In progress"), fill: "var(--viz-series-1)", stroke: "var(--viz-series-1)" },
          { label: t("Planned"), fill: `url(#${hatch})`, stroke: "var(--viz-ordinal-3)" },
        ];
        step(10);
        for (const s of swatches) {
          items.push(<rect key={`sw-${s.label}`} x={mx(mirror ? x + 26 : x)} y={y - 8} width={26} height={16} rx={4} fill={s.fill} stroke={s.stroke} strokeWidth={1.5} />);
          items.push(
            <text key={`st-${s.label}`} {...tx(x + 34, "start")} y={y} dominantBaseline="central" fontSize={21} fill={MUTED}>
              {s.label}
            </text>,
          );
          step(34 + measure(s.label, 21) + 28);
        }
        step(10);
        items.push(<path key="lg-base" d={diamond(mx(x + 9), y, 8)} fill="var(--viz-surface)" stroke={INK} strokeWidth={2} />);
        items.push(
          <text key="lt-base" {...tx(x + 26, "start")} y={y} dominantBaseline="central" fontSize={21} fill={MUTED}>
            {t("Baseline")}
          </text>,
        );
        step(26 + measure(t("Baseline"), 21) + 28);
        items.push(<path key="lg-now" d={diamond(mx(x + 9), y, 8)} fill="var(--viz-ordinal-4)" />);
        items.push(
          <text key="lt-now" {...tx(x + 26, "start")} y={y} dominantBaseline="central" fontSize={21} fill={MUTED}>
            {t("Current date")}
          </text>,
        );
        return items;
      })()}

      {/* Footer: decisions needed */}
      {(() => {
        const boxW = 820;
        const by = layout.bodyBottom + 10;
        const boxH = H - 48 - by;
        const bx = W - M - boxW;
        const rows = asks.slice(0, 3);
        return (
          <g>
            <rect x={mx(mirror ? bx + boxW : bx)} y={by} width={boxW} height={boxH} rx={10} fill="var(--viz-grid)" opacity={0.35} />
            <rect x={mx(mirror ? bx + boxW : bx)} y={by} width={boxW} height={boxH} rx={10} fill="none" stroke="var(--viz-axis)" strokeWidth={1.5} />
            <text {...tx(bx + 16, "start")} y={by + 26} fontSize={21} fontWeight={700} fill={INK}>
              {t("Decisions needed")}
              {asks.length > 3 ? ` (+${asks.length - 3})` : ""}
            </text>
            {rows.length ? (
              rows.map((a, i) => (
                <text key={a.id} {...tx(bx + 16, "start")} y={by + 52 + i * 25} fontSize={20} fill={INK} style={{ unicodeBidi: "plaintext" }}>
                  {fit(`${a.neededBy ? `${fmtDate(a.neededBy, "d MMM")} · ` : ""}${a.decision}${a.owner ? ` · ${a.owner}` : ""}`, boxW - 32, 20)}
                </text>
              ))
            ) : (
              <text {...tx(bx + 16, "start")} y={by + 52} fontSize={20} fill={MUTED}>
                {t("None open")}
              </text>
            )}
          </g>
        );
      })()}

      {layout.hidden ? (
        <text {...tx(layout.trackX, "start")} y={layout.bodyBottom - 10} fontSize={20} fill={MUTED}>
          {t("{n} more executive items not shown", { n: layout.hidden })}
        </text>
      ) : null}
    </svg>
  );
}

/** Lays the slide out for the timeline and draws it; the SVG scales to its container. */
export function ManagementSlide({ timeline, today, svgRef, className }: { timeline: Timeline; today: string; svgRef?: RefObject<SVGSVGElement | null>; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measure = useMeasure(boxRef);
  const asOf = timeline.asOf || today;
  const previous = useMemo(() => lastReview(timeline, asOf), [timeline, asOf]);
  const layout = useMemo(() => layoutSlide(timeline, { today, measure, previous }), [timeline, today, measure, previous]);
  return (
    <div ref={boxRef} className={cn("ltr-island w-full min-w-0", className)}>
      <ManagementSvg timeline={timeline} layout={layout} today={today} measure={measure} svgRef={svgRef} />
    </div>
  );
}
