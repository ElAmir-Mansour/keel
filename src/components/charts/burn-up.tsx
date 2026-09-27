"use client";
import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type LabelProps } from "recharts";
import { AXIS_TICK, CHROME, SERIES } from "@/lib/chart-theme";
import { fmtDate, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import type { DayPoint } from "@/lib/metrics";
import { ChartCard, ChartLegend, ChartTooltip, LINE_CURSOR, type SeriesDef } from "./chart-card";

// Labels stay English here and are translated at render with t(label).
const SERIES_DEF: SeriesDef[] = [
  { key: "done", label: "Done", color: SERIES[0], shape: "line" },
  { key: "scope", label: "Scope", color: CHROME.deemphasis, shape: "line" },
];

const HEIGHT = 240;

export function BurnUpChart({
  data,
  loading,
  title,
  subtitle,
}: {
  data: DayPoint[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const t = useT();
  const series = SERIES_DEF.map((s) => ({ ...s, label: t(s.label) }));
  const last = data.length - 1;
  const rows = useMemo(
    () => data.map((d) => ({ day: fmtDate(d.day), scope: d.scope, done: d.done })),
    [data],
  );
  const empty = !data.length || data.every((d) => Number(d.scope) === 0);

  return (
    <ChartCard
      title={title ?? t("Burn-up")}
      subtitle={subtitle ?? t("Cumulative done against total scope")}
      columns={[
        { key: "day", label: t("Day") },
        { key: "done", label: t("Done"), align: "end" },
        { key: "scope", label: t("Scope"), align: "end" },
      ]}
      rows={rows}
      loading={loading}
      empty={empty}
      height={HEIGHT}
    >
      <div className="ltr-island">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <ComposedChart data={data} margin={{ top: 10, right: 56, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHROME.grid} strokeWidth={1} />
            <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHROME.axis }} tickFormatter={fmtShort} minTickGap={28} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
            <Tooltip
              cursor={LINE_CURSOR}
              isAnimationActive={false}
              content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={series} labelFormatter={(l) => fmtDate(String(l))} />}
            />
            <Line
              type="monotone"
              dataKey="scope"
              stroke={CHROME.deemphasis}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface, fill: CHROME.deemphasis }}
              isAnimationActive={false}
            >
              <LabelList dataKey="scope" content={(p) => <EndLabel {...p} last={last} name={t("scope")} above />} />
            </Line>
            <Area
              type="monotone"
              dataKey="done"
              stroke={SERIES[0]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill={SERIES[0]}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface, fill: SERIES[0] }}
              isAnimationActive={false}
            >
              <LabelList dataKey="done" content={(p) => <EndLabel {...p} last={last} name={t("done")} />} />
            </Area>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend series={series} />
    </ChartCard>
  );
}

// Direct label on the final point only. Scope is never below done, so scope
// sits above its line and done below its line and the two cannot collide.
function EndLabel({ index, viewBox, value, last, name, above }: LabelProps & { last: number; name: string; above?: boolean }) {
  if (index !== last || value === undefined || value === null) return null;
  const vb = viewBox as { x?: number; y?: number } | undefined;
  const x = (vb?.x ?? 0) + 6;
  const y = (vb?.y ?? 0) + (above ? -4 : 12);
  return (
    <text x={x} y={y} fontSize={11} className="fill-muted-foreground" textAnchor="start">
      <tspan className="fill-foreground font-medium">{String(value)}</tspan> {name}
    </text>
  );
}
