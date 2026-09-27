"use client";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps, type LabelProps } from "recharts";
import { AXIS_TICK, CHROME, ORDINAL, SERIES } from "@/lib/chart-theme";
import { useT } from "@/lib/i18n";
import { BAR_CURSOR, ChartCard, ChartLegend, ChartTooltip, roundedBarPath, type SeriesDef } from "./chart-card";

// Capacity, not performance: open work per person. The darker segment is what
// is actively in progress or review; the lighter one is queued.

export interface WorkloadRow {
  id: string;
  name: string;
  doing: number;
  open: number;
}

// Labels stay English here and are translated at render with t(label).
const SERIES_DEF: SeriesDef[] = [
  { key: "doing", label: "In progress", color: ORDINAL[4], shape: "rect" },
  { key: "open", label: "Queued", color: SERIES[0], shape: "rect" },
];

const ROW = 28;

export function WorkloadChart({
  data,
  loading,
  title,
  subtitle,
}: {
  data: WorkloadRow[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const t = useT();
  const series = SERIES_DEF.map((s) => ({ ...s, label: t(s.label) }));
  const sorted = useMemo(() => [...data].sort((a, b) => b.doing + b.open - (a.doing + a.open)), [data]);
  const totals = sorted.map((d) => d.doing + d.open);
  const max = totals.reduce((m, v) => Math.max(m, v), 0);
  const maxIndex = totals.findIndex((v) => v === max);
  const height = Math.max(120, sorted.length * ROW + 36);
  const rows = useMemo(() => sorted.map((d) => ({ name: d.name, doing: d.doing, open: d.open, total: d.doing + d.open })), [sorted]);

  return (
    <ChartCard
      title={title ?? t("Who has what")}
      subtitle={subtitle ?? t("Open work per person; a full plate is a planning signal, not a scorecard")}
      columns={[
        { key: "name", label: t("Person") },
        { key: "doing", label: t("In progress"), align: "end" },
        { key: "open", label: t("Queued"), align: "end" },
        { key: "total", label: t("Total"), align: "end" },
      ]}
      rows={rows}
      loading={loading}
      empty={!sorted.length || max === 0}
      emptyText={t("No open work assigned.")}
      height={height}
    >
      <div className="ltr-island">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 32, bottom: 0, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={CHROME.grid} strokeWidth={1} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHROME.axis }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} interval={0} />
            <Tooltip cursor={BAR_CURSOR} isAnimationActive={false} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={series} />} />
            <Bar dataKey="doing" stackId="w" fill={ORDINAL[4]} maxBarSize={20} isAnimationActive={false} shape={DoingShape} />
            <Bar dataKey="open" stackId="w" fill={SERIES[0]} maxBarSize={20} isAnimationActive={false} shape={OpenShape}>
              <LabelList dataKey="open" content={(p) => <TotalLabel {...p} maxIndex={maxIndex} totals={totals} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend series={series} />
    </ChartCard>
  );
}

// The rounded end belongs to whichever segment is last; a 2px surface gap
// separates the two when both are present.
function DoingShape(props: BarShapeProps) {
  const { x, y, width, height, fill, payload } = props;
  if (!width || !height) return <path d="" />;
  const hasOpen = (payload as WorkloadRow | undefined)?.open ? true : false;
  return <path d={roundedBarPath(x, y, width, height, hasOpen ? "none" : "end")} fill={fill} />;
}

function OpenShape(props: BarShapeProps) {
  const { x, y, width, height, fill, payload } = props;
  if (!width || !height) return <path d="" />;
  const hasDoing = (payload as WorkloadRow | undefined)?.doing ? true : false;
  const gap = hasDoing && width > 3 ? 2 : 0;
  return <path d={roundedBarPath(x + gap, y, width - gap, height, "end")} fill={fill} />;
}

function TotalLabel({ index, viewBox, maxIndex, totals }: LabelProps & { maxIndex: number; totals: number[] }) {
  if (index !== maxIndex || index === undefined) return null;
  const vb = viewBox as { x?: number; y?: number; width?: number; height?: number } | undefined;
  const x = (vb?.x ?? 0) + (vb?.width ?? 0) + 6;
  const y = (vb?.y ?? 0) + (vb?.height ?? 0) / 2;
  return (
    <text x={x} y={y} dy={4} fontSize={11} textAnchor="start" className="fill-foreground font-medium">
      {totals[index]}
    </text>
  );
}
