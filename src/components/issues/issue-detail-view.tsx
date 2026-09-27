"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, FileText, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllNotes, useProject } from "@/hooks/use-data";
import { useDebouncedSave } from "@/hooks/use-debounced-save";
import { db } from "@/lib/db";
import { ago, fmtDate } from "@/lib/dates";
import { deleteIssue, updateIssue } from "@/lib/repo";
import { issueKey, type Issue, type IssueEvent, type Project } from "@/lib/types";
import { backlinksTo } from "@/lib/wikilinks";
import { MarkdownEditor } from "@/components/markdown";
import { EmptyState, IssueKey, KindBadge, Section, StatusIcon, statusLabel } from "@/components/ui-bits";
import { AssigneePicker, DueDatePicker, EstimateInput, LabelsEditor, MilestonePicker, PriorityPicker, StatusPicker } from "./pickers";
import { isEditableTarget, inOverlay, issueHref, safeWrite, useIssueEvents, useProjectIssues, useProjectMilestones } from "./issue-utils";

export function IssueDetailView() {
  const { id, seq } = useParams<{ id: string; seq: string }>();
  const project = useProject(id);
  // null while loading, undefined when the query resolves to nothing.
  const issue = useLiveQuery(
    () => db.issues.where("[projectId+seq]").equals([id, Number(seq)]).first(),
    [id, seq],
    null,
  );

  if (issue === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!issue) {
    return (
      <EmptyState title="Issue not found" description={`There is no ${project?.key ?? "issue"}-${seq} in this project. It may have been deleted.`}>
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${id}/issues`}><ArrowLeft /> Back to issues</Link>
        </Button>
      </EmptyState>
    );
  }
  return <IssueDetail key={issue.id} issue={issue} project={project ?? null} />;
}

function IssueDetail({ issue, project }: { issue: Issue; project: Project | null }) {
  const router = useRouter();
  const key = project ? issueKey(project, issue) : `#${issue.seq}`;
  const siblings = useProjectIssues(issue.projectId);
  const milestones = useProjectMilestones(issue.projectId);
  const events = useIssueEvents(issue.id);
  const notes = useAllNotes();
  const mentions = useMemo(() => (project ? backlinksTo([key], notes) : []), [key, notes, project]);

  const { prev, next } = useMemo(() => {
    const sorted = [...siblings].sort((a, b) => a.seq - b.seq);
    const idx = sorted.findIndex((i) => i.id === issue.id);
    return { prev: idx > 0 ? sorted[idx - 1] : null, next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null };
  }, [siblings, issue.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target) || inOverlay(e.target)) return;
      if (e.key === "[" && prev) router.push(issueHref(prev));
      else if (e.key === "]" && next) router.push(issueHref(next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Button asChild variant="ghost" size="sm" className="-ms-2 text-muted-foreground">
          <Link href={`/projects/${issue.projectId}/issues`}><ArrowLeft /> Issues</Link>
        </Button>
        <IssueKey className="text-sm">{key}</IssueKey>
        <div className="ms-auto flex items-center gap-1">
          <Button asChild={Boolean(prev)} variant="ghost" size="sm" disabled={!prev} aria-label="Previous issue" className="text-muted-foreground">
            {prev ? (
              <Link href={issueHref(prev)}><ChevronLeft className="rtl:rotate-180" /> {project ? issueKey(project, prev) : `#${prev.seq}`} <Kbd>[</Kbd></Link>
            ) : (
              <span><ChevronLeft className="rtl:rotate-180" /> <Kbd>[</Kbd></span>
            )}
          </Button>
          <Button asChild={Boolean(next)} variant="ghost" size="sm" disabled={!next} aria-label="Next issue" className="text-muted-foreground">
            {next ? (
              <Link href={issueHref(next)}><Kbd>]</Kbd> {project ? issueKey(project, next) : `#${next.seq}`} <ChevronRight className="rtl:rotate-180" /></Link>
            ) : (
              <span><Kbd>]</Kbd> <ChevronRight className="rtl:rotate-180" /></span>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-8">
          <div className="space-y-3">
            <TitleInput issue={issue} />
            <DescriptionEditor issue={issue} />
          </div>

          <Section title="Activity">
            {events.length ? (
              <ol className="space-y-1.5 text-sm">
                {[...events].reverse().map((e) => (
                  <ActivityItem key={e.id} event={e} />
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            )}
          </Section>

          <Section title="Mentioned in">
            {mentions.length ? (
              <ul className="divide-y rounded-lg border">
                {mentions.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" dir="auto">{n.title}</span>
                      <KindBadge kind={n.kind} />
                      <span className="text-xs text-muted-foreground">{fmtDate(n.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No notes link here yet. Write <code className="rounded bg-muted px-1 font-mono text-xs">[[{key}]]</code> in a note to mention it.
              </p>
            )}
          </Section>
        </div>

        <aside className="space-y-5 lg:border-s lg:ps-6">
          <dl className="space-y-2.5 text-sm">
            <Property label="Status"><StatusPicker issue={issue} full /></Property>
            <Property label="Priority"><PriorityPicker issue={issue} full /></Property>
            <Property label="Assignee"><AssigneePicker issue={issue} full /></Property>
            <Property label="Milestone"><MilestonePicker issue={issue} milestones={milestones} full /></Property>
            <Property label="Due date"><DueDatePicker issue={issue} full /></Property>
            <Property label="Estimate"><EstimateInput issue={issue} /></Property>
            <Property label="Labels" align="start"><LabelsEditor issue={issue} className="min-h-7 rounded-lg border px-2 py-1" /></Property>
          </dl>

          <dl className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
            <Stamp label="Created" at={issue.createdAt} />
            <Stamp label="Updated" at={issue.updatedAt} />
            <Stamp label="Started" at={issue.startedAt} />
            <Stamp label="Completed" at={issue.completedAt} />
          </dl>

          <DeleteIssueButton issue={issue} keyLabel={key} onDeleted={() => router.push(`/projects/${issue.projectId}/issues`)} />
        </aside>
      </div>
    </div>
  );
}

function Property({ label, align = "center", children }: { label: string; align?: "center" | "start"; children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2", align === "center" ? "items-center" : "items-start")}>
      <dt className={cn("text-xs text-muted-foreground", align === "start" && "pt-1.5")}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Stamp({ label, at }: { label: string; at?: string }) {
  if (!at) return null;
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd title={fmtDate(at, "d MMM yyyy HH:mm")}>{ago(at)}</dd>
    </div>
  );
}

function ActivityItem({ event }: { event: IssueEvent }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5">
      <StatusIcon status={event.to} />
      {event.from ? (
        <span>
          <span className="text-muted-foreground">{statusLabel(event.from)}</span>
          <ArrowRight className="mx-1 inline size-3 text-muted-foreground rtl:rotate-180" />
          {statusLabel(event.to)}
        </span>
      ) : (
        <span>
          Created in <span className="font-medium">{statusLabel(event.to)}</span>
        </span>
      )}
      <span className="ms-auto text-xs text-muted-foreground" title={fmtDate(event.at, "d MMM yyyy HH:mm")}>
        {ago(event.at)}
      </span>
    </li>
  );
}

function TitleInput({ issue }: { issue: Issue }) {
  const [value, setValue] = useState(issue.title);
  function commit() {
    const t = value.trim();
    if (!t) return setValue(issue.title);
    if (t !== issue.title) void safeWrite(() => updateIssue(issue.id, { title: t }));
  }
  return (
    <input
      value={value}
      dir="auto"
      aria-label="Title"
      placeholder="Untitled"
      className="w-full rounded-md bg-transparent px-1 py-0.5 text-xl font-semibold tracking-tight outline-none -ms-1 hover:bg-muted/50 focus:bg-muted/50"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setValue(issue.title);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function DescriptionEditor({ issue }: { issue: Issue }) {
  const [value, setValue] = useState(issue.description);
  useDebouncedSave(value, (v) => safeWrite(() => updateIssue(issue.id, { description: v })), 600, true, issue.description);
  return <MarkdownEditor value={value} onChange={setValue} minRows={8} placeholder="Describe the issue. Markdown, [[ links notes and other issues." aiContext={{ projectId: issue.projectId }} />;
}

function DeleteIssueButton({ issue, keyLabel, onDeleted }: { issue: Issue; keyLabel: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await deleteIssue(issue.id);
      toast.success(`Deleted ${keyLabel}`);
      onDeleted();
    } catch (e) {
      toast.error("Could not delete", { description: e instanceof Error ? e.message : undefined });
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 /> Delete issue
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {keyLabel}?</DialogTitle>
          <DialogDescription>This removes the issue and its activity. Notes that mention it keep the link, which will show as missing.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={busy} autoFocus>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
