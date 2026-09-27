"use client";
import { useMemo, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps, type LabelProps } from "recharts";
import { AXIS_TICK, CHROME, SERIES } from "@/lib/chart-theme";
import { BAR_CURSOR, ChartCard, ChartTooltip, roundedBarPath, type SeriesDef } from "./chart-card";

// One-series column chart: thin bars, rounded at the data end, square at the
// baseline, value label on the tallest bar only. Throughput and the cycle-time
// histogram are both this shape.

export interface SingleBarDatum {
  label: string;
  value: number;
}

const HEIGHT = 220;

export function SingleBarChart({
  data,
  loading,
  title,
  subtitle,
  seriesLabel,
  categoryLabel,
  tickFormatter,
  labelFormatter,
  action,
}: {
  data: SingleBarDatum[];
  loading?: boolean;
  title: string;
  subtitle?: ReactNode;
  seriesLabel: string;
  categoryLabel: string;
  tickFormatter?: (label: string) => string;
  labelFormatter?: (label: string) => string;
  action?: ReactNode;
}) {
  const series: SeriesDef[] = useMemo(() => [{ key: "value", label: seriesLabel, color: SERIES[0], shape: "rect" }], [seriesLabel]);
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  const maxIndex = data.findIndex((d) => d.value === max);
  const rows = useMemo(
    () => data.map((d) => ({ label: labelFormatter ? labelFormatter(d.label) : d.label, value: d.value })),
    [data, labelFormatter],
  );
  const empty = !data.length || max === 0;

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      columns={[
        { key: "label", label: categoryLabel },
        { key: "value", label: seriesLabel, align: "end" },
      ]}
      rows={rows}
      loading={loading}
      empty={empty}
      height={HEIGHT}
      action={action}
    >
      <div className="ltr-island">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={CHROME.grid} strokeWidth={1} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHROME.axis }} tickFormatter={tickFormatter} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
            <Tooltip
              cursor={BAR_CURSOR}
              isAnimationActive={false}
              content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={series} labelFormatter={(l) => (labelFormatter ? labelFormatter(String(l)) : l)} />}
            />
            <Bar dataKey="value" fill={SERIES[0]} maxBarSize={24} isAnimationActive={false} shape={ColumnShape}>
              <LabelList dataKey="value" content={(p) => <MaxLabel {...p} maxIndex={maxIndex} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function ColumnShape(props: BarShapeProps) {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return <path d="" />;
  return <path d={roundedBarPath(x, y, width, height, "top")} fill={fill} />;
}

function MaxLabel({ index, viewBox, value, maxIndex }: LabelProps & { maxIndex: number }) {
  if (index !== maxIndex || value === undefined || value === null || Number(value) === 0) return null;
  const vb = viewBox as { x?: number; y?: number; width?: number } | undefined;
  const x = (vb?.x ?? 0) + (vb?.width ?? 0) / 2;
  const y = (vb?.y ?? 0) - 5;
  return (
    <text x={x} y={y} fontSize={11} textAnchor="middle" className="fill-foreground font-medium">
      {String(value)}
    </text>
  );
}
