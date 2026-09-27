"use client";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, CHROME, ORDINAL } from "@/lib/chart-theme";
import { fmtDate, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import type { DayPoint } from "@/lib/metrics";
import { BOARD_STATUSES, ISSUE_STATUSES } from "@/lib/types";
import { ChartCard, ChartLegend, ChartTooltip, LINE_CURSOR, type SeriesDef } from "./chart-card";

// Flow order maps onto the ordinal ramp: backlog lightest, done darkest.
// Labels stay English here and are translated at render with t(label).
const SERIES_DEF: SeriesDef[] = BOARD_STATUSES.map((s, i) => ({
  key: s,
  label: ISSUE_STATUSES.find((x) => x.value === s)?.label ?? s,
  color: ORDINAL[i],
  shape: "rect",
}));

const HEIGHT = 240;

export function CumulativeFlowChart({
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
  const rows = useMemo(
    () =>
      data.map((d) => {
        const r: Record<string, string | number> = { day: fmtDate(d.day) };
        for (const s of BOARD_STATUSES) r[s] = Number(d[s] ?? 0);
        return r;
      }),
    [data],
  );
  const empty = !data.length || data.every((d) => BOARD_STATUSES.every((s) => Number(d[s] ?? 0) === 0));

  return (
    <ChartCard
      title={title ?? t("Cumulative flow")}
      subtitle={subtitle ?? t("Issues in each stage at the end of every day")}
      columns={[{ key: "day", label: t("Day") }, ...series.map((s) => ({ key: s.key, label: s.label, align: "end" as const }))]}
      rows={rows}
      loading={loading}
      empty={empty}
      height={HEIGHT}
    >
      <div className="ltr-island">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHROME.grid} strokeWidth={1} />
            <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHROME.axis }} tickFormatter={fmtShort} minTickGap={28} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
            <Tooltip
              cursor={LINE_CURSOR}
              isAnimationActive={false}
              content={(p) => (
                <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={[...series].reverse()} labelFormatter={(l) => fmtDate(String(l))} />
              )}
            />
            {SERIES_DEF.map((s) => (
              // The surface-coloured 1px stroke is the gap between stacked bands.
              <Area
                key={s.key}
                type="monotone"
                stackId="flow"
                dataKey={s.key}
                stroke={CHROME.surface}
                strokeWidth={1}
                fill={s.color}
                fillOpacity={0.9}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface, fill: s.color }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend series={series} />
    </ChartCard>
  );
}
