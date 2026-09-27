"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowRightLeft, Scale, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownEditor } from "@/components/markdown";
import { EmptyState, ProjectDot } from "@/components/ui-bits";
import { useLinkIndex } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { useT } from "@/lib/i18n";
import { createDecision, deleteDecision, updateDecision } from "@/lib/repo";
import { DECISION_STATUSES, type Decision, type DecisionStatus } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { BacklinkList } from "@/components/notes/note-links-panel";
import { TagsEditor } from "@/components/notes/tags-editor";
import { useDraft } from "@/components/notes/use-draft";
import { DecisionStatusIcon } from "./decision-status";

type TextField = "context" | "decision" | "consequences" | "alternatives";

const SECTIONS: { field: TextField; title: string; hint: string }[] = [
  { field: "context", title: "Context", hint: "What forces are at play: constraints, prior art, what already exists." },
  { field: "decision", title: "Decision", hint: "What was chosen, stated as a fact." },
  { field: "consequences", title: "Consequences", hint: "What becomes easier, what becomes harder, what must now be watched." },
  { field: "alternatives", title: "Alternatives considered", hint: "The options rejected and why." },
];

/** /decisions/[id] — one ADR. */
export function DecisionEditor() {
  const { id } = useParams<{ id: string }>();
  const decision = useLiveQuery(() => db.decisions.get(id).then((d) => d ?? null), [id], undefined);
  const [deleted, setDeleted] = useState(false);
  const t = useT();

  if (decision === undefined || (decision === null && deleted)) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (decision === null) {
    return (
      <EmptyState icon={<Scale />} title={t("Decision not found")} description={t("It may have been deleted.")}>
        <Button asChild size="sm" variant="outline">
          <Link href="/decisions">{t("Back to decisions")}</Link>
        </Button>
      </EmptyState>
    );
  }
  return <Editor key={decision.id} decision={decision} onDeleted={() => setDeleted(true)} />;
}

function Editor({ decision, onDeleted }: { decision: Decision; onDeleted: () => void }) {
  const router = useRouter();
  const { openAI } = useUi();
  const idx = useLinkIndex();
  const t = useT();
  const [title, setTitle] = useDraft(decision.title, (v) => updateDecision(decision.id, { title: v.trim() || t("Untitled decision") }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSupersede, setConfirmSupersede] = useState(false);
  const targets = useMemo(() => [`ADR-${decision.seq}`], [decision.seq]);

  async function supersede() {
    const next = await createDecision({
      title: t("Supersedes ADR-{n}: {title}", { n: decision.seq, title: decision.title }),
      projectId: decision.projectId,
      tags: decision.tags,
      context: t("Supersedes [[ADR-{n}]].", { n: decision.seq }) + "\n\n",
    });
    await updateDecision(decision.id, { status: "superseded" });
    toast.success(t("ADR-{next} created; ADR-{prev} marked superseded", { next: next.seq, prev: decision.seq }));
    router.push(`/decisions/${next.id}`);
  }

  async function remove() {
    onDeleted();
    await deleteDecision(decision.id);
    toast.success(t("ADR-{n} deleted", { n: decision.seq }));
    router.replace("/decisions");
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/decisions" className="font-mono text-xs text-muted-foreground hover:underline">
            {t("Decisions")}
          </Link>
          <span className="text-xs text-muted-foreground" aria-hidden>
            /
          </span>
          <span className="font-mono text-xs font-medium">ADR-{decision.seq}</span>
          <div className="ms-auto flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openAI({
                  prompt: t("Review decision ADR-{n}: {title}. Is the context sufficient to justify the decision, are the consequences honest, and which alternative deserved more weight?", { n: decision.seq, title: decision.title }),
                  projectId: decision.projectId,
                })
              }
            >
              <Sparkles /> {t("Ask AI")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmSupersede(true)} disabled={decision.status === "superseded"}>
              <ArrowRightLeft /> {t("Supersede")}
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> {t("Delete")}
            </Button>
          </div>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={t("Untitled decision")}
          aria-label={t("Title")}
          dir="auto"
          className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t("Status")}</span>
          <Select value={decision.status} onValueChange={(v) => void updateDecision(decision.id, { status: v as DecisionStatus })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECISION_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <DecisionStatusIcon status={s.value} /> {t(s.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t("Date")}</span>
          <Input type="date" value={decision.date} onChange={(e) => e.target.value && void updateDecision(decision.id, { date: e.target.value })} aria-label={t("Date")} className="h-7 w-auto text-xs" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t("Project")}</span>
          <Select value={decision.projectId ?? "__none"} onValueChange={(v) => void updateDecision(decision.id, { projectId: v === "__none" ? undefined : v })}>
            <SelectTrigger size="sm" className="w-auto" aria-label={t("Project")}>
              <SelectValue placeholder={t("No project")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t("No project")}</SelectItem>
              {idx.projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <ProjectDot project={p} /> {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 items-center gap-1.5">
          <span className="text-muted-foreground">{t("Tags")}</span>
          <TagsEditor tags={decision.tags} onChange={(tags) => void updateDecision(decision.id, { tags })} className="flex-1" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          {SECTIONS.map((s) => (
            <Section key={s.field} decisionId={decision.id} field={s.field} title={t(s.title)} hint={t(s.hint)} remote={decision[s.field]} projectId={decision.projectId} />
          ))}
        </div>
        <aside className="space-y-2 lg:sticky lg:top-16 lg:self-start">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Mentioned in")}</h3>
          <BacklinkList targets={targets} notes={idx.notes} emptyText={t("No note cites [[ADR-{n}]] yet.", { n: decision.seq })} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirmSupersede}
        onOpenChange={setConfirmSupersede}
        title={t("Supersede ADR-{n}?", { n: decision.seq })}
        description={t("A new decision is created with the same title, and this one is marked superseded. Its text stays as the record of what was decided at the time.")}
        confirmLabel="Create successor"
        onConfirm={supersede}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("Delete ADR-{n}?", { n: decision.seq })}
        description={t("Decisions are usually superseded or deprecated rather than deleted, so the number keeps meaning. Delete only a record that was created by mistake.")}
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

function Section({ decisionId, field, title, hint, remote, projectId }: { decisionId: string; field: TextField; title: string; hint: string; remote: string; projectId?: string }) {
  const [value, setValue] = useDraft(remote, (v) => updateDecision(decisionId, { [field]: v }));
  const aiContext = useMemo(() => ({ projectId }), [projectId]);
  return (
    <section className="space-y-1.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <MarkdownEditor value={value} onChange={setValue} minRows={5} placeholder={hint} aiContext={aiContext} />
    </section>
  );
}
