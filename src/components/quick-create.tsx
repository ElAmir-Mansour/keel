"use client";
import { useT } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActiveProjects, usePeople } from "@/hooks/use-data";
import { createDecision, createIssue, createIssuesFromLines, createNote, createPerson, createProject, createRisk, createTimeline, normalizeKey } from "@/lib/repo";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { ISSUE_STATUSES, NOTE_KINDS, PRIORITIES, PROJECT_COLORS, RISK_KINDS, type IssueStatus, type NoteKind, type Priority, type RiskKind } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { StatusIcon, PriorityIcon, ProjectDot } from "@/components/ui-bits";
import { todayYMD } from "@/lib/dates";

// One dialog for every "New …" action so creation feels the same everywhere:
// title first, sensible defaults, Enter to save, ⌘Enter from a textarea.

export function QuickCreate() {
  const { quickCreate, closeQuickCreate } = useUi();
  const open = Boolean(quickCreate);
  const kind = quickCreate?.kind;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeQuickCreate()}>
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        {kind === "issue" ? <IssueForm projectId={quickCreate?.projectId} /> : null}
        {kind === "note" ? <NoteForm projectId={quickCreate?.projectId} /> : null}
        {kind === "decision" ? <DecisionForm projectId={quickCreate?.projectId} /> : null}
        {kind === "risk" ? <RiskForm projectId={quickCreate?.projectId} /> : null}
        {kind === "project" ? <ProjectForm /> : null}
        {kind === "person" ? <PersonForm /> : null}
        {kind === "timeline" ? <TimelineForm projectId={quickCreate?.projectId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function useSubmitOnEnter(submit: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !(e.target instanceof HTMLTextAreaElement))) {
      e.preventDefault();
      submit();
    }
  };
}

function IssueForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const router = useRouter();
  const projects = useActiveProjects();
  const people = usePeople();
  const [chosenProject, setProjectId] = useState("");
  const projectId = chosenProject || initial || projects[0]?.id || "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("none");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    try {
      if (multi) {
        const created = await createIssuesFromLines(projectId, title);
        toast.success(t("Created {n} issues", { n: created.length }));
        closeQuickCreate();
      } else {
        const issue = await createIssue({ projectId, title, description, status, priority, assigneeId: assigneeId || undefined, dueDate: dueDate || undefined });
        const p = projects.find((x) => x.id === projectId);
        toast.success(t("Created {key}", { key: `${p?.key}-${issue.seq}` }), { action: { label: t("Open issue"), onClick: () => router.push(`/projects/${projectId}/issues/${issue.seq}`) } });
        closeQuickCreate();
      }
    } finally {
      setBusy(false);
    }
  }
  const onKey = useSubmitOnEnter(submit);

  if (!projects.length) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("New issue")}</DialogTitle>
          <DialogDescription>{t("Create a project first — issues live inside projects.")}</DialogDescription>
        </DialogHeader>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New issue")}</DialogTitle>
        <DialogDescription>{t("Write the issue, not a user story. One line is enough.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <div className="flex flex-wrap gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder={t("Project")} /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
            <SelectTrigger size="sm" className="w-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ISSUE_STATUSES.filter((s) => s.value !== "cancelled").map((s) => (
                <SelectItem key={s.value} value={s.value}><StatusIcon status={s.value} /> {t(s.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger size="sm" className="w-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}><PriorityIcon priority={p.value} /> {t(p.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assigneeId || "__none"} onValueChange={(v) => setAssigneeId(v === "__none" ? "" : v)}>
            <SelectTrigger size="sm" className="w-auto"><SelectValue placeholder={t("Assignee")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t("Unassigned")}</SelectItem>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {multi ? (
          <Textarea autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("One issue per line\n- Fix login redirect\n- Add audit log index")} rows={6} dir="auto" />
        ) : (
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Issue title")} dir="auto" />
        )}
        {!multi ? <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Description (optional, markdown)")} rows={3} dir="auto" /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="due" className="text-xs text-muted-foreground">{t("Due")}</Label>
            <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 w-auto" />
          </div>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setMulti((m) => !m)}>
            {multi ? t("Single issue") : t("Paste a list → many issues")}
          </button>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit} disabled={!title.trim() || busy}>{t("Create")}</Button>
      </DialogFooter>
    </>
  );
}

function NoteForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const router = useRouter();
  const projects = useActiveProjects();
  const people = usePeople();
  const [kind, setKind] = useState<NoteKind>("page");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(initial ?? "");
  const [personId, setPersonId] = useState("");

  async function submit() {
    const t = title.trim() || (kind === "daily" ? todayYMD() : kind === "oneonone" && personId ? `1:1 — ${people.find((p) => p.id === personId)?.name}` : "Untitled");
    const n = await createNote({ kind, title: t, projectId: projectId || undefined, personId: personId || undefined, body: NOTE_TEMPLATES[kind] });
    closeQuickCreate();
    router.push(`/notes/${n.id}`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New note")}</DialogTitle>
        <DialogDescription>{t("Pick a kind to start from its template. Everything is markdown.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Title")} dir="auto" />
        <div className="flex flex-wrap gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as NoteKind)}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NOTE_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>{t(k.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={projectId || "__none"} onValueChange={(v) => setProjectId(v === "__none" ? "" : v)}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder={t("Project")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t("No project")}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind === "oneonone" ? (
            <Select value={personId || "__none"} onValueChange={(v) => setPersonId(v === "__none" ? "" : v)}>
              <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder={t("With")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t("Nobody")}</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit}>{t("Create")}</Button>
      </DialogFooter>
    </>
  );
}

function DecisionForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const router = useRouter();
  const projects = useActiveProjects();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(initial ?? "");
  async function submit() {
    if (!title.trim()) return;
    const d = await createDecision({ title, projectId: projectId || undefined });
    closeQuickCreate();
    router.push(`/decisions/${d.id}`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New decision")}</DialogTitle>
        <DialogDescription>{t("A short ADR: context, decision, consequences. You fill those in next.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("What was decided?")} dir="auto" />
        <Select value={projectId || "__none"} onValueChange={(v) => setProjectId(v === "__none" ? "" : v)}>
          <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder={t("Project")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t("No project")}</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit} disabled={!title.trim()}>{t("Create")}</Button>
      </DialogFooter>
    </>
  );
}

function RiskForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const router = useRouter();
  const projects = useActiveProjects();
  const [title, setTitle] = useState("");
  const [chosenProject, setProjectId] = useState("");
  const projectId = chosenProject || initial || projects[0]?.id || "";
  const [kind, setKind] = useState<RiskKind>("risk");
  const [likelihood, setLikelihood] = useState(3);
  const [impact, setImpact] = useState(3);
  async function submit() {
    if (!title.trim() || !projectId) return;
    await createRisk({ projectId, title, kind, likelihood: likelihood as 1 | 2 | 3 | 4 | 5, impact: impact as 1 | 2 | 3 | 4 | 5 });
    toast.success(t("Risk added"));
    closeQuickCreate();
    router.push(`/projects/${projectId}/risks`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New risk")}</DialogTitle>
        <DialogDescription>{t("Risk, assumption, issue or dependency. Score likelihood and impact 1–5.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("What could go wrong?")} dir="auto" />
        <div className="flex flex-wrap gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder={t("Project")} /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as RiskKind)}>
            <SelectTrigger size="sm" className="w-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RISK_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>{t(k.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ScoreSelect label={t("Likelihood")} value={likelihood} onChange={setLikelihood} />
          <ScoreSelect label={t("Impact")} value={impact} onChange={setImpact} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit} disabled={!title.trim() || !projectId}>{t("Create")}</Button>
      </DialogFooter>
    </>
  );
}

export function ScoreSelect({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="w-auto"><span className="text-muted-foreground">{label}</span> <SelectValue /></SelectTrigger>
      <SelectContent>
        {[1, 2, 3, 4, 5].map((n) => (
          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProjectForm() {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [typedKey, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const key = keyTouched ? typedKey : suggestKey(name);
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");

  async function submit() {
    if (!name.trim() || !key.trim()) return;
    const p = await createProject({ name, key, color, description, targetDate: targetDate || undefined });
    toast.success(t("Project {key} created", { key: p.key }));
    closeQuickCreate();
    router.push(`/projects/${p.id}`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New project")}</DialogTitle>
        <DialogDescription>{t("A project groups issues, milestones, risks and weekly updates. The key prefixes issue numbers.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Project name")} dir="auto" />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(normalizeKey(e.target.value));
            }}
            placeholder="KEY"
            className="w-24 font-mono uppercase"
            maxLength={6}
          />
          <div className="flex items-center gap-1">
            {PROJECT_COLORS.map((c) => (
              <button key={c} type="button" aria-label={t("Colour {c}", { c })} onClick={() => setColor(c)} className="size-6 rounded-md border-2" style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }} />
            ))}
          </div>
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="h-8 w-auto" aria-label={t("Target date")} />
        </div>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("One paragraph: what this project is for")} rows={3} dir="auto" />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit} disabled={!name.trim() || !key.trim()}>{t("Create")}</Button>
      </DialogFooter>
    </>
  );
}

export function suggestKey(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const base = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 4);
  return normalizeKey(base);
}

function TimelineForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const router = useRouter();
  const projects = useActiveProjects();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(initial ?? "");
  async function submit() {
    if (!title.trim()) return;
    const tl = await createTimeline({ title, projectId: projectId || undefined });
    closeQuickCreate();
    router.push(`/timelines/${tl.id}`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New timeline")}</DialogTitle>
        <DialogDescription>{t("Name it, then type dated lines on the next screen. The chart draws itself.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Timeline title, e.g. Q4 delivery")} dir="auto" />
        <Select value={projectId || "__none"} onValueChange={(v) => setProjectId(v === "__none" ? "" : v)}>
          <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder={t("Project")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t("No project")}</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit} disabled={!title.trim()}>{t("Create")}</Button>
      </DialogFooter>
    </>
  );
}

function PersonForm() {
  const { closeQuickCreate } = useUi();
  const t = useT();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  async function submit() {
    if (!name.trim()) return;
    await createPerson({ name, role, color });
    toast.success(t("Person added"));
    closeQuickCreate();
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New person")}</DialogTitle>
        <DialogDescription>{t("Someone you assign work to or hold 1:1s with.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name")} dir="auto" />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("Role, e.g. Backend engineer")} dir="auto" />
        <div className="flex items-center gap-1">
          {PROJECT_COLORS.map((c) => (
            <button key={c} type="button" aria-label={t("Colour {c}", { c })} onClick={() => setColor(c)} className="size-6 rounded-full border-2" style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }} />
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>{t("Cancel")}</Button>
        <Button onClick={submit} disabled={!name.trim()}>{t("Add")}</Button>
      </DialogFooter>
    </>
  );
}
