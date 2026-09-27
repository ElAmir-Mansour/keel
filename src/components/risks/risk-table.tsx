"use client";
import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Circle, OctagonAlert, ShieldCheck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PersonAvatar, ProjectChip } from "@/components/ui-bits";
import { ago, fmtShort, isOverdue } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { RISK_KINDS, RISK_STATUSES, riskScore, type Person, type Project, type Risk, type RiskStatus } from "@/lib/types";

// Likelihood × impact, 1–25. Bands match the dashboard's heat map.
export function severity(score: number) {
  if (score >= 15) return { label: "Critical", color: "var(--viz-critical)", Icon: OctagonAlert } as const;
  if (score >= 10) return { label: "High", color: "var(--viz-serious)", Icon: AlertTriangle } as const;
  if (score >= 5) return { label: "Medium", color: "var(--viz-warning)", Icon: AlertCircle } as const;
  return { label: "Low", color: "var(--viz-good)", Icon: CheckCircle2 } as const;
}

export function SeverityChip({ score, className }: { score: number; className?: string }) {
  const s = severity(score);
  const t = useT();
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium tabular", className)}
      style={{ borderColor: `color-mix(in oklab, ${s.color} 40%, transparent)`, backgroundColor: `color-mix(in oklab, ${s.color} 10%, transparent)` }}
    >
      <s.Icon className="size-3" style={{ color: s.color }} />
      {score} · {t(s.label)}
    </span>
  );
}

export function riskStatusLabel(status: RiskStatus) {
  return RISK_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function RiskStatusIcon({ status, className }: { status: RiskStatus; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "open":
      return <Circle className={cn(c, "text-foreground/70")} />;
    case "mitigating":
      return <Wrench className={cn(c, "text-[var(--viz-series-4)]")} />;
    case "accepted":
      return <ShieldCheck className={cn(c, "text-[var(--viz-series-7)]")} />;
    case "closed":
      return <CheckCircle2 className={cn(c, "text-[var(--viz-good)]")} />;
  }
}

export function riskKindLabel(kind: Risk["kind"]) {
  return RISK_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function riskKey(project: Pick<Project, "key"> | undefined, risk: Pick<Risk, "seq">) {
  return `${project?.key ?? "?"}-R${risk.seq}`;
}

type SortKey = "score" | "title" | "status" | "due" | "updated";
type Sort = { key: SortKey; dir: 1 | -1 };

const STATUS_ORDER: RiskStatus[] = ["open", "mitigating", "accepted", "closed"];

function SortHead({ k, sort, onToggle, className, children }: { k: SortKey; sort: Sort; onToggle: (k: SortKey) => void; className?: string; children: React.ReactNode }) {
  const active = sort.key === k;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onToggle(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        {active ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </TableHead>
  );
}

function compare(a: Risk, b: Risk, key: SortKey) {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "status":
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    case "due":
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    case "updated":
      return a.updatedAt.localeCompare(b.updatedAt);
    default:
      return riskScore(a) - riskScore(b);
  }
}

/** The RAID table shared by the global register and a project's risks tab. */
export function RiskTable({
  risks,
  projects,
  people,
  showProject = true,
  onOpen,
  loading = false,
  emptyText,
}: {
  risks: Risk[];
  projects: Project[];
  people: Person[];
  showProject?: boolean;
  onOpen: (risk: Risk) => void;
  loading?: boolean;
  emptyText?: string;
}) {
  const t = useT();
  const [sort, setSort] = useState<Sort>({ key: "score", dir: -1 });
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const rows = useMemo(() => [...risks].sort((a, b) => compare(a, b, sort.key) * sort.dir || riskScore(b) - riskScore(a)), [risks, sort]);

  function toggle(key: SortKey) {
    // Score and dates read best descending on first click.
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "title" || key === "status" ? 1 : -1 }));
  }

  const cols = 9 + (showProject ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">{t("Kind")}</TableHead>
            <TableHead className="w-24">{t("Ref")}</TableHead>
            <SortHead k="title" sort={sort} onToggle={toggle}>
              {t("Title")}
            </SortHead>
            {showProject ? <TableHead className="w-36 max-md:hidden">{t("Project")}</TableHead> : null}
            <TableHead className="w-10 text-center max-lg:hidden" title={t("Likelihood")}>
              {t("L")}
            </TableHead>
            <TableHead className="w-10 text-center max-lg:hidden" title={t("Impact")}>
              {t("I")}
            </TableHead>
            <SortHead k="score" sort={sort} onToggle={toggle} className="w-36">
              {t("Score")}
            </SortHead>
            <SortHead k="status" sort={sort} onToggle={toggle} className="w-32 max-sm:hidden">
              {t("Status")}
            </SortHead>
            <TableHead className="w-12">{t("Owner")}</TableHead>
            <SortHead k="due" sort={sort} onToggle={toggle} className="w-28 max-md:hidden">
              {t("Due")}
            </SortHead>
            <SortHead k="updated" sort={sort} onToggle={toggle} className="w-28 max-lg:hidden">
              {t("Updated")}
            </SortHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={cols}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : rows.map((r) => {
                const project = projectById.get(r.projectId);
                const score = riskScore(r);
                const overdue = r.status !== "closed" && isOverdue(r.dueDate);
                return (
                  <TableRow
                    key={r.id}
                    tabIndex={0}
                    className={cn("cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none", r.status === "closed" && "text-muted-foreground")}
                    onClick={() => onOpen(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onOpen(r);
                    }}
                  >
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {t(riskKindLabel(r.kind))}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{riskKey(project, r)}</TableCell>
                    <TableCell className="max-w-0">
                      <span className="block truncate font-medium" dir="auto">
                        {r.title}
                      </span>
                    </TableCell>
                    {showProject ? <TableCell className="max-md:hidden">{project ? <ProjectChip project={project} link={false} /> : null}</TableCell> : null}
                    <TableCell className="text-center tabular max-lg:hidden">{r.likelihood}</TableCell>
                    <TableCell className="text-center tabular max-lg:hidden">{r.impact}</TableCell>
                    <TableCell>
                      <SeverityChip score={score} />
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <RiskStatusIcon status={r.status} />
                        {t(riskStatusLabel(r.status))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PersonAvatar person={r.ownerId ? personById.get(r.ownerId) : null} size="xs" />
                    </TableCell>
                    <TableCell className={cn("text-xs tabular max-md:hidden", overdue ? "font-medium text-[var(--viz-critical)]" : "text-muted-foreground")}>
                      {r.dueDate ? (
                        <>
                          {fmtShort(r.dueDate)}
                          {overdue ? ` · ${t("overdue")}` : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular max-lg:hidden" title={r.updatedAt}>
                      {ago(r.updatedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={cols} className="py-10 text-center text-sm text-muted-foreground">
                {emptyText ?? t("No risks match.")}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
