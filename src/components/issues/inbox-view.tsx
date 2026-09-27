"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowUpRight, CheckCircle2, CircleDashed, CircleDot, CircleSlash, Clock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useActiveProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { ago, fmtDate, nowISO } from "@/lib/dates";
import { createIssuesFromLines, snoozeIssue, transitionIssue, updateIssue } from "@/lib/repo";
import { issueKey, type Issue, type IssueStatus, type Project } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { EmptyState, IssueKey, PageHeader, ProjectDot } from "@/components/ui-bits";
import { SnoozeMenu } from "./snooze-menu";
import { issueHref, safeWrite } from "./issue-utils";
import { useListNav } from "./use-list-nav";

const EMPTY: Issue[] = [];

function isSnoozed(i: Issue, now: string) {
  return Boolean(i.snoozedUntil && i.snoozedUntil > now);
}

export function InboxView() {
  const router = useRouter();
  const projects = useActiveProjects();
  const all = useLiveQuery(() => db.issues.where("status").equals("triage").toArray(), [], EMPTY);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  // The clock is read when the data changes rather than on every render.
  const { items, snoozedCount, now } = useMemo(() => {
    const at = nowISO();
    const active = all.filter((i) => projectById.has(i.projectId));
    const snoozed = active.filter((i) => isSnoozed(i, at)).length;
    const list = (showSnoozed ? active : active.filter((i) => !isSnoozed(i, at))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: list, snoozedCount: snoozed, now: at };
  }, [all, projectById, showSnoozed]);

  function keyOf(issue: Issue) {
    const p = projectById.get(issue.projectId);
    return p ? issueKey(p, issue) : `#${issue.seq}`;
  }

  function move(issue: Issue, to: IssueStatus, verb: string) {
    const key = keyOf(issue);
    void safeWrite(async () => {
      await transitionIssue(issue.id, to);
      toast.success(`${verb} ${key}`, {
        action: { label: "Undo", onClick: () => void safeWrite(() => transitionIssue(issue.id, "triage"), "Could not undo") },
      });
    }, `Could not update ${key}`);
  }

  function snooze(issue: Issue, until: Date) {
    const key = keyOf(issue);
    void safeWrite(async () => {
      await snoozeIssue(issue.id, until);
      toast.success(`Snoozed ${key} until ${fmtDate(until.toISOString())}`);
    }, `Could not snooze ${key}`);
  }

  const nav = useListNav(items.length, {
    enabled: !editingId && !snoozeFor,
    onOpen: (i) => router.push(issueHref(items[i])),
    onKey: (k, i) => {
      const issue = items[i];
      if (k === "1") move(issue, "backlog", "Accepted");
      else if (k === "2") move(issue, "in_progress", "Started");
      else if (k === "3") move(issue, "cancelled", "Declined");
      else if (k === "h") setSnoozeFor(issue.id);
      else return false;
      return true;
    },
  });

  return (
    <div>
      <PageHeader
        title="Inbox"
        description={items.length ? `${items.length} to triage${snoozedCount && !showSnoozed ? ` · ${snoozedCount} snoozed` : ""}` : snoozedCount && !showSnoozed ? `${snoozedCount} snoozed` : "New issues land here first."}
        actions={
          <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <Switch size="sm" checked={showSnoozed} onCheckedChange={setShowSnoozed} aria-label="Show snoozed" />
            Show snoozed
          </Label>
        }
      >
        <CaptureBox projects={projects} />
      </PageHeader>

      {items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="text-[var(--viz-good)]" />} title="Inbox zero" description={snoozedCount && !showSnoozed ? `Nothing to triage right now. ${snoozedCount} snoozed ${snoozedCount === 1 ? "issue is" : "issues are"} waiting.` : "Nothing to triage. Capture something above, or press C anywhere."} />
      ) : (
        <>
          <div data-list-nav className="divide-y overflow-hidden rounded-lg border">
            {items.map((issue, i) => (
              <InboxRow
                key={issue.id}
                issue={issue}
                project={projectById.get(issue.projectId)}
                keyLabel={keyOf(issue)}
                now={now}
                selected={nav.index === i}
                editing={editingId === issue.id}
                snoozeOpen={snoozeFor === issue.id}
                onSelect={() => nav.index !== i && nav.setIndex(i)}
                onEdit={(v) => setEditingId(v ? issue.id : null)}
                onSnoozeOpen={(v) => setSnoozeFor(v ? issue.id : null)}
                onAccept={() => move(issue, "backlog", "Accepted")}
                onStart={() => move(issue, "in_progress", "Started")}
                onDecline={() => move(issue, "cancelled", "Declined")}
                onSnooze={(until) => snooze(issue, until)}
              />
            ))}
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> move</span>
            <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="inline-flex items-center gap-1"><Kbd>1</Kbd> accept</span>
            <span className="inline-flex items-center gap-1"><Kbd>2</Kbd> start</span>
            <span className="inline-flex items-center gap-1"><Kbd>3</Kbd> decline</span>
            <span className="inline-flex items-center gap-1"><Kbd>H</Kbd> snooze</span>
            <span>Double-click a title to rename</span>
          </p>
        </>
      )}
    </div>
  );
}

function CaptureBox({ projects }: { projects: Project[] }) {
  const { openQuickCreate } = useUi();
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const pid = projectId && projects.some((p) => p.id === projectId) ? projectId : (projects[0]?.id ?? "");

  async function submit() {
    if (!pid || !text.trim() || busy) return;
    setBusy(true);
    try {
      const created = await createIssuesFromLines(pid, text);
      toast.success(`Added ${created.length} to triage`);
      setText("");
    } catch (e) {
      toast.error("Could not add issues", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (!projects.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Issues live inside projects. Create one to start capturing.
        <Button type="button" variant="outline" size="sm" className="ms-auto" onClick={() => openQuickCreate("project")}>
          <Plus /> New project
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Textarea
        value={text}
        dir="auto"
        rows={2}
        placeholder="Paste or type; one issue per line"
        aria-label="Capture issues"
        className="min-h-0 resize-y"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={pid} onValueChange={setProjectId}>
          <SelectTrigger size="sm" className="w-auto min-w-36" aria-label="Project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <ProjectDot project={p} /> {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" className="ms-auto" onClick={submit} disabled={!text.trim() || !pid || busy}>
          Add to triage <Kbd className="ms-1 bg-primary-foreground/20 text-primary-foreground">⌘↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

function InboxRow({
  issue,
  project,
  keyLabel,
  now,
  selected,
  editing,
  snoozeOpen,
  onSelect,
  onEdit,
  onSnoozeOpen,
  onAccept,
  onStart,
  onDecline,
  onSnooze,
}: {
  issue: Issue;
  project?: Project;
  keyLabel: string;
  now: string;
  selected: boolean;
  editing: boolean;
  snoozeOpen: boolean;
  onSelect: () => void;
  onEdit: (editing: boolean) => void;
  onSnoozeOpen: (open: boolean) => void;
  onAccept: () => void;
  onStart: () => void;
  onDecline: () => void;
  onSnooze: (until: Date) => void;
}) {
  const snoozed = isSnoozed(issue, now);

  function saveTitle(raw: string) {
    const t = raw.trim();
    if (t && t !== issue.title) void safeWrite(() => updateIssue(issue.id, { title: t }));
    onEdit(false);
  }

  return (
    <div
      data-selected={selected || undefined}
      onMouseMove={onSelect}
      className="group flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/60 data-selected:bg-accent"
    >
      <ProjectDot project={project} />
      <Link href={issueHref(issue)} className="shrink-0 hover:underline">
        <IssueKey>{keyLabel}</IssueKey>
      </Link>
      {editing ? (
        <input
          autoFocus
          defaultValue={issue.title}
          dir="auto"
          aria-label="Title"
          className="min-w-0 flex-1 rounded-md bg-background px-1.5 py-0.5 outline-none ring-1 ring-ring"
          onBlur={(e) => saveTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveTitle(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onEdit(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          dir="auto"
          title="Double-click to rename"
          onClick={onSelect}
          onDoubleClick={() => onEdit(true)}
          className="min-w-0 flex-1 truncate rounded-md px-1.5 py-0.5 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {issue.title}
        </button>
      )}
      {snoozed ? (
        <Badge variant="outline" className="hidden h-5 gap-1 font-normal text-muted-foreground sm:inline-flex" title={`Snoozed until ${fmtDate(issue.snoozedUntil, "d MMM yyyy HH:mm")}`}>
          <Clock /> {fmtDate(issue.snoozedUntil, "d MMM")}
        </Badge>
      ) : null}
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={fmtDate(issue.createdAt, "d MMM yyyy HH:mm")}>
        {ago(issue.createdAt)}
      </span>
      <div className={cn("flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-data-selected:opacity-100 md:focus-within:opacity-100", snoozeOpen && "md:opacity-100")}>
        <Action label="Accept" kbd="1" onClick={onAccept}><CircleDashed /></Action>
        <Action label="Start" kbd="2" onClick={onStart}><CircleDot className="text-[var(--viz-series-4)]" /></Action>
        <Action label="Decline" kbd="3" onClick={onDecline}><CircleSlash /></Action>
        <SnoozeMenu open={snoozeOpen} onOpenChange={onSnoozeOpen} onPick={onSnooze} />
        <Button asChild variant="ghost" size="icon-xs" aria-label={`Open ${keyLabel}`} className="text-muted-foreground">
          <Link href={issueHref(issue)}><ArrowUpRight /></Link>
        </Button>
      </div>
    </div>
  );
}

function Action({ label, kbd, onClick, children }: { label: string; kbd: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="xs" onClick={onClick} aria-label={label} className="text-muted-foreground">
      {children}
      <span className="max-md:hidden">{label}</span>
      <Kbd className="max-md:hidden">{kbd}</Kbd>
    </Button>
  );
}
