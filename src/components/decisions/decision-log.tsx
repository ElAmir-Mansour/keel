"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, ProjectChip, ProjectDot } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { DECISION_STATUSES } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { useUrlFilters } from "@/components/notes/use-url-filters";
import { DecisionStatusBadge, DecisionStatusIcon } from "./decision-status";

const KEYS = ["status", "project"] as const;

/** /decisions — the ADR log. */
export function DecisionLog() {
  const router = useRouter();
  const { openQuickCreate } = useUi();
  const t = useT();
  const decisions = useLiveQuery(() => db.decisions.orderBy("seq").reverse().toArray(), [], null);
  const projects = useProjects();
  const [f, setF] = useUrlFilters(KEYS);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const rows = useMemo(
    () => (decisions ?? []).filter((d) => (!f.status || d.status === f.status) && (!f.project || (f.project === "__none" ? !d.projectId : d.projectId === f.project))),
    [decisions, f.status, f.project],
  );

  const actions = (
    <Button size="sm" onClick={() => openQuickCreate("decision")}>
      <Plus /> {t("New decision")}
    </Button>
  );

  if (decisions && decisions.length === 0) {
    return (
      <>
        <PageHeader title={t("Decisions")} description={t("Architecture decision records: context, decision, consequences. Numbered once, never renumbered.")} actions={actions} />
        <EmptyState icon={<Scale />} title={t("No decisions recorded")} description={t("Write the first ADR when you next choose between two ways of doing something. Notes can cite it as [[ADR-1]] and it will list where it is mentioned.")}>
          <Button size="sm" onClick={() => openQuickCreate("decision")}>
            <Plus /> {t("New decision")}
          </Button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("Decisions")} description={t("Architecture decision records: context, decision, consequences. Numbered once, never renumbered.")} actions={actions}>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={f.status || "__all"} onValueChange={(v) => setF({ status: v === "__all" ? "" : v })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("All statuses")}</SelectItem>
              {DECISION_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <DecisionStatusIcon status={s.value} /> {t(s.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={f.project || "__all"} onValueChange={(v) => setF({ project: v === "__all" ? "" : v })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Project")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("All projects")}</SelectItem>
              <SelectItem value="__none">{t("No project")}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <ProjectDot project={p} /> {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {f.status || f.project ? (
            <Button variant="ghost" size="sm" onClick={() => setF({ status: "", project: "" })}>
              {t("Clear")}
            </Button>
          ) : null}
          <span className="ms-auto text-xs text-muted-foreground tabular">
            {t("{shown} of {total}", { shown: rows.length, total: decisions?.length ?? 0 })}
          </span>
        </div>
      </PageHeader>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">ADR</TableHead>
              <TableHead>{t("Title")}</TableHead>
              <TableHead className="w-32">{t("Status")}</TableHead>
              <TableHead className="w-40 max-md:hidden">{t("Project")}</TableHead>
              <TableHead className="w-28 max-sm:hidden">{t("Date")}</TableHead>
              <TableHead className="max-lg:hidden">{t("Tags")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {decisions === null
              ? Array.from({ length: 4 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((d) => {
                  const project = d.projectId ? projectById.get(d.projectId) : undefined;
                  return (
                    <TableRow key={d.id} className="cursor-pointer" onClick={() => router.push(`/decisions/${d.id}`)}>
                      <TableCell className="font-mono text-xs text-muted-foreground">ADR-{d.seq}</TableCell>
                      <TableCell className="max-w-0">
                        <Link href={`/decisions/${d.id}`} className="block truncate font-medium hover:underline" dir="auto" onClick={(e) => e.stopPropagation()}>
                          {d.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <DecisionStatusBadge status={d.status} />
                      </TableCell>
                      <TableCell className="max-md:hidden">{project ? <ProjectChip project={project} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular max-sm:hidden">{fmtDate(d.date)}</TableCell>
                      <TableCell className="max-w-0 truncate text-xs text-muted-foreground max-lg:hidden" dir="auto">
                        {d.tags.map((tag) => `#${tag}`).join(" ")}
                      </TableCell>
                    </TableRow>
                  );
                })}
            {decisions && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {t("No decisions match these filters.")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
