"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { createMilestone, deleteMilestone, updateMilestone } from "@/lib/repo";
import type { Milestone, MilestoneStatus } from "@/lib/types";
import { MILESTONE_STATUSES, MilestoneStatusIcon } from "./roadmap-timeline";

export function MilestoneDialog({
  open,
  onOpenChange,
  projectId,
  milestone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  milestone?: Milestone | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <MilestoneForm key={milestone?.id ?? "new"} projectId={projectId} milestone={milestone ?? null} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MilestoneForm({ projectId, milestone, close }: { projectId: string; milestone: Milestone | null; close: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? "planned");
  const [startDate, setStartDate] = useState(milestone?.startDate ?? "");
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const invalidRange = Boolean(startDate && dueDate && startDate > dueDate);
  const canSave = Boolean(title.trim()) && !invalidRange && !busy;

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    try {
      const patch = { title: title.trim(), status, startDate: startDate || undefined, dueDate: dueDate || undefined, description };
      if (milestone) {
        await updateMilestone(milestone.id, patch);
      } else {
        await createMilestone({ projectId, ...patch });
        toast.success(t("Milestone created"));
      }
      close();
    } catch (e) {
      toast.error(t("Could not save milestone"), { description: e instanceof Error ? e.message : undefined });
      setBusy(false);
    }
  }

  async function remove() {
    if (!milestone) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await deleteMilestone(milestone.id);
      toast.success(t("Milestone deleted"), { description: t("Its issues were kept and now have no milestone.") });
      close();
    } catch (e) {
      toast.error(t("Could not delete milestone"), { description: e instanceof Error ? e.message : undefined });
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !(e.target instanceof HTMLTextAreaElement))) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{milestone ? t("Edit milestone") : t("New milestone")}</DialogTitle>
        <DialogDescription>{t("A dated chunk of work: a release, a phase, a demo. Issues roll up into it.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Milestone title")} dir="auto" aria-label={t("Title")} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as MilestoneStatus)}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MILESTONE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <MilestoneStatusIcon status={s.value} /> {t(s.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Label htmlFor="ms-start" className="text-xs text-muted-foreground">{t("Start")}</Label>
            <Input id="ms-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-7 w-auto text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="ms-due" className="text-xs text-muted-foreground">{t("Due")}</Label>
            <Input id="ms-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-7 w-auto text-xs" aria-invalid={invalidRange || undefined} />
          </div>
        </div>
        {invalidRange ? <p className="text-xs text-destructive">{t("The due date is before the start date.")}</p> : null}
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("What this milestone delivers (optional, markdown)")} rows={3} dir="auto" />
      </div>
      <DialogFooter className="sm:justify-between">
        {milestone ? (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={remove} disabled={busy}>
            {confirmDelete ? t("Confirm delete") : t("Delete")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={close}>{t("Cancel")}</Button>
          <Button type="button" onClick={submit} disabled={!canSave}>{milestone ? t("Save") : t("Create")}</Button>
        </div>
      </DialogFooter>
    </>
  );
}
