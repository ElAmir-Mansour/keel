"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useT } from "@/lib/i18n";
import { createIssue, postUpdate } from "@/lib/repo";
import { HEALTHS, PRIORITIES, type Health, type Priority } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useActiveProjects } from "@/hooks/use-data";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HealthBadge, PriorityIcon, ProjectDot, priorityLabel } from "@/components/ui-bits";

// What the user can do with an answer: copy it, turn it into issues, or post it
// as a weekly update. Everything that writes goes through repo.ts.

export interface ProposedTask {
  title: string;
  priority?: Priority;
  dueDate?: string;
}

const PRIORITY_VALUES = new Set<string>(PRIORITIES.map((p) => p.value));

/** Tolerant parser: the model was told JSON only, but fences and prose still happen. */
export function parseTasks(raw: string): ProposedTask[] | null {
  const text = raw.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const out: ProposedTask[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    const task: ProposedTask = { title: title.slice(0, 200) };
    if (typeof o.priority === "string" && o.priority !== "none" && PRIORITY_VALUES.has(o.priority)) {
      task.priority = o.priority as Priority;
    }
    if (typeof o.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)) task.dueDate = o.dueDate;
    out.push(task);
    if (out.length >= 12) break;
  }
  return out;
}

/** Read the verdict the model wrote under "## Health", if it used the English labels. */
export function parseHealth(markdown: string): Health | undefined {
  const m = markdown.match(/##\s*Health\s*\n+[\s*_-]*(on track|at risk|off track)/i);
  switch (m?.[1].toLowerCase()) {
    case "on track":
      return "on_track";
    case "at risk":
      return "at_risk";
    case "off track":
      return "off_track";
    default:
      return undefined;
  }
}

/** Models sometimes fence a whole markdown answer despite instructions; unwrap that case only. */
export function unfence(text: string) {
  const m = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1] : text.trim();
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          toast.error(t("Could not copy to the clipboard"));
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t("Copied") : t(label)}
    </Button>
  );
}

export function TasksProposal({ raw, noteId, projectId }: { raw: string; noteId?: string; projectId?: string }) {
  const t = useT();
  const tasks = useMemo(() => parseTasks(raw), [raw]);
  const projects = useActiveProjects();
  const note = useLiveQuery(() => (noteId ? db.notes.get(noteId) : undefined), [noteId]);
  const router = useRouter();
  const [selected, setSelected] = useState<boolean[]>(() => tasks?.map(() => true) ?? []);
  const [pid, setPid] = useState("");
  const [created, setCreated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const effectivePid = pid || projectId || note?.projectId || projects[0]?.id || "";

  if (!tasks) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">{t("Could not read a task list from the answer.")}</p>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("Show raw answer")}</summary>
          <pre className="mt-1 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap" dir="auto">
            {raw}
          </pre>
        </details>
      </div>
    );
  }
  if (!tasks.length) return <p className="text-sm text-muted-foreground">{t("No open action items found in this note.")}</p>;

  const count = selected.filter(Boolean).length;

  async function create() {
    if (!effectivePid) {
      toast.error(t("Create a project first"));
      return;
    }
    const chosen = tasks!.filter((_, i) => selected[i]);
    setBusy(true);
    try {
      for (const task of chosen) {
        await createIssue({
          projectId: effectivePid,
          title: task.title,
          status: "backlog",
          priority: task.priority,
          dueDate: task.dueDate,
          description: note ? `From [[${note.title}]]` : "",
        });
      }
      setCreated(chosen.length);
      toast.success(chosen.length === 1 ? t("Created 1 issue") : t("Created {n} issues", { n: chosen.length }), {
        action: { label: t("Open issues"), onClick: () => router.push(`/projects/${effectivePid}/issues`) },
      });
    } catch {
      toast.error(t("Could not create the issues"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <ul className="space-y-1.5">
        {tasks.map((task, i) => {
          const id = `ai-task-${i}`;
          return (
            <li key={id} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={selected[i] ?? false}
                disabled={created !== null}
                onCheckedChange={(v) => setSelected((s) => s.map((x, j) => (j === i ? v === true : x)))}
              />
              <label htmlFor={id} className={cn("min-w-0 flex-1 leading-5", created !== null && "text-muted-foreground")} dir="auto">
                {task.title}
                {task.priority || task.dueDate ? (
                  <span className="ms-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    {task.priority ? (
                      <span className="inline-flex items-center gap-1">
                        <PriorityIcon priority={task.priority} /> {priorityLabel(task.priority)}
                      </span>
                    ) : null}
                    {task.dueDate ? <span>{t("due {date}", { date: task.dueDate })}</span> : null}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={effectivePid} onValueChange={setPid} disabled={created !== null}>
          <SelectTrigger size="sm" className="min-w-40" aria-label={t("Project")}>
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
        {created === null ? (
          <Button size="sm" disabled={!count || !effectivePid || busy} onClick={create}>
            {count === 1 ? t("Create 1 issue") : t("Create {n} issues", { n: count })}
          </Button>
        ) : (
          <Link href={`/projects/${effectivePid}/issues`} className="text-sm underline underline-offset-4">
            {t("Created {n} — open the issues", { n: created })}
          </Link>
        )}
      </div>
    </div>
  );
}

export function WeeklyPost({ markdown, projectId }: { markdown: string; projectId?: string }) {
  const t = useT();
  const router = useRouter();
  const [health, setHealth] = useState<Health>(() => parseHealth(markdown) ?? "on_track");
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function post() {
    if (!projectId) return;
    setBusy(true);
    try {
      await postUpdate({ projectId, health, summary: unfence(markdown) });
      setPosted(true);
      toast.success(t("Update posted"), {
        action: { label: t("Open updates"), onClick: () => router.push(`/projects/${projectId}/updates`) },
      });
    } catch {
      toast.error(t("Could not post the update"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {projectId ? (
        <>
          <div role="radiogroup" aria-label={t("Health")} className="flex items-center gap-1">
            {HEALTHS.map((h) => (
              <button
                key={h.value}
                type="button"
                role="radio"
                aria-checked={health === h.value}
                disabled={posted}
                onClick={() => setHealth(h.value)}
                className={cn(
                  "rounded-full outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-ring/50",
                  health === h.value ? "opacity-100 ring-2 ring-ring/40" : "opacity-55 hover:opacity-90",
                )}
              >
                <HealthBadge health={h.value} />
              </button>
            ))}
          </div>
          {posted ? (
            <Link href={`/projects/${projectId}/updates`} className="text-sm underline underline-offset-4">
              {t("Posted — open updates")}
            </Link>
          ) : (
            <Button size="xs" onClick={post} disabled={busy}>
              <Send /> {t("Post as update")}
            </Button>
          )}
        </>
      ) : null}
      <CopyButton text={unfence(markdown)} />
    </div>
  );
}
