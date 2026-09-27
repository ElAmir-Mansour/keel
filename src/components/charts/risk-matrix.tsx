"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ChartColumn, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_COLOR } from "@/lib/chart-theme";
import { useT } from "@/lib/i18n";
import { riskMatrix } from "@/lib/metrics";
import { RISK_STATUSES, riskScore, type Project, type Risk } from "@/lib/types";
import { ProjectDot } from "@/components/ui-bits";
import { DataTable, Swatch } from "./chart-card";

// 5×5 likelihood × impact grid. Colour is the severity band of the cell's
// score, never the count; the count is the label. Cells link to the risk
// register filtered to that cell.

export type Band = "good" | "warning" | "serious" | "critical";

export function scoreBand(score: number): Band {
  if (score >= 15) return "critical";
  if (score >= 10) return "serious";
  if (score >= 5) return "warning";
  return "good";
}

// Labels stay English here and are translated at render with t(label).
export const BAND_LABEL: Record<Band, string> = {
  good: "Low (≤4)",
  warning: "Moderate (5–9)",
  serious: "High (10–14)",
  critical: "Critical (≥15)",
};

const SCALE = [1, 2, 3, 4, 5] as const;

export function RiskMatrixCard({
  risks,
  projects,
  loading,
  title,
  subtitle,
  showProject = true,
}: {
  risks: Risk[];
  projects: Project[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
  showProject?: boolean;
}) {
  const t = useT();
  const [table, setTable] = useState(false);
  const open = useMemo(() => risks.filter((r) => r.status !== "closed"), [risks]);
  const grid = useMemo(() => riskMatrix(open), [open]);
  const top = useMemo(() => [...open].sort((a, b) => riskScore(b) - riskScore(a) || a.updatedAt.localeCompare(b.updatedAt)).slice(0, 5), [open]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Band is kept as its English key here and translated where the rows are rendered.
  const tableRows = useMemo(() => {
    const rows: { impact: number; likelihood: number; score: number; band: string; count: number }[] = [];
    for (const i of [...SCALE].reverse()) for (const l of SCALE) rows.push({ impact: i, likelihood: l, score: i * l, band: BAND_LABEL[scoreBand(i * l)], count: grid[i][l] });
    return rows;
  }, [grid]);

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">{title ?? t("Risk matrix")}</CardTitle>
        <CardDescription className="text-xs">{subtitle ?? t("Open risks by likelihood and impact")}</CardDescription>
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-pressed={table} aria-label={table ? t("Show grid") : t("Show table")} onClick={() => setTable((v) => !v)}>
                {table ? <ChartColumn className="size-3.5" /> : <Table2 className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{table ? t("Show grid") : t("Show as table")}</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-52 w-full" />
        ) : table ? (
          <div className="max-h-52 overflow-auto">
            <DataTable
              columns={[
                { key: "impact", label: t("Impact"), align: "end" },
                { key: "likelihood", label: t("Likelihood"), align: "end" },
                { key: "score", label: t("Score"), align: "end" },
                { key: "band", label: t("Band") },
                { key: "count", label: t("Open"), align: "end" },
              ]}
              rows={tableRows.map((r) => ({ ...r, band: t(r.band) }))}
            />
          </div>
        ) : (
          <Matrix grid={grid} />
        )}
        <TopRisksTable risks={top} projectById={projectById} showProject={showProject} loading={loading} />
      </CardContent>
    </Card>
  );
}

function Matrix({ grid }: { grid: number[][] }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <div className="flex w-4 shrink-0 items-center justify-center">
        <span className="-rotate-90 whitespace-nowrap text-[11px] text-muted-foreground">{t("Impact →")}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-5 gap-0.5" role="grid" aria-label={t("Risk matrix")}>
          {[...SCALE].reverse().map((impact) =>
            SCALE.map((likelihood) => {
              const score = impact * likelihood;
              const band = scoreBand(score);
              const count = grid[impact][likelihood];
              const color = STATUS_COLOR[band];
              const bandLabel = t(BAND_LABEL[band]);
              return (
                <Link
                  key={`${impact}-${likelihood}`}
                  role="gridcell"
                  href={`/risks?likelihood=${likelihood}&impact=${impact}`}
                  aria-label={t("Impact {impact}, likelihood {likelihood}: {count} open, {band}", { impact, likelihood, count, band: bandLabel })}
                  title={t("Impact {impact} × likelihood {likelihood} = {score} · {band}", { impact, likelihood, score, band: bandLabel })}
                  className={cn(
                    "flex aspect-[5/4] items-center justify-center rounded-[3px] text-sm font-medium ring-inset transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110",
                    count === 0 && "text-muted-foreground/50",
                  )}
                  style={{ backgroundColor: `color-mix(in oklab, ${color} ${count ? 42 : 12}%, transparent)` }}
                >
                  {count || "·"}
                </Link>
              );
            }),
          )}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{t("Likelihood 1")}</span>
          <span>{t("→ 5")}</span>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(Object.keys(BAND_LABEL) as Band[]).map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <Swatch color={`color-mix(in oklab, ${STATUS_COLOR[b]} 42%, transparent)`} />
              {t(BAND_LABEL[b])}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TopRisksTable({
  risks,
  projectById,
  showProject = true,
  loading,
}: {
  risks: Risk[];
  projectById: Map<string, Project>;
  showProject?: boolean;
  loading?: boolean;
}) {
  const t = useT();
  if (loading) return null;
  if (!risks.length) return <p className="text-xs text-muted-foreground">{t("No open risks.")}</p>;
  return (
    <ul className="divide-y text-xs">
      {risks.map((r) => {
        const score = riskScore(r);
        const band = scoreBand(score);
        const p = projectById.get(r.projectId);
        return (
          <li key={r.id} className="flex items-center gap-2 py-1.5">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-[4px] font-medium tabular-nums"
              style={{ backgroundColor: `color-mix(in oklab, ${STATUS_COLOR[band]} 42%, transparent)` }}
              title={`${r.likelihood} × ${r.impact} · ${t(BAND_LABEL[band])}`}
            >
              {score}
            </span>
            <Link href={`/projects/${r.projectId}/risks`} className="min-w-0 flex-1 truncate hover:underline" dir="auto">
              {band === "critical" ? <AlertTriangle className="me-1 inline size-3 text-[var(--viz-critical)]" aria-label={t("Critical")} /> : null}
              {r.title}
            </Link>
            {showProject && p ? (
              <span className="hidden items-center gap-1 text-muted-foreground sm:inline-flex">
                <ProjectDot project={p} /> {p.key}
              </span>
            ) : null}
            <span className="shrink-0 text-muted-foreground">{t(RISK_STATUSES.find((s) => s.value === r.status)?.label ?? r.status)}</span>
          </li>
        );
      })}
    </ul>
  );
}
