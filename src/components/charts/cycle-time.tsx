"use client";
import { useMemo } from "react";
import { SingleBarChart } from "./single-bar";

export function fmtDays(d: number) {
  return d >= 10 ? Math.round(d).toString() : (Math.round(d * 10) / 10).toString();
}

export function CycleTimeChart({
  data,
  summary,
  loading,
  title = "Cycle time",
  periodLabel = "in this range",
}: {
  data: { label: string; count: number }[];
  summary: { n: number; p50: number; p85: number };
  loading?: boolean;
  title?: string;
  periodLabel?: string;
}) {
  const rows = useMemo(() => data.map((d) => ({ label: d.label, value: d.count })), [data]);
  const subtitle = summary.n
    ? `Started to done, ${summary.n} issues ${periodLabel} · p50 ${fmtDays(summary.p50)} d · p85 ${fmtDays(summary.p85)} d`
    : `Started to done; no completed issues ${periodLabel}`;
  return <SingleBarChart data={rows} loading={loading} title={title} subtitle={subtitle} seriesLabel="Issues" categoryLabel="Cycle time" />;
}
