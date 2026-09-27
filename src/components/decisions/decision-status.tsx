"use client";
import { Ban, CheckCircle2, CircleDashed, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { DECISION_STATUSES, type DecisionStatus } from "@/lib/types";

export function decisionStatusLabel(status: DecisionStatus) {
  return DECISION_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function DecisionStatusIcon({ status, className }: { status: DecisionStatus; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "proposed":
      return <CircleDashed className={cn(c, "text-[var(--viz-series-4)]")} />;
    case "accepted":
      return <CheckCircle2 className={cn(c, "text-[var(--viz-good)]")} />;
    case "superseded":
      return <History className={cn(c, "text-[var(--viz-series-7)]")} />;
    case "deprecated":
      return <Ban className={cn(c, "text-muted-foreground")} />;
  }
}

export function DecisionStatusBadge({ status, className }: { status: DecisionStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", status === "deprecated" || status === "superseded" ? "text-muted-foreground" : "text-foreground", className)}>
      <DecisionStatusIcon status={status} />
      {decisionStatusLabel(status)}
    </span>
  );
}
