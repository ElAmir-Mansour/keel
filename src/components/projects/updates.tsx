"use client";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subDays } from "date-fns";
import { AlertTriangle, CheckCircle2, ListChecks, Send, Sparkles, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { ago, fmtDate, parseYMD, todayYMD } from "@/lib/dates";
import { deleteUpdate, postUpdate } from "@/lib/repo";
import { HEALTHS, issueKey, riskScore, type Health, type Issue, type Project, type Risk, type Update } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { EmptyState, HealthBadge } from "@/components/ui-bits";
import { MarkdownEditor, MarkdownView } from "@/components/markdown";
import { completedBetween } from "@/components/dashboard/data";

// Weekly health update: a short form on top, the history below. The local
// draft is plain text built from the last seven days; the AI draft goes
// through the assistant panel.

export function ProjectUpdates({ id }: { id: string }) {
  const data = useLiveQuery(
    async () => {
      const [project, issues, risks, updates] = await Promise.all([
        db.projects.get(id),
        db.issues.where({ projectId: id }).toArray(),
        db.risks.where({ projectId: id }).toArray(),
        db.updates.where({ projectId: id }).toArray(),
      ]);
      return { project, issues, risks, updates };
    },
    [id],
    null,
  );
  const sorted = useMemo(
    () => (data ? [...data.updates].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)) : []),
    [data],
  );

  if (!data || !data.project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpdateForm project={data.project} issues={data.issues} risks={data.risks} lastHealth={sorted[0]?.health} />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Past updates</h2>
        {sorted.length === 0 ? (
          <EmptyState title="No updates yet" description="Post the first one above. A short honest note every week beats a long one every month." />
        ) : (
          <ol className="space-y-3">
            {sorted.map((u) => (
              <UpdateItem key={u.id} update={u} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function UpdateForm({ project, issues, risks, lastHealth }: { project: Project; issues: Issue[]; risks: Risk[]; lastHealth?: Health }) {
  const { openAI } = useUi();
  const [health, setHealth] = useState<Health>(lastHealth ?? "on_track");
  const [date, setDate] = useState(todayYMD());
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!summary.trim() || busy) return;
    setBusy(true);
    try {
      await postUpdate({ projectId: project.id, health, summary: summary.trim(), date });
      toast.success("Update posted");
      setSummary("");
    } finally {
      setBusy(false);
    }
  }

  function draftFromActivity() {
    setSummary(buildDraft(project, issues, risks, health, date));
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Post an update</CardTitle>
        <CardDescription className="text-xs">Health, the week in a few lines, and what you need from others.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Health</Label>
            <HealthSegments value={health} onChange={setHealth} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="update-date" className="text-xs text-muted-foreground">
              Date
            </Label>
            <Input id="update-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-auto" />
          </div>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={draftFromActivity}>
              <ListChecks className="size-4" />
              Draft from activity
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAI({ projectId: project.id, action: "weekly" })}>
              <Sparkles className="size-4" />
              Draft with AI
            </Button>
          </div>
        </div>
        <MarkdownEditor value={summary} onChange={setSummary} minRows={8} placeholder="What shipped, what is next, what is at risk, what you need." aiContext={{ projectId: project.id }} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Posting as {fmtDate(date)}</span>
          <Button size="sm" onClick={submit} disabled={!summary.trim() || busy}>
            <Send className="size-4" />
            Post update
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthSegments({ value, onChange }: { value: Health; onChange: (h: Health) => void }) {
  return (
    <div role="radiogroup" aria-label="Health" className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
      {HEALTHS.map((h) => {
        const active = value === h.value;
        const Icon = h.value === "on_track" ? CheckCircle2 : h.value === "at_risk" ? AlertTriangle : XCircle;
        const tone = h.value === "on_track" ? "text-[var(--viz-good)]" : h.value === "at_risk" ? "text-[var(--viz-warning)]" : "text-[var(--viz-critical)]";
        return (
          <button
            key={h.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(h.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className={cn("size-3.5", tone)} aria-hidden />
            {h.label}
          </button>
        );
      })}
    </div>
  );
}

function UpdateItem({ update }: { update: Update }) {
  const [confirm, setConfirm] = useState(false);
  async function remove() {
    await deleteUpdate(update.id);
    toast.success("Update deleted");
  }
  return (
    <li>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <HealthBadge health={update.health} />
            <span>{fmtDate(update.date)}</span>
            <span className="text-xs font-normal text-muted-foreground">posted {ago(update.createdAt)}</span>
          </CardTitle>
          <CardAction className="flex items-center gap-1">
            {confirm ? (
              <>
                <span className="text-xs text-muted-foreground">Delete this update?</span>
                <Button size="xs" variant="destructive" onClick={remove} autoFocus>
                  Delete
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="icon-xs" variant="ghost" aria-label="Delete update" onClick={() => setConfirm(true)}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent>
          <MarkdownView body={update.summary} className="text-sm" />
        </CardContent>
      </Card>
    </li>
  );
}

/** Plain-text draft from the last seven days of activity. No AI involved. */
export function buildDraft(project: Project, issues: Issue[], risks: Risk[], health: Health, date: string) {
  const today = parseYMD(date);
  const shipped = completedBetween(issues, subDays(today, 6), today).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const next = issues
    .filter((i) => i.status === "in_progress" || i.status === "in_review" || i.status === "todo")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, 6);
  const hot = risks
    .filter((r) => (r.status === "open" || r.status === "mitigating") && riskScore(r) >= 10)
    .sort((a, b) => riskScore(b) - riskScore(a));
  const line = (i: Issue) => `- ${issueKey(project, i)} ${i.title}`;
  const healthLabel = HEALTHS.find((h) => h.value === health)?.label ?? health;
  return [
    "## Health",
    healthLabel,
    "",
    "## Shipped this week",
    shipped.length ? shipped.map(line).join("\n") : "- Nothing completed this week",
    "",
    "## Next week",
    next.length ? next.map((i) => `${line(i)}${i.dueDate ? ` (due ${fmtDate(i.dueDate)})` : ""}`).join("\n") : "- Nothing scheduled yet",
    "",
    "## Risks and asks",
    hot.length ? hot.map((r) => `- ${r.title} (${r.likelihood}×${r.impact} = ${riskScore(r)})`).join("\n") : "- No open risks scored 10 or higher",
    "",
  ].join("\n");
}
