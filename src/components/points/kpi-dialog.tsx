"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjects } from "@/hooks/use-data";
import { useT } from "@/lib/i18n";
import { createKpi, deleteKpi, updateKpi } from "@/lib/repo";
import { KPI_METRICS, PRIORITIES, type Kpi, type KpiCadence, type KpiDirection, type KpiMetric, type Priority } from "@/lib/types";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";

// One KPI for one person: what is measured, the target and an optional
// stretch, the cadence it is scored on, its weight, and which issues count.

const DEFAULT_TARGET: Record<KpiMetric, number> = {
  points_delivered: 20,
  commitment_ratio: 85,
  on_time_rate: 90,
  cycle_time_median: 4,
  review_wait: 1,
  reopen_rate: 10,
  manual: 1,
};

export function KpiDialog({ open, onOpenChange, personId, kpi }: { open: boolean; onOpenChange: (v: boolean) => void; personId: string; kpi?: Kpi | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open ? <KpiForm key={kpi?.id ?? "new"} personId={personId} kpi={kpi ?? null} close={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function KpiForm({ personId, kpi, close }: { personId: string; kpi: Kpi | null; close: () => void }) {
  const t = useT();
  const projects = useProjects();
  const [metric, setMetric] = useState<KpiMetric>(kpi?.metric ?? "points_delivered");
  const meta = KPI_METRICS.find((m) => m.value === metric)!;
  const [name, setName] = useState(kpi?.name ?? "");
  const [target, setTarget] = useState(String(kpi?.target ?? DEFAULT_TARGET[metric]));
  const [stretch, setStretch] = useState(kpi?.stretch !== undefined ? String(kpi.stretch) : "");
  const [cadence, setCadence] = useState<KpiCadence>(kpi?.cadence ?? "quarter");
  const [weight, setWeight] = useState(String(kpi?.weight ?? 25));
  const [direction, setDirection] = useState<KpiDirection>(kpi?.direction ?? meta.direction);
  const [unit, setUnit] = useState(kpi?.unit ?? "");
  const [projectId, setProjectId] = useState(kpi?.filter?.projectIds?.[0] ?? "");
  const [labels, setLabels] = useState((kpi?.filter?.labels ?? []).join(", "));
  const [priority, setPriority] = useState<Priority | "">(kpi?.filter?.priorities?.[0] ?? "");
  const [minSample, setMinSample] = useState(String(kpi?.minSample ?? 3));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const nTarget = Number(target);
  const nStretch = stretch.trim() === "" ? undefined : Number(stretch);
  const nWeight = Number(weight);
  const dir = metric === "manual" ? direction : meta.direction;
  const stretchOk = nStretch === undefined || (dir === "higher" ? nStretch > nTarget : nStretch < nTarget);
  const valid = Number.isFinite(nTarget) && nTarget >= 0 && Number.isFinite(nWeight) && nWeight > 0 && stretchOk;

  function pickMetric(v: KpiMetric) {
    setMetric(v);
    if (!kpi) setTarget(String(DEFAULT_TARGET[v]));
    setDirection(KPI_METRICS.find((m) => m.value === v)!.direction);
  }

  async function submit() {
    if (!valid) return;
    const filter = {
      ...(projectId ? { projectIds: [projectId] } : {}),
      ...(labels.trim() ? { labels: labels.split(",").map((l) => l.trim()).filter(Boolean) } : {}),
      ...(priority ? { priorities: [priority] } : {}),
    };
    const patch = {
      name: name.trim() || t(meta.label),
      metric,
      direction: dir,
      target: nTarget,
      stretch: nStretch,
      cadence,
      weight: nWeight,
      filter: Object.keys(filter).length ? filter : undefined,
      minSample: meta.rate ? Math.max(1, Math.round(Number(minSample) || 3)) : undefined,
      unit: metric === "manual" ? unit.trim() || undefined : undefined,
    };
    if (kpi) await updateKpi(kpi.id, patch);
    else await createKpi({ personId, ...patch });
    toast.success(kpi ? t("KPI updated") : t("KPI added"));
    close();
  }

  const unitLabel = metric === "manual" ? unit || t("value") : meta.unit;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{kpi ? t("Edit KPI") : t("New KPI")}</DialogTitle>
        <DialogDescription>{t("A few KPIs that matter beat many that do not. Three to five per person, weighted, is plenty.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("What is measured")}</Label>
          <Select value={metric} onValueChange={(v) => pickMetric(v as KpiMetric)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KPI_METRICS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {t(m.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(meta.hint)} {meta.direction === "lower" ? t("Lower is better.") : null}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="kpi-name" className="text-xs text-muted-foreground">
            {t("Name")}
          </Label>
          <Input id="kpi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(meta.label)} dir="auto" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="kpi-target" className="text-xs text-muted-foreground">
              {t("Target")} ({unitLabel})
            </Label>
            <Input id="kpi-target" type="number" min={0} step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="kpi-stretch" className="text-xs text-muted-foreground">
              {t("Stretch")}
            </Label>
            <Input id="kpi-stretch" type="number" min={0} step="any" value={stretch} onChange={(e) => setStretch(e.target.value)} placeholder={t("optional")} aria-invalid={!stretchOk || undefined} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="kpi-weight" className="text-xs text-muted-foreground">
              {t("Weight")}
            </Label>
            <Input id="kpi-weight" type="number" min={1} step={1} value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("Scored per")}</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as KpiCadence)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">{t("Month")}</SelectItem>
                <SelectItem value="quarter">{t("Quarter")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {!stretchOk ? <p className="text-xs text-destructive">{dir === "higher" ? t("The stretch goal must be above the target.") : t("The stretch goal must be below the target.")}</p> : null}
        {metric === "manual" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="kpi-unit" className="text-xs text-muted-foreground">
                {t("Unit")}
              </Label>
              <Input id="kpi-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("e.g. talks, interviews")} dir="auto" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">{t("Better when")}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as KpiDirection)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="higher">{t("Higher")}</SelectItem>
                  <SelectItem value="lower">{t("Lower")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-xs text-muted-foreground">{t("Which issues count (all of theirs when empty)")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Select value={projectId || "__all"} onValueChange={(v) => setProjectId(v === "__all" ? "" : v)}>
                <SelectTrigger size="sm" aria-label={t("Project")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("Any project")}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priority || "__all"} onValueChange={(v) => setPriority(v === "__all" ? "" : (v as Priority))}>
                <SelectTrigger size="sm" aria-label={t("Priority")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("Any priority")}</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {t(p.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={t("Labels, comma separated")} className="h-8 text-xs" dir="auto" aria-label={t("Labels")} />
            </div>
            {meta.rate ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Label htmlFor="kpi-min" className="text-xs font-normal">
                  {t("Score only with at least")}
                </Label>
                <Input id="kpi-min" type="number" min={1} value={minSample} onChange={(e) => setMinSample(e.target.value)} className="h-7 w-16 text-xs" />
                <span>{t("issues in the period")}</span>
              </div>
            ) : null}
          </fieldset>
        )}
      </div>
      <DialogFooter className="sm:justify-between">
        {kpi ? (
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> {t("Delete")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!valid}>
            {kpi ? t("Save") : t("Add KPI")}
          </Button>
        </div>
      </DialogFooter>
      {kpi ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t("Delete this KPI?")}
          description={t('"{name}" and its manual results will be removed. Points already earned are not affected.', { name: kpi.name })}
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await deleteKpi(kpi.id);
            toast.success(t("KPI deleted"));
            close();
          }}
        />
      ) : null}
    </>
  );
}
