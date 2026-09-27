"use client";
import { useMemo } from "react";
import { fmtDate, fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { SingleBarChart } from "./single-bar";

export function ThroughputChart({
  data,
  loading,
  title,
  subtitle,
}: {
  data: { week: string; done: number }[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const t = useT();
  const rows = useMemo(() => data.map((d) => ({ label: d.week, value: d.done })), [data]);
  return (
    <SingleBarChart
      data={rows}
      loading={loading}
      title={title ?? t("Throughput")}
      subtitle={subtitle ?? t("Issues completed per week")}
      seriesLabel={t("Done")}
      categoryLabel={t("Week of")}
      tickFormatter={fmtShort}
      labelFormatter={(l) => t("Week of {date}", { date: fmtDate(l) })}
    />
  );
}
