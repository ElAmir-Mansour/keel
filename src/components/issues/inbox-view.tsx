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
import { useT } from "@/lib/i18n";
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
  const t = useT();
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

  /** `msg` is a translation key with a `{key}` placeholder, e.g. "Accepted {key}". */
  function move(issue: Issue, to: IssueStatus, msg: string) {
    const key = keyOf(issue);
    void safeWrite(async () => {
      await transitionIssue(issue.id, to);
      toast.success(t(msg, { key }), {
        action: { label: t("Undo"), onClick: () => void safeWrite(() => transitionIssue(issue.id, "triage"), t("Could not undo")) },
      });
    }, t("Could not update {key}", { key }));
  }

  function snooze(issue: Issue, until: Date) {
    const key = keyOf(issue);
    void safeWrite(async () => {
      await snoozeIssue(issue.id, until);
      toast.success(t("Snoozed {key} until {date}", { key, date: fmtDate(until.toISOString()) }));
    }, t("Could not snooze {key}", { key }));
  }

  const nav = useListNav(items.length, {
    enabled: !editingId && !snoozeFor,
    onOpen: (i) => router.push(issueHref(items[i])),
    onKey: (k, i) => {
      const issue = items[i];
      if (k === "1") move(issue, "backlog", "Accepted {key}");
      else if (k === "2") move(issue, "in_progress", "Started {key}");
      else if (k === "3") move(issue, "cancelled", "Declined {key}");
      else if (k === "h") setSnoozeFor(issue.id);
      else return false;
      return true;
    },
  });

  const hiddenSnoozed = snoozedCount && !showSnoozed ? snoozedCount : 0;
  const description = items.length
    ? `${t("{n} to triage", { n: items.length })}${hiddenSnoozed ? ` · ${t("{n} snoozed", { n: hiddenSnoozed })}` : ""}`
    : hiddenSnoozed
      ? t("{n} snoozed", { n: hiddenSnoozed })
      : t("New issues land here first.");

  return (
    <div>
      <PageHeader
        title={t("Inbox")}
        description={description}
        actions={
          <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <Switch size="sm" checked={showSnoozed} onCheckedChange={setShowSnoozed} aria-label={t("Show snoozed")} />
            {t("Show snoozed")}
          </Label>
        }
      >
        <CaptureBox projects={projects} />
      </PageHeader>

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="text-[var(--viz-good)]" />}
          title={t("Inbox zero")}
          description={
            hiddenSnoozed
              ? t(hiddenSnoozed === 1 ? "Nothing to triage right now. {n} snoozed issue is waiting." : "Nothing to triage right now. {n} snoozed issues are waiting.", { n: hiddenSnoozed })
              : t("Nothing to triage. Capture something above, or press C anywhere.")
          }
        />
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
                onAccept={() => move(issue, "backlog", "Accepted {key}")}
                onStart={() => move(issue, "in_progress", "Started {key}")}
                onDecline={() => move(issue, "cancelled", "Declined {key}")}
                onSnooze={(until) => snooze(issue, until)}
              />
            ))}
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> {t("move")}</span>
            <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> {t("open")}</span>
            <span className="inline-flex items-center gap-1"><Kbd>1</Kbd> {t("accept")}</span>
            <span className="inline-flex items-center gap-1"><Kbd>2</Kbd> {t("start")}</span>
            <span className="inline-flex items-center gap-1"><Kbd>3</Kbd> {t("decline")}</span>
            <span className="inline-flex items-center gap-1"><Kbd>H</Kbd> {t("snooze")}</span>
            <span>{t("Double-click a title to rename")}</span>
          </p>
        </>
      )}
    </div>
  );
}

function CaptureBox({ projects }: { projects: Project[] }) {
  const t = useT();
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
      toast.success(t("Added {n} to triage", { n: created.length }));
      setText("");
    } catch (e) {
      toast.error(t("Could not add issues"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (!projects.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {t("Issues live inside projects. Create one to start capturing.")}
        <Button type="button" variant="outline" size="sm" className="ms-auto" onClick={() => openQuickCreate("project")}>
          <Plus /> {t("New project")}
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
        placeholder={t("Paste or type; one issue per line")}
        aria-label={t("Capture issues")}
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
          <SelectTrigger size="sm" className="w-auto min-w-36" aria-label={t("Project")}>
            <SelectValue placeholder={t("Project")} />
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
          {t("Add to triage")} <Kbd className="ms-1 bg-primary-foreground/20 text-primary-foreground">⌘↵</Kbd>
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
  const t = useT();
  const snoozed = isSnoozed(issue, now);

  function saveTitle(raw: string) {
    const next = raw.trim();
    if (next && next !== issue.title) void safeWrite(() => updateIssue(issue.id, { title: next }));
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
          aria-label={t("Title")}
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
          title={t("Double-click to rename")}
          onClick={onSelect}
          onDoubleClick={() => onEdit(true)}
          className="min-w-0 flex-1 truncate rounded-md px-1.5 py-0.5 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {issue.title}
        </button>
      )}
      {snoozed ? (
        <Badge variant="outline" className="hidden h-5 gap-1 font-normal text-muted-foreground sm:inline-flex" title={t("Snoozed until {date}", { date: fmtDate(issue.snoozedUntil, "d MMM yyyy HH:mm") })}>
          <Clock /> {fmtDate(issue.snoozedUntil, "d MMM")}
        </Badge>
      ) : null}
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={fmtDate(issue.createdAt, "d MMM yyyy HH:mm")}>
        {ago(issue.createdAt)}
      </span>
      <div className={cn("flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-data-selected:opacity-100 md:focus-within:opacity-100", snoozeOpen && "md:opacity-100")}>
        <Action label={t("Accept")} kbd="1" onClick={onAccept}><CircleDashed /></Action>
        <Action label={t("Start")} kbd="2" onClick={onStart}><CircleDot className="text-[var(--viz-series-4)]" /></Action>
        <Action label={t("Decline")} kbd="3" onClick={onDecline}><CircleSlash /></Action>
        <SnoozeMenu open={snoozeOpen} onOpenChange={onSnoozeOpen} onPick={onSnooze} />
        <Button asChild variant="ghost" size="icon-xs" aria-label={t("Open {key}", { key: keyLabel })} className="text-muted-foreground">
          <Link href={issueHref(issue)}><ArrowUpRight className="rtl:-scale-x-100" /></Link>
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
