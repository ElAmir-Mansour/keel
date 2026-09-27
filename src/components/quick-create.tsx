"use client";
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
import { createDecision, createIssue, createIssuesFromLines, createNote, createPerson, createProject, createRisk, normalizeKey } from "@/lib/repo";
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
        toast.success(`Created ${created.length} issues`);
        closeQuickCreate();
      } else {
        const issue = await createIssue({ projectId, title, description, status, priority, assigneeId: assigneeId || undefined, dueDate: dueDate || undefined });
        const p = projects.find((x) => x.id === projectId);
        toast.success(`Created ${p?.key}-${issue.seq}`, { action: { label: "Open", onClick: () => router.push(`/projects/${projectId}/issues/${issue.seq}`) } });
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
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription>Create a project first — issues live inside projects.</DialogDescription>
        </DialogHeader>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New issue</DialogTitle>
        <DialogDescription>Write the issue, not a user story. One line is enough.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <div className="flex flex-wrap gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder="Project" /></SelectTrigger>
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
                <SelectItem key={s.value} value={s.value}><StatusIcon status={s.value} /> {s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger size="sm" className="w-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}><PriorityIcon priority={p.value} /> {p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assigneeId || "__none"} onValueChange={(v) => setAssigneeId(v === "__none" ? "" : v)}>
            <SelectTrigger size="sm" className="w-auto"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Unassigned</SelectItem>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {multi ? (
          <Textarea autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={"One issue per line\n- Fix login redirect\n- Add audit log index"} rows={6} dir="auto" />
        ) : (
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Issue title" dir="auto" />
        )}
        {!multi ? <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional, markdown)" rows={3} dir="auto" /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="due" className="text-xs text-muted-foreground">Due</Label>
            <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 w-auto" />
          </div>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setMulti((m) => !m)}>
            {multi ? "Single issue" : "Paste a list → many issues"}
          </button>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>Cancel</Button>
        <Button onClick={submit} disabled={!title.trim() || busy}>Create</Button>
      </DialogFooter>
    </>
  );
}

function NoteForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
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
        <DialogTitle>New note</DialogTitle>
        <DialogDescription>Pick a kind to start from its template. Everything is markdown.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" dir="auto" />
        <div className="flex flex-wrap gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as NoteKind)}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NOTE_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={projectId || "__none"} onValueChange={(v) => setProjectId(v === "__none" ? "" : v)}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind === "oneonone" ? (
            <Select value={personId || "__none"} onValueChange={(v) => setPersonId(v === "__none" ? "" : v)}>
              <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder="With" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Nobody</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>Cancel</Button>
        <Button onClick={submit}>Create</Button>
      </DialogFooter>
    </>
  );
}

function DecisionForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
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
        <DialogTitle>New decision</DialogTitle>
        <DialogDescription>A short ADR: context, decision, consequences. You fill those in next.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What was decided?" dir="auto" />
        <Select value={projectId || "__none"} onValueChange={(v) => setProjectId(v === "__none" ? "" : v)}>
          <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">No project</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}><ProjectDot project={p} /> {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>Cancel</Button>
        <Button onClick={submit} disabled={!title.trim()}>Create</Button>
      </DialogFooter>
    </>
  );
}

function RiskForm({ projectId: initial }: { projectId?: string }) {
  const { closeQuickCreate } = useUi();
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
    toast.success("Risk added");
    closeQuickCreate();
    router.push(`/projects/${projectId}/risks`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>New risk</DialogTitle>
        <DialogDescription>Risk, assumption, issue or dependency. Score likelihood and impact 1–5.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What could go wrong?" dir="auto" />
        <div className="flex flex-wrap gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger size="sm" className="w-auto min-w-36"><SelectValue placeholder="Project" /></SelectTrigger>
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
                <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ScoreSelect label="Likelihood" value={likelihood} onChange={setLikelihood} />
          <ScoreSelect label="Impact" value={impact} onChange={setImpact} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>Cancel</Button>
        <Button onClick={submit} disabled={!title.trim() || !projectId}>Create</Button>
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
    toast.success(`Project ${p.key} created`);
    closeQuickCreate();
    router.push(`/projects/${p.id}`);
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>A project groups issues, milestones, risks and weekly updates. The key prefixes issue numbers.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" dir="auto" />
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
              <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} className="size-6 rounded-md border-2" style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }} />
            ))}
          </div>
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="h-8 w-auto" aria-label="Target date" />
        </div>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One paragraph: what this project is for" rows={3} dir="auto" />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim() || !key.trim()}>Create</Button>
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

function PersonForm() {
  const { closeQuickCreate } = useUi();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  async function submit() {
    if (!name.trim()) return;
    await createPerson({ name, role, color });
    toast.success("Person added");
    closeQuickCreate();
  }
  const onKey = useSubmitOnEnter(submit);
  return (
    <>
      <DialogHeader>
        <DialogTitle>New person</DialogTitle>
        <DialogDescription>Someone you assign work to or hold 1:1s with.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={onKey}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" dir="auto" />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role, e.g. Backend engineer" dir="auto" />
        <div className="flex items-center gap-1">
          {PROJECT_COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} className="size-6 rounded-full border-2" style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }} />
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeQuickCreate}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Add</Button>
      </DialogFooter>
    </>
  );
}
