"use client";
import { Check, CircleSlash, Loader2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewToolCall } from "@/lib/ai/actions";
import type { ToolCall } from "@/lib/ai/client";
import type { Source } from "@/lib/ai/context";

export type ToolCallStatus = "pending" | "running" | "applied" | "skipped" | "failed";
export interface ToolCallState extends ToolCall {
  status: ToolCallStatus;
  result?: string;
}

/** Proposed actions with per-call approve/skip. Nothing runs until a click. */
export function ToolCallCards({ calls, onDecide, onDecideAll, disabled }: { calls: ToolCallState[]; onDecide: (id: string, choice: "apply" | "skip") => void; onDecideAll: (choice: "apply" | "skip") => void; disabled?: boolean }) {
  const pending = calls.filter((c) => c.status === "pending").length;
  return (
    <div className="space-y-2">
      {calls.map((c) => {
        const p = previewToolCall(c);
        return (
          <div key={c.id} className={cn("rounded-md border p-2.5 text-sm", c.status === "applied" && "border-[color-mix(in_oklab,var(--viz-good)_40%,transparent)]", c.status === "failed" && "border-destructive/40")}>
            <div className="flex items-start gap-2">
              <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.title}</div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {p.lines.slice(0, 8).map((l, i) => (
                    <li key={i} className="truncate" dir="auto">
                      {l}
                    </li>
                  ))}
                  {p.lines.length > 8 ? <li>… and {p.lines.length - 8} more</li> : null}
                </ul>
                {c.result ? <p className={cn("mt-1 text-xs", c.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{c.result}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {c.status === "pending" ? (
                  <>
                    <Button size="xs" onClick={() => onDecide(c.id, "apply")} disabled={disabled}>
                      <Check /> Apply
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => onDecide(c.id, "skip")} disabled={disabled}>
                      <X /> Skip
                    </Button>
                  </>
                ) : c.status === "running" ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : c.status === "applied" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--viz-good-text)]">
                    <Check className="size-3.5" /> Applied
                  </span>
                ) : c.status === "skipped" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <CircleSlash className="size-3.5" /> Skipped
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <X className="size-3.5" /> Failed
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {pending > 1 ? (
        <div className="flex gap-2">
          <Button size="xs" variant="outline" onClick={() => onDecideAll("apply")} disabled={disabled}>
            Apply all {pending}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onDecideAll("skip")} disabled={disabled}>
            Skip all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export { withCitations } from "@/lib/ai/citations";

export function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <ol className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
      {sources.map((s) => (
        <li key={s.n} className="truncate">
          <span className="me-1 font-mono">[{s.n}]</span>
          {s.kind}: <span dir="auto">{s.title}</span>
        </li>
      ))}
    </ol>
  );
}
