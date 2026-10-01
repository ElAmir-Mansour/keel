"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { AlertCircle, Check, Copy, Diamond, FolderInput, ListPlus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { useT } from "@/lib/i18n";
import { addTimelineEntries, updateTimeline } from "@/lib/repo";
import { parseEntryLine, parseTimelineText, timelineToText } from "@/lib/timeline/text";
import { entriesFromProject, type ProjectSourceKey, PROJECT_SOURCES } from "@/lib/timeline/sources";
import type { Timeline, TimelineEntry, TimelineEntryKind, TimelineEntryStatus } from "@/lib/types";
import { useDraft } from "@/components/notes/use-draft";

// Editing a timeline: a one-line quick add, a row list where every field
// saves as you go, and a text view of the same entries for bulk paste. The
// chart above re-draws live from the record, so the list is the form and the
// chart is the preview.

const QUICK_PLACEHOLDER = "2026-10-15: Launch #Release";

export function QuickAdd({ timelineId, className }: { timelineId: string; className?: string }) {
  const t = useT();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (value.trim() ? parseEntryLine(value) : null), [value]);

  async function submit() {
    const e = parseEntryLine(value);
    if (!e) {
      setError(t("Start with a date, like 2026-09-12 or Sep 12, then the title."));
      return;
    }
    await addTimelineEntries(timelineId, [e]);
    setValue("");
    setError(null);
    toast.success(t("Added “{title}”", { title: e.title }));
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <ListPlus className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={QUICK_PLACEHOLDER}
            aria-label={t("Add an entry")}
            aria-invalid={Boolean(error) || undefined}
            dir="auto"
            className="ps-8 font-mono text-[13px]"
          />
        </div>
        <Button size="sm" onClick={() => void submit()} disabled={!value.trim()}>
          <Plus /> {t("Add")}
        </Button>
      </div>
      <p className={cn("min-h-4 px-1 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
        {error ??
          (preview
            ? `${preview.kind === "milestone" ? "◆ " : ""}${preview.title} · ${preview.start}${preview.end ? ` → ${preview.end}` : ""}${preview.group ? ` · ${preview.group}` : ""}`
            : t("Date, then the title. A range: Sep 20 – Oct 3. A lane: #Design. A milestone: !Launch. A link: [[PLAT-12]]."))}
      </p>
    </div>
  );
}

const KINDS: { value: TimelineEntryKind; label: string }[] = [
  { value: "event", label: "Event" },
  { value: "milestone", label: "Milestone" },
];
const STATUSES: { value: "auto" | TimelineEntryStatus; label: string }[] = [
  { value: "auto", label: "By date" },
  { value: "done", label: "Happened" },
  { value: "active", label: "In progress" },
  { value: "planned", label: "Planned" },
];

function TextCell({ value, onSave, placeholder, mono, className, inputRef, list }: { value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean; className?: string; inputRef?: React.Ref<HTMLInputElement>; list?: string }) {
  const [draft, setDraft] = useDraft(value, onSave);
  return (
    <input
      ref={inputRef}
      value={draft}
      list={list}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
      placeholder={placeholder}
      dir="auto"
      className={cn("h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground/60 hover:border-border focus:border-ring", mono && "font-mono text-xs", className)}
    />
  );
}

function EntryRow({ e, groups, selected, onPatch, onRemove, focusTitle }: { e: TimelineEntry; groups: string[]; selected: boolean; onPatch: (patch: Partial<TimelineEntry>) => void; onRemove: () => void; focusTitle: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (focusTitle) titleRef.current?.focus();
  }, [selected, focusTitle]);
  const listId = `groups-${e.id}`;
  return (
    <div ref={ref} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 last:border-b-0 md:grid-cols-[7.5rem_7.5rem_minmax(10rem,2fr)_minmax(6rem,1fr)_auto_auto_minmax(5rem,1fr)_auto]", selected && "bg-muted/60")} data-entry={e.id}>
      <Input type="date" value={e.start} onChange={(ev) => ev.target.value && onPatch({ start: ev.target.value })} aria-label={t("Start")} className="h-7 w-[7.5rem] px-1.5 text-xs" />
      <Input type="date" value={e.end ?? ""} min={e.start} onChange={(ev) => onPatch({ end: ev.target.value || undefined })} aria-label={t("End")} placeholder={t("End")} className="h-7 w-[7.5rem] px-1.5 text-xs max-md:col-start-2" />
      <Button variant="ghost" size="icon-xs" aria-label={t("Delete entry")} onClick={onRemove} className="text-muted-foreground hover:text-destructive md:hidden">
        <Trash2 />
      </Button>
      <div className="col-span-3 flex items-center gap-1 md:col-span-1">
        {e.kind === "milestone" ? <Diamond className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <TextCell value={e.title} onSave={(v) => onPatch({ title: v.trim() || e.title })} placeholder={t("Title")} inputRef={titleRef} className="font-medium" />
      </div>
      <div className="col-span-3 md:col-span-1">
        <TextCell value={e.group ?? ""} onSave={(v) => onPatch({ group: v.trim() || undefined })} placeholder={t("Lane")} list={listId} />
        <datalist id={listId}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>
      <Select value={e.kind ?? "event"} onValueChange={(v) => onPatch({ kind: v === "milestone" ? "milestone" : undefined })}>
        <SelectTrigger size="sm" className="h-7 w-auto border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border dark:bg-transparent" aria-label={t("Kind")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => (
            <SelectItem key={k.value} value={k.value}>
              {t(k.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={e.status ?? "auto"} onValueChange={(v) => onPatch({ status: v === "auto" ? undefined : (v as TimelineEntryStatus) })}>
        <SelectTrigger size="sm" className="h-7 w-auto border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border dark:bg-transparent" aria-label={t("Status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {t(s.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="col-span-3 md:col-span-1">
        <TextCell value={e.link ?? ""} onSave={(v) => onPatch({ link: v.replace(/^\[\[|\]\]$/g, "").trim() || undefined })} placeholder={t("Link, e.g. PLAT-12")} mono />
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={t("Delete entry")} onClick={onRemove} className="hidden text-muted-foreground hover:text-destructive md:inline-flex">
        <Trash2 />
      </Button>
      <div className="col-span-3 md:col-span-8">
        <TextCell value={e.note ?? ""} onSave={(v) => onPatch({ note: v.trim() || undefined })} placeholder={t("Note (optional)")} className="text-xs text-muted-foreground" />
      </div>
    </div>
  );
}

export function TimelineEditor({ timeline, selectedId, onSelect, focusTitle }: { timeline: Timeline; selectedId: string | null; onSelect: (id: string | null) => void; focusTitle?: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"list" | "text">(timeline.entries.length ? "list" : "text");
  const [importOpen, setImportOpen] = useState(false);
  const groups = useMemo(() => Array.from(new Set(timeline.entries.map((e) => e.group).filter((g): g is string => Boolean(g)))), [timeline.entries]);

  async function patch(id: string, p: Partial<TimelineEntry>) {
    const entries = timeline.entries.map((e) => (e.id === id ? { ...e, ...p } : e));
    await updateTimeline(timeline.id, { entries });
  }
  async function remove(id: string) {
    const gone = timeline.entries.find((e) => e.id === id);
    await updateTimeline(timeline.id, { entries: timeline.entries.filter((e) => e.id !== id) });
    if (selectedId === id) onSelect(null);
    if (gone) {
      toast(t("Removed “{title}”", { title: gone.title }), {
        action: { label: t("Undo"), onClick: () => void addTimelineEntries(timeline.id, [gone]) },
      });
    }
  }

  return (
    <div className="grid gap-3">
      <QuickAdd timelineId={timeline.id} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "text")}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="list">{t("Entries")}{timeline.entries.length ? ` · ${timeline.entries.length}` : ""}</TabsTrigger>
            <TabsTrigger value="text">{t("Text")}</TabsTrigger>
          </TabsList>
          {timeline.projectId ? (
            <Button variant="outline" size="sm" className="ms-auto" onClick={() => setImportOpen(true)}>
              <FolderInput /> {t("Add from project")}
            </Button>
          ) : null}
        </div>
        <TabsContent value="list">
          {timeline.entries.length ? (
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="hidden grid-cols-[7.5rem_7.5rem_minmax(10rem,2fr)_minmax(6rem,1fr)_auto_auto_minmax(5rem,1fr)_auto] gap-x-2 border-b bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground md:grid">
                <span>{t("Start")}</span>
                <span>{t("End")}</span>
                <span>{t("Title")}</span>
                <span>{t("Lane")}</span>
                <span>{t("Kind")}</span>
                <span>{t("Status")}</span>
                <span>{t("Link")}</span>
                <span />
              </div>
              {timeline.entries.map((e) => (
                <EntryRow key={e.id} e={e} groups={groups} selected={selectedId === e.id} focusTitle={Boolean(focusTitle)} onPatch={(p) => void patch(e.id, p)} onRemove={() => void remove(e.id)} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("No entries yet. Type one above, paste several in the Text tab, or add milestones and decisions from the project.")}</p>
          )}
        </TabsContent>
        <TabsContent value="text">
          <TextEditor timeline={timeline} onApplied={() => setTab("list")} />
        </TabsContent>
      </Tabs>
      {timeline.projectId ? <ImportDialog open={importOpen} onOpenChange={setImportOpen} timeline={timeline} /> : null}
    </div>
  );
}

function TextEditor({ timeline, onApplied }: { timeline: Timeline; onApplied: () => void }) {
  const t = useT();
  const original = useMemo(() => timelineToText(timeline.entries), [timeline.entries]);
  const [text, setText] = useState(original);
  const [base, setBase] = useState(original);
  // Adopt outside changes while the text is untouched.
  if (original !== base) {
    setBase(original);
    if (text === base) setText(original);
  }
  const parsed = useMemo(() => parseTimelineText(text), [text]);
  const dirty = text !== original;

  async function apply() {
    // Keep ids for entries that still match by title and start, so selection and links survive.
    const next = parsed.entries.map(({ entry }) => {
      const same = timeline.entries.find((x) => x.title.toLowerCase() === entry.title.toLowerCase() && x.start === entry.start);
      return same ? { ...entry, id: same.id } : entry;
    });
    await updateTimeline(timeline.id, { entries: next as TimelineEntry[] });
    toast.success(t("{n} entries saved", { n: next.length }));
    onApplied();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Copied"));
    } catch {
      toast.error(t("Could not copy"));
    }
  }

  return (
    <div className="grid gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(24, Math.max(8, text.split("\n").length + 2))}
        dir="auto"
        spellCheck={false}
        className="font-mono text-[13px] leading-6"
        placeholder={["## Discovery", "2026-09-01 / 2026-09-30: Interviews and research", "2026-09-12: Kickoff", "", "## Build", "Oct 1 – Nov 15: Core features #build", "2026-12-01: !Launch [[PLAT-12]]", "> One line of notes for the entry above."].join("\n")}
        aria-label={t("Timeline as text")}
      />
      <div className="flex flex-wrap items-start gap-2 text-xs">
        <div className="min-w-0 flex-1 text-muted-foreground">
          {parsed.errors.length ? (
            <ul className="grid gap-0.5 text-destructive">
              {parsed.errors.slice(0, 4).map((er) => (
                <li key={er.line} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                  <span>
                    {t("Line {n}", { n: er.line })}: {er.reason}
                  </span>
                </li>
              ))}
              {parsed.errors.length > 4 ? <li>{t("… and {n} more", { n: parsed.errors.length - 4 })}</li> : null}
            </ul>
          ) : (
            <span>{t("{n} entries", { n: parsed.entries.length })} · {t("One line per entry: date, optional end date, then the title. ## Heading starts a lane; #tag also sets the lane; !title marks a milestone; > adds a note.")}</span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void copy()} disabled={!text.trim()}>
          <Copy /> {t("Copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setText(original)} disabled={!dirty}>
          {t("Reset")}
        </Button>
        <Button size="sm" onClick={() => void apply()} disabled={!dirty}>
          <Check /> {t("Apply")}
        </Button>
      </div>
    </div>
  );
}

function ImportDialog({ open, onOpenChange, timeline }: { open: boolean; onOpenChange: (v: boolean) => void; timeline: Timeline }) {
  const t = useT();
  const [picked, setPicked] = useState<Set<ProjectSourceKey>>(new Set(["milestones", "decisions"]));
  const project = useLiveQuery(() => (timeline.projectId ? db.projects.get(timeline.projectId) : undefined), [timeline.projectId]);
  const candidates = useLiveQuery(async () => (timeline.projectId && open ? entriesFromProject(timeline.projectId, Array.from(picked)) : []), [timeline.projectId, open, Array.from(picked).join(",")], [] as Partial<TimelineEntry>[]);
  const fresh = useMemo(() => candidates.filter((c) => !timeline.entries.some((e) => e.title.toLowerCase() === (c.title ?? "").toLowerCase() && e.start === c.start)), [candidates, timeline.entries]);

  async function add() {
    const r = await addTimelineEntries(timeline.id, candidates);
    toast.success(r.added ? t("{n} entries added", { n: r.added }) : t("Nothing new to add"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Add from project")}</DialogTitle>
          <DialogDescription>{project ? t("Dated records from {name} become entries. Existing entries with the same title and date are updated, not duplicated.", { name: project.name }) : t("Dated records from the project become entries.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5">
          {PROJECT_SOURCES.map((s) => (
            <Label key={s.key} className="flex items-start gap-2.5 font-normal">
              <Checkbox
                checked={picked.has(s.key)}
                onCheckedChange={(v) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (v) next.add(s.key);
                    else next.delete(s.key);
                    return next;
                  })
                }
                className="mt-0.5"
              />
              <span className="grid">
                <span className="text-sm">{t(s.label)}</span>
                <span className="text-xs text-muted-foreground">{t(s.hint)}</span>
              </span>
            </Label>
          ))}
          <p className="text-xs text-muted-foreground">{t("{n} entries found, {m} new", { n: candidates.length, m: fresh.length })}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void add()} disabled={!candidates.length}>
            {t("Add {n} entries", { n: candidates.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

