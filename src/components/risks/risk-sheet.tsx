"use client";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownEditor } from "@/components/markdown";
import { ScoreSelect } from "@/components/quick-create";
import { PersonAvatar, ProjectChip } from "@/components/ui-bits";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { deleteRisk, updateRisk } from "@/lib/repo";
import { RISK_KINDS, RISK_STATUSES, riskScore, type Person, type Project, type Risk, type RiskKind, type RiskStatus } from "@/lib/types";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { useDraft } from "@/components/notes/use-draft";
import { riskKey, RiskStatusIcon, SeverityChip } from "./risk-table";

/** Side-panel editor for one risk. Every field saves as you go. */
export function RiskSheet({ riskId, onClose, projects, people }: { riskId: string | null; onClose: () => void; projects: Project[]; people: Person[] }) {
  const risk = useLiveQuery(() => (riskId ? db.risks.get(riskId) : undefined), [riskId]);
  const t = useT();
  return (
    <Sheet open={riskId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {risk ? <RiskForm key={risk.id} risk={risk} projects={projects} people={people} onClose={onClose} /> : <SheetHeader><SheetTitle>{t("Risk")}</SheetTitle></SheetHeader>}
      </SheetContent>
    </Sheet>
  );
}

function RiskForm({ risk, projects, people, onClose }: { risk: Risk; projects: Project[]; people: Person[]; onClose: () => void }) {
  const project = useMemo(() => projects.find((p) => p.id === risk.projectId), [projects, risk.projectId]);
  const t = useT();
  const [title, setTitle] = useDraft(risk.title, (v) => updateRisk(risk.id, { title: v.trim() || risk.title }));
  const [description, setDescription] = useDraft(risk.description, (d) => updateRisk(risk.id, { description: d }));
  const [mitigation, setMitigation] = useDraft(risk.mitigation, (m) => updateRisk(risk.id, { mitigation: m }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aiContext = useMemo(() => ({ projectId: risk.projectId }), [risk.projectId]);
  const score = riskScore(risk);

  async function remove() {
    await deleteRisk(risk.id);
    toast.success(t("Risk deleted"));
    onClose();
  }

  return (
    <>
      <SheetHeader className="pb-0">
        <div className="flex flex-wrap items-center gap-2 pe-8 font-mono text-xs text-muted-foreground">
          {riskKey(project, risk)}
          {project ? <ProjectChip project={project} link={false} className="font-sans" /> : null}
          <SeverityChip score={score} className="ms-auto font-sans" />
        </div>
        <SheetTitle className="sr-only">{risk.title}</SheetTitle>
        <SheetDescription className="sr-only">{t("Edit this risk. Changes save automatically.")}</SheetDescription>
      </SheetHeader>

      <div className="grid gap-4 px-4 pb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
          dir="auto"
          aria-label={t("Title")}
          className="w-full bg-transparent text-lg font-semibold tracking-tight outline-none"
        />

        <div className="flex flex-wrap gap-2">
          <Select value={risk.kind} onValueChange={(v) => void updateRisk(risk.id, { kind: v as RiskKind })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Kind")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISK_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {t(k.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={risk.status} onValueChange={(v) => void updateRisk(risk.id, { status: v as RiskStatus })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISK_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <RiskStatusIcon status={s.value} /> {t(s.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ScoreSelect label={t("Likelihood")} value={risk.likelihood} onChange={(v) => void updateRisk(risk.id, { likelihood: v as Risk["likelihood"] })} />
          <ScoreSelect label={t("Impact")} value={risk.impact} onChange={(v) => void updateRisk(risk.id, { impact: v as Risk["impact"] })} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t("Owner")}</Label>
            <Select value={risk.ownerId ?? "__none"} onValueChange={(v) => void updateRisk(risk.id, { ownerId: v === "__none" ? undefined : v })}>
              <SelectTrigger size="sm" className="w-auto" aria-label={t("Owner")}>
                <SelectValue placeholder={t("Unassigned")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t("Unassigned")}</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <PersonAvatar person={p} size="xs" /> {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`due-${risk.id}`} className="text-xs text-muted-foreground">
              {t("Due")}
            </Label>
            <Input id={`due-${risk.id}`} type="date" value={risk.dueDate ?? ""} onChange={(e) => void updateRisk(risk.id, { dueDate: e.target.value || undefined })} className="h-7 w-auto text-xs" />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`desc-${risk.id}`} className="text-xs text-muted-foreground">
            {t("Description")}
          </Label>
          <Textarea id={`desc-${risk.id}`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} dir="auto" placeholder={t("What could happen, and what it would cost.")} />
        </div>

        <div className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">{t("Mitigation")}</span>
          <MarkdownEditor value={mitigation} onChange={setMitigation} minRows={4} placeholder={t("What reduces the likelihood or the impact, and who is doing it.")} aiContext={aiContext} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>{t("Created {date}", { date: fmtDate(risk.createdAt) })}</span>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> {t("Delete")}
          </Button>
        </div>
      </div>

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("Delete this risk?")} description={t('"{title}" will be removed from the register.', { title: risk.title })} confirmLabel="Delete" destructive onConfirm={remove} />
    </>
  );
}
