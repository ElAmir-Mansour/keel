"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaArrow } from "@/components/ui-bits";

// A number, not a chart. Label in sentence case, value in the font's default
// proportional figures (tabular-nums would loosen a big "121"), delta signed
// against a named period and coloured by direction × whether up is good.

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood,
  hint,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Signed change; omitted when a delta is not meaningful for this number. */
  delta?: number | null;
  deltaLabel?: string;
  /** undefined = neutral: the arrow shows direction but wears no status colour. */
  upIsGood?: boolean;
  hint?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const tone =
    delta === undefined || delta === null || delta === 0 || upIsGood === undefined
      ? "neutral"
      : (delta > 0) === upIsGood
        ? "good"
        : "bad";
  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-16" />
        ) : (
          <div className="mt-1 text-2xl font-semibold leading-none tracking-tight">{value}</div>
        )}
        {!loading && delta !== undefined && delta !== null ? (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-1 text-xs",
              tone === "good" && "text-[var(--viz-good-text)]",
              tone === "bad" && "text-[var(--viz-critical)]",
              tone === "neutral" && "text-muted-foreground",
            )}
          >
            <DeltaArrow value={delta} />
            <span className="tabular-nums">
              {delta > 0 ? "+" : ""}
              {formatDelta(delta)}
            </span>
            {deltaLabel ? <span className="text-muted-foreground">{deltaLabel}</span> : null}
          </div>
        ) : null}
        {!loading && hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function formatDelta(d: number) {
  return Number.isInteger(d) ? d.toString() : (Math.round(d * 10) / 10).toString();
}
