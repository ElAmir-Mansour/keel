"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { differenceInCalendarDays, startOfQuarter, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtShort, parseYMD, todayYMD, ymd } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import type { Project } from "@/lib/types";
import { ProjectDot } from "@/components/ui-bits";

// One filter row above the dashboard. State lives in the URL (?range=30&
// project=<id>) so a view is shareable and survives reload; everything below
// the row re-renders against the same slice.

export type RangeKey = "7" | "30" | "90" | "q";

// Labels stay English here and are translated at render with t(label).
export const RANGE_PRESETS: { value: RangeKey; label: string }[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "q", label: "This quarter" },
];

const DEFAULT_RANGE: RangeKey = "30";

export interface DateRange {
  range: RangeKey;
  projectId?: string;
  from: Date;
  to: Date;
  /** Number of days in the range, inclusive. */
  days: number;
  /** The equal-length period immediately before `from`. */
  prevFrom: Date;
  prevTo: Date;
  setRange: (r: RangeKey) => void;
  setProject: (id?: string) => void;
}

function parseRange(v: string | null): RangeKey {
  return RANGE_PRESETS.some((p) => p.value === v) ? (v as RangeKey) : DEFAULT_RANGE;
}

export function rangeBounds(range: RangeKey, todayStr: string) {
  const today = parseYMD(todayStr);
  const from = range === "q" ? startOfQuarter(today) : subDays(today, Number(range) - 1);
  const days = differenceInCalendarDays(today, from) + 1;
  const prevTo = subDays(from, 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { from, to: today, days, prevFrom, prevTo };
}

export function useDateRange(): DateRange {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const range = parseRange(sp.get("range"));
  const projectId = sp.get("project") || undefined;
  // Keyed on the day string so the bounds only recompute at midnight.
  const todayStr = todayYMD();
  const bounds = useMemo(() => rangeBounds(range, todayStr), [range, todayStr]);

  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const setRange = useCallback((r: RangeKey) => update({ range: r === DEFAULT_RANGE ? undefined : r }), [update]);
  const setProject = useCallback((id?: string) => update({ project: id }), [update]);

  // Stable identity so consumers can memoise their derived model on it.
  return useMemo(() => ({ range, projectId, ...bounds, setRange, setProject }), [range, projectId, bounds, setRange, setProject]);
}

export function DateRangeRow({
  value,
  projects,
  className,
}: {
  value: DateRange;
  /** Projects offered in the filter; omit the select entirely when undefined. */
  projects?: Project[];
  className?: string;
}) {
  const t = useT();
  const { range, projectId, from, to, setRange, setProject } = value;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div role="group" aria-label={t("Date range")} className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5">
        {RANGE_PRESETS.map((p) => (
          <Button
            key={p.value}
            size="xs"
            variant={range === p.value ? "outline" : "ghost"}
            aria-pressed={range === p.value}
            className={cn("h-7", range === p.value ? "bg-background shadow-xs" : "text-muted-foreground")}
            onClick={() => setRange(p.value)}
          >
            {t(p.label)}
          </Button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {fmtShort(ymd(from))} – {fmtShort(ymd(to))}
      </span>
      {projects ? (
        <Select value={projectId ?? "all"} onValueChange={(v) => setProject(v === "all" ? undefined : v)}>
          <SelectTrigger size="sm" className="ms-auto min-w-40" aria-label={t("Project")}>
            <SelectValue placeholder={t("All projects")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All projects")}</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <ProjectDot project={p} />
                <span className="truncate">{p.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
