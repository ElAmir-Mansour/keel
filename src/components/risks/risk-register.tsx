"use client";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ProjectDot } from "@/components/ui-bits";
import { usePeople, useProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { useT } from "@/lib/i18n";
import { RISK_KINDS, RISK_STATUSES } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { useUrlFilters } from "@/components/notes/use-url-filters";
import { RiskSheet } from "./risk-sheet";
import { RiskStatusIcon, RiskTable } from "./risk-table";

// likelihood/impact preselect a heat-map cell from the dashboard.
const KEYS = ["status", "kind", "project", "likelihood", "impact"] as const;

/**
 * Filters, table and side-panel editor for the RAID register. With a
 * projectId it is the project's risks tab; without, the global register.
 * The New button is rendered here only for the project tab — the global
 * page puts it in its PageHeader.
 */
export function RiskRegister({ projectId }: { projectId?: string }) {
  const { openQuickCreate } = useUi();
  const t = useT();
  const projects = useProjects();
  const people = usePeople();
  const risks = useLiveQuery(() => (projectId ? db.risks.where({ projectId }).toArray() : db.risks.toArray()), [projectId], null);
  const [f, setF] = useUrlFilters(KEYS);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      (risks ?? []).filter((r) => {
        if (f.status === "all" ? false : f.status ? r.status !== f.status : r.status === "closed") return false;
        if (f.kind && r.kind !== f.kind) return false;
        if (!projectId && f.project && r.projectId !== f.project) return false;
        if (f.likelihood && String(r.likelihood) !== f.likelihood) return false;
        if (f.impact && String(r.impact) !== f.impact) return false;
        return true;
      }),
    [risks, f, projectId],
  );

  const cell = f.likelihood && f.impact ? t("Likelihood {l} × impact {i}", { l: f.likelihood, i: f.impact }) : f.likelihood ? t("Likelihood {l}", { l: f.likelihood }) : f.impact ? t("Impact {i}", { i: f.impact }) : "";

  if (risks && risks.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={projectId ? t("No risks for this project") : t("The register is empty")}
        description={t("Risks, assumptions, issues and dependencies, each scored likelihood × impact so the register sorts itself by what deserves attention.")}
      >
        <Button size="sm" onClick={() => openQuickCreate("risk", projectId)}>
          <Plus /> {t("New risk")}
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.status || "__open"} onValueChange={(v) => setF({ status: v === "__open" ? "" : v })}>
          <SelectTrigger size="sm" className="w-auto" aria-label={t("Status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__open">{t("Not closed")}</SelectItem>
            <SelectItem value="all">{t("All statuses")}</SelectItem>
            {RISK_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <RiskStatusIcon status={s.value} /> {t(s.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.kind || "__all"} onValueChange={(v) => setF({ kind: v === "__all" ? "" : v })}>
          <SelectTrigger size="sm" className="w-auto" aria-label={t("Kind")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("All kinds")}</SelectItem>
            {RISK_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {t(k.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!projectId ? (
          <Select value={f.project || "__all"} onValueChange={(v) => setF({ project: v === "__all" ? "" : v })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Project")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("All projects")}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <ProjectDot project={p} /> {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {cell ? (
          <button type="button" onClick={() => setF({ likelihood: "", impact: "" })} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted" aria-label={t("Clear cell filter")}>
            {cell}
            <X className="size-3" />
          </button>
        ) : null}
        <span className="ms-auto text-xs text-muted-foreground tabular">
          {t("{shown} of {total}", { shown: rows.length, total: risks?.length ?? 0 })}
        </span>
        {projectId ? (
          <Button size="sm" onClick={() => openQuickCreate("risk", projectId)}>
            <Plus /> {t("New risk")}
          </Button>
        ) : null}
      </div>

      <RiskTable risks={rows} projects={projects} people={people} showProject={!projectId} onOpen={(r) => setSelected(r.id)} loading={risks === null} emptyText={t("No risks match these filters.")} />

      <RiskSheet riskId={selected} onClose={() => setSelected(null)} projects={projects} people={people} />
    </div>
  );
}
