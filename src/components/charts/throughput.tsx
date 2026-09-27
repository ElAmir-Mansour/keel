"use client";
import { useMemo } from "react";
import { fmtDate, fmtShort } from "@/lib/dates";
import { SingleBarChart } from "./single-bar";

export function ThroughputChart({
  data,
  loading,
  title = "Throughput",
  subtitle = "Issues completed per week",
}: {
  data: { week: string; done: number }[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const rows = useMemo(() => data.map((d) => ({ label: d.week, value: d.done })), [data]);
  return (
    <SingleBarChart
      data={rows}
      loading={loading}
      title={title}
      subtitle={subtitle}
      seriesLabel="Done"
      categoryLabel="Week of"
      tickFormatter={fmtShort}
      labelFormatter={(l) => `Week of ${fmtDate(l)}`}
    />
  );
}
