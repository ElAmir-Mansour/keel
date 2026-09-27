"use client";
import { useState, type ReactNode } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import type { TooltipContentProps } from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";

// Shared chrome for every chart: a card with title and one-line subtitle, a
// toggle that swaps the plot for its table twin (so no value is reachable only
// by hover), a skeleton on first load and a legend/tooltip pair that never
// colours text with the series hue.

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  shape: "line" | "rect";
}

export interface TableColumn {
  key: string;
  label: string;
  align?: "start" | "end";
}

export type TableRowData = Record<string, ReactNode>;

export function ChartCard({
  title,
  subtitle,
  columns,
  rows,
  loading,
  empty,
  emptyText,
  height = 240,
  action,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  columns: TableColumn[];
  rows: TableRowData[];
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  /** Plot height; the table view scrolls inside the same box. */
  height?: number;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [table, setTable] = useState(false);
  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle ? <CardDescription className="text-xs">{subtitle}</CardDescription> : null}
        <CardAction className="flex items-center gap-1">
          {action}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-pressed={table}
                aria-label={table ? t("Show chart") : t("Show table")}
                onClick={() => setTable((v) => !v)}
              >
                {table ? <ChartColumn className="size-3.5" /> : <Table2 className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{table ? t("Show chart") : t("Show as table")}</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : table ? (
          <div className="overflow-auto" style={{ maxHeight: height }}>
            <DataTable columns={columns} rows={rows} />
          </div>
        ) : empty ? (
          <div style={{ height }} className="flex items-center justify-center text-xs text-muted-foreground">
            {emptyText ?? t("Nothing in this range yet.")}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function DataTable({ columns, rows }: { columns: TableColumn[]; rows: TableRowData[] }) {
  const t = useT();
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={cn("h-8", c.align === "end" && "text-end")}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="text-muted-foreground">
              {t("No rows")}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c.key} className={cn("py-1.5", c.align === "end" && "text-end tabular-nums")}>
                  {r[c.key]}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

/** Swatch that mirrors the mark: a short stroke for lines, a square for fills. */
export function Swatch({ color, shape = "rect", className }: { color: string; shape?: "line" | "rect"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", shape === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function ChartLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  if (series.length < 2) return null;
  return (
    <ul className={cn("mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <Swatch color={s.color} shape={s.shape} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tooltip body for Recharts. Values lead, series names follow, each row keyed
 * by a swatch in the series colour. Pass the same `series` used for the legend
 * so colours never depend on what Recharts guessed from stroke/fill.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  series,
  labelFormatter,
  valueFormatter,
}: Pick<TooltipContentProps, "active" | "payload" | "label"> & {
  series: SeriesDef[];
  labelFormatter?: (label: string | number | undefined) => ReactNode;
  valueFormatter?: (value: number, key: string) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(series.map((s) => [s.key, s]));
  const rows = payload
    .filter((p) => p.dataKey !== undefined && byKey.has(String(p.dataKey)))
    .map((p) => {
      const s = byKey.get(String(p.dataKey))!;
      const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
      return { s, v };
    });
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md">
      {label !== undefined ? <div className="mb-1 text-muted-foreground">{labelFormatter ? labelFormatter(label) : label}</div> : null}
      <div className="grid gap-0.5">
        {rows.map(({ s, v }) => (
          <div key={s.key} className="flex items-center gap-2">
            <Swatch color={s.color} shape={s.shape} />
            <span className="font-medium tabular-nums">{valueFormatter ? valueFormatter(v, s.key) : v}</span>
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hairline crosshair for line/area charts; a soft band for bar charts. */
export const LINE_CURSOR = { stroke: "var(--viz-axis)", strokeWidth: 1 } as const;
export const BAR_CURSOR = { fill: "var(--viz-grid)", fillOpacity: 0.6 } as const;

/** Path for a bar with 4px rounded corners on the data end only. */
export function roundedBarPath(x: number, y: number, w: number, h: number, end: "top" | "end" | "none", r = 4) {
  if (w <= 0 || h <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  if (end === "top") {
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
  }
  if (end === "end") {
    return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
  }
  return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
}
