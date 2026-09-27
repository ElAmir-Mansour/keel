"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Columns2, Copy, Eye, FileText, LayoutTemplate, ListChecks, Pencil, Pin, PinOff, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownEditor, MarkdownView, toggleTaskInMarkdown } from "@/components/markdown";
import { EmptyState, ProjectDot } from "@/components/ui-bits";
import { useLinkIndex, usePeople } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { parseYMD, todayYMD, ymd } from "@/lib/dates";
import { createNote, deleteNote, getOrCreateDailyNote, updateNote } from "@/lib/repo";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { NOTE_KINDS, NOTE_STATUSES, noteFolder, type Note, type NoteKind, type NoteStatus } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { ConfirmDialog } from "./confirm-dialog";
import { NoteLinksPanel } from "./note-links-panel";
import { TagsEditor } from "./tags-editor";
import { useDraft } from "./use-draft";
import { useEditorMode, type EditorMode } from "./use-editor-mode";

// Kinds that go through review and therefore carry a status.
const DOC_KINDS = new Set<NoteKind>(["prd", "rfc", "runbook", "postmortem", "weekly", "page"]);

/** /notes/[id] — where people spend their time. */
export function NoteEditor() {
  const { id } = useParams<{ id: string }>();
  const note = useLiveQuery(() => db.notes.get(id).then((n) => n ?? null), [id], undefined);
  const [deleted, setDeleted] = useState(false);

  if (note === undefined || (note === null && deleted)) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (note === null) {
    return (
      <EmptyState icon={<FileText />} title="Note not found" description="It may have been deleted, or the link is from another workspace.">
        <Button asChild size="sm" variant="outline">
          <Link href="/notes">Back to notes</Link>
        </Button>
      </EmptyState>
    );
  }
  return <Editor key={note.id} note={note} onDeleted={() => setDeleted(true)} />;
}

function Editor({ note, onDeleted }: { note: Note; onDeleted: () => void }) {
  const router = useRouter();
  const { openAI } = useUi();
  const idx = useLinkIndex();
  const people = usePeople();
  const listId = useId();

  const [title, setTitle] = useDraft(note.title, (t) => updateNote(note.id, { title: t.trim() || "Untitled" }));
  const [body, setBody] = useDraft(note.body, (b) => updateNote(note.id, { body: b }));
  const [folder, setFolder] = useDraft(note.folder, (f) => updateNote(note.id, { folder: f.trim().replace(/^\/+|\/+$/g, "") || noteFolder(note.kind) }));
  const [mode, setMode] = useEditorMode();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<NoteKind | null>(null);

  const project = useMemo(() => idx.projects.find((p) => p.id === note.projectId) ?? null, [idx.projects, note.projectId]);
  const folders = useMemo(() => [...new Set(idx.notes.map((n) => n.folder).filter(Boolean))].sort(), [idx.notes]);
  const aiContext = useMemo(() => ({ noteId: note.id, projectId: note.projectId }), [note.id, note.projectId]);
  const isDoc = DOC_KINDS.has(note.kind);

  function changeKind(kind: NoteKind) {
    const patch: Partial<Note> = { kind };
    // Kind picks the default folder; follow it unless the note was filed by hand.
    if (note.folder === noteFolder(note.kind)) patch.folder = noteFolder(kind);
    if (!DOC_KINDS.has(kind)) patch.status = undefined;
    void updateNote(note.id, patch);
  }

  function changeDate(date: string) {
    if (!date) return;
    const patch: Partial<Note> = { date };
    if (note.kind === "daily" && note.title === note.date) patch.title = date;
    void updateNote(note.id, patch);
  }

  async function goDay(delta: number) {
    const d = delta === 0 ? todayYMD() : ymd(addDays(parseYMD(note.date), delta));
    const n = await getOrCreateDailyNote(d);
    router.push(`/notes/${n.id}`);
  }

  function insertTemplate(kind: NoteKind) {
    if (!body.trim()) setBody(NOTE_TEMPLATES[kind]);
    else setPendingTemplate(kind);
  }

  async function duplicate() {
    const copy = await createNote({
      kind: note.kind,
      folder: note.folder,
      projectId: note.projectId,
      personId: note.personId,
      date: note.date,
      status: note.status,
      tags: note.tags,
      title: `${title.trim() || note.title} (copy)`,
      body,
    });
    toast.success("Note duplicated");
    router.push(`/notes/${copy.id}`);
  }

  async function remove() {
    onDeleted();
    await deleteNote(note.id);
    toast.success("Note deleted");
    router.replace("/notes");
  }

  const askAI = () => openAI({ ...aiContext, action: "ask" });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-4">
        {note.kind === "daily" ? (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Button variant="ghost" size="xs" onClick={() => void goDay(-1)}>
              <ChevronLeft className="rtl:rotate-180" /> Previous day
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void goDay(0)} disabled={note.date === todayYMD()}>
              Today
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void goDay(1)}>
              Next day <ChevronRight className="rtl:rotate-180" />
            </Button>
          </div>
        ) : (
          <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
            <Link href="/notes" className="hover:underline">
              Notes
            </Link>
            {note.folder.split("/").filter(Boolean).map((seg, i, arr) => {
              const path = arr.slice(0, i + 1).join("/");
              return (
                <span key={path} className="flex items-center gap-1">
                  <span aria-hidden>/</span>
                  <Link href={`/notes?folder=${encodeURIComponent(path)}`} className="hover:underline" dir="auto">
                    {seg}
                  </Link>
                </span>
              );
            })}
          </nav>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Untitled"
          aria-label="Title"
          dir="auto"
          className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
          <Prop label="Kind">
            <Select value={note.kind} onValueChange={(v) => changeKind(v as NoteKind)}>
              <SelectTrigger size="sm" className="w-auto" aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Prop>
          <Prop label="Folder">
            <Input list={listId} value={folder} onChange={(e) => setFolder(e.target.value)} dir="auto" aria-label="Folder" className="h-7 w-40 text-xs" placeholder={noteFolder(note.kind)} />
            <datalist id={listId}>
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Prop>
          <Prop label="Project">
            <Select value={note.projectId ?? "__none"} onValueChange={(v) => void updateNote(note.id, { projectId: v === "__none" ? undefined : v })}>
              <SelectTrigger size="sm" className="w-auto" aria-label="Project">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No project</SelectItem>
                {idx.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <ProjectDot project={p} /> {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Prop>
          {note.kind === "oneonone" ? (
            <Prop label="With">
              <Select value={note.personId ?? "__none"} onValueChange={(v) => void updateNote(note.id, { personId: v === "__none" ? undefined : v })}>
                <SelectTrigger size="sm" className="w-auto" aria-label="Person">
                  <SelectValue placeholder="Nobody" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nobody</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
          ) : null}
          <Prop label="Date">
            <Input type="date" value={note.date} onChange={(e) => changeDate(e.target.value)} aria-label="Date" className="h-7 w-auto text-xs" />
          </Prop>
          {isDoc ? (
            <Prop label="Status">
              <Select value={note.status ?? "__none"} onValueChange={(v) => void updateNote(note.id, { status: v === "__none" ? undefined : (v as NoteStatus) })}>
                <SelectTrigger size="sm" className="w-auto" aria-label="Status">
                  <SelectValue placeholder="No status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No status</SelectItem>
                  {NOTE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
          ) : null}
          <Prop label="Tags" className="min-w-48 flex-1">
            <TagsEditor tags={note.tags} onChange={(tags) => void updateNote(note.id, { tags })} className="flex-1" />
          </Prop>
          <Button variant={note.pinned ? "secondary" : "ghost"} size="xs" aria-pressed={note.pinned} onClick={() => void updateNote(note.id, { pinned: !note.pinned })}>
            {note.pinned ? <Pin /> : <PinOff />}
            {note.pinned ? "Pinned" : "Pin"}
          </Button>
        </div>

        {mode === "preview" ? (
          <ReadingView body={body} mode={mode} onModeChange={setMode} onAskAI={askAI} onToggleTask={(i, checked) => setBody(toggleTaskInMarkdown(body, i, checked))} />
        ) : (
          <MarkdownEditor value={body} onChange={setBody} mode={mode} onModeChange={setMode} minRows={18} aiContext={aiContext} onToggleTask={(i, checked) => setBody(toggleTaskInMarkdown(body, i, checked))} />
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto thin-scroll">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={askAI}>
            <Sparkles /> Ask AI
          </Button>
          <Button variant="outline" size="sm" onClick={() => openAI({ noteId: note.id, action: "summarize" })}>
            Summarize
          </Button>
          <Button variant="outline" size="sm" onClick={() => openAI({ noteId: note.id, projectId: note.projectId, action: "tasks" })}>
            <ListChecks /> Extract tasks
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <LayoutTemplate /> Insert template
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Template</DropdownMenuLabel>
              {NOTE_KINDS.filter((k) => NOTE_TEMPLATES[k.value].trim()).map((k) => (
                <DropdownMenuItem key={k.value} onSelect={() => insertTemplate(k.value)}>
                  {k.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => void duplicate()}>
            <Copy /> Duplicate
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        </div>
        <NoteLinksPanel note={note} body={body} idx={idx} project={project} />
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this note?"
        description={`"${note.title}" will be removed. Links to it from other notes will show as missing.`}
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
      <ConfirmDialog
        open={pendingTemplate !== null}
        onOpenChange={(v) => !v && setPendingTemplate(null)}
        title="Append template?"
        description="The note already has content. The template will be added at the end."
        confirmLabel="Append"
        onConfirm={() => {
          if (pendingTemplate) setBody(body.trimEnd() + "\n\n" + NOTE_TEMPLATES[pendingTemplate]);
        }}
      />
    </div>
  );
}

function Prop({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Reading mode with live task checkboxes. MarkdownEditor's own preview cannot
 * toggle tasks, so the editor page draws this view itself in preview mode and
 * mirrors the editor's mode buttons so switching feels like one control.
 */
function ReadingView({
  body,
  mode,
  onModeChange,
  onAskAI,
  onToggleTask,
}: {
  body: string;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  onAskAI: () => void;
  onToggleTask: (index: number, checked: boolean) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <ToolBtn label="Ask AI about this" onClick={onAskAI}>
          <Sparkles />
        </ToolBtn>
        <div className="ms-auto flex items-center gap-0.5">
          <ToolBtn label="Edit" active={mode === "edit"} onClick={() => onModeChange("edit")}>
            <Pencil />
          </ToolBtn>
          <ToolBtn label="Split" active={mode === "split"} onClick={() => onModeChange("split")}>
            <Columns2 />
          </ToolBtn>
          <ToolBtn label="Preview" active={mode === "preview"} onClick={() => onModeChange("preview")}>
            <Eye />
          </ToolBtn>
        </div>
      </div>
      <div className="px-4 py-3">{body.trim() ? <MarkdownView body={body} onToggleTask={onToggleTask} /> : <p className="text-sm text-muted-foreground">Nothing to read yet — switch to Edit to start writing.</p>}</div>
    </div>
  );
}

function ToolBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" onClick={onClick} aria-label={label} aria-pressed={active}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
