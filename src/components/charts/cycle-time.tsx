"use client";
import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import { SingleBarChart } from "./single-bar";

export function fmtDays(d: number) {
  return d >= 10 ? Math.round(d).toString() : (Math.round(d * 10) / 10).toString();
}

export function CycleTimeChart({
  data,
  summary,
  loading,
  title,
  periodLabel,
}: {
  data: { label: string; count: number }[];
  summary: { n: number; p50: number; p85: number };
  loading?: boolean;
  title?: string;
  periodLabel?: string;
}) {
  const t = useT();
  const rows = useMemo(() => data.map((d) => ({ label: d.label, value: d.count })), [data]);
  const period = periodLabel ?? t("in this range");
  const subtitle = summary.n
    ? t("Started to done, {n} issues {period} · p50 {p50} d · p85 {p85} d", { n: summary.n, period, p50: fmtDays(summary.p50), p85: fmtDays(summary.p85) })
    : t("Started to done; no completed issues {period}", { period });
  return <SingleBarChart data={rows} loading={loading} title={title ?? t("Cycle time")} subtitle={subtitle} seriesLabel={t("Issues")} categoryLabel={t("Cycle time")} />;
}
