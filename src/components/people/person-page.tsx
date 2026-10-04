"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { FileText, MessageSquare, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, IssueKey, PersonAvatar, PriorityIcon, ProjectChip, Section, StatusIcon } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { fmtDate, fmtShort, isOverdue, todayYMD } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { isOpen } from "@/lib/metrics";
import { createNote, deletePerson, updatePerson } from "@/lib/repo";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { PRIORITIES, PROJECT_COLORS, type Issue, type Person, type Project } from "@/lib/types";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { noteSnippet } from "@/components/notes/note-list";
import { useDraft } from "@/components/notes/use-draft";
import { PersonScorecard } from "@/components/points/scorecard";

/** /team/[id] — one person: details, their 1:1 notes and their open work. */
export function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const person = useLiveQuery(() => db.people.get(id).then((p) => p ?? null), [id], undefined);
  const [deleted, setDeleted] = useState(false);
  const t = useT();

  if (person === undefined || (person === null && deleted)) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (person === null) {
    return (
      <EmptyState icon={<Users />} title={t("Person not found")} description={t("They may have been removed.")}>
        <Button asChild size="sm" variant="outline">
          <Link href="/team">{t("Back to people")}</Link>
        </Button>
      </EmptyState>
    );
  }
  return <Loaded key={person.id} person={person} onDeleted={() => setDeleted(true)} />;
}

function Loaded({ person, onDeleted }: { person: Person; onDeleted: () => void }) {
  const router = useRouter();
  const t = useT();
  const projects = useProjects();
  const issues = useLiveQuery(() => db.issues.where({ assigneeId: person.id }).toArray(), [person.id], []);
  const notes = useLiveQuery(() => db.notes.where({ personId: person.id }).toArray(), [person.id], null);
  const [name, setName] = useDraft(person.name, (n) => updatePerson(person.id, { name: n.trim() || person.name }));
  const [role, setRole] = useDraft(person.role, (r) => updatePerson(person.id, { role: r.trim() }));
  const [email, setEmail] = useDraft(person.email ?? "", (e) => updatePerson(person.id, { email: e.trim() || undefined }));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const oneOnOnes = useMemo(() => (notes ?? []).filter((n) => n.kind === "oneonone").sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)), [notes]);

  const groups = useMemo(() => {
    const rank = (i: Issue) => PRIORITIES.find((p) => p.value === i.priority)?.rank ?? 9;
    const byProject = new Map<string, Issue[]>();
    for (const i of issues) {
      if (!isOpen(i)) continue;
      const arr = byProject.get(i.projectId) ?? [];
      arr.push(i);
      byProject.set(i.projectId, arr);
    }
    const out: { project: Project; issues: Issue[] }[] = [];
    for (const p of projects) {
      const arr = byProject.get(p.id);
      if (arr?.length) out.push({ project: p, issues: arr.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt)) });
    }
    return out;
  }, [issues, projects]);
  const openCount = groups.reduce((n, g) => n + g.issues.length, 0);

  async function newOneOnOne() {
    // The date keeps titles unique so [[links]] to a specific 1:1 resolve.
    const n = await createNote({ kind: "oneonone", personId: person.id, title: t("1:1 — {name} · {date}", { name: person.name, date: todayYMD() }), body: NOTE_TEMPLATES.oneonone });
    router.push(`/notes/${n.id}`);
  }

  async function remove() {
    onDeleted();
    await deletePerson(person.id);
    toast.success(t("{name} removed", { name: person.name }));
    router.replace("/team");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <PersonAvatar person={person} size="md" className="size-14 text-lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label={t("Name")}
            dir="auto"
            className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("Role")} aria-label={t("Role")} dir="auto" className="h-7 w-56 text-xs" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("Email")} aria-label={t("Email")} type="email" className="h-7 w-56 text-xs" />
            <div className="flex items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={person.color === c}
                  aria-label={t("Colour {c}", { c })}
                  onClick={() => void updatePerson(person.id, { color: c })}
                  className={cn("size-5 rounded-full border-2", person.color === c ? "border-foreground" : "border-transparent")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button size="sm" onClick={() => void newOneOnOne()}>
            <MessageSquare /> {t("New 1:1 note")}
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> {t("Delete")}
          </Button>
        </div>
      </div>

      <PersonScorecard person={person} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`${t("1:1 notes")}${oneOnOnes.length ? ` · ${oneOnOnes.length}` : ""}`}>
          {notes === null ? (
            <Skeleton className="h-20" />
          ) : oneOnOnes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No 1:1 notes yet. The first one starts from the 1:1 template.")}</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {oneOnOnes.map((n) => (
                <li key={n.id}>
                  <Link href={`/notes/${n.id}`} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/60">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" dir="auto">
                        {n.title}
                      </div>
                      {noteSnippet(n.body) ? (
                        <div className="truncate text-xs text-muted-foreground" dir="auto">
                          {noteSnippet(n.body)}
                        </div>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">{fmtDate(n.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`${t("Open issues")}${openCount ? ` · ${openCount}` : ""}`}>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Nothing assigned right now.")}</p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.project.id} className="rounded-lg border bg-card">
                  <div className="border-b px-3 py-1.5">
                    <ProjectChip project={g.project} />
                  </div>
                  <ul className="divide-y">
                    {g.issues.map((i) => {
                      const overdue = isOverdue(i.dueDate);
                      return (
                        <li key={i.id}>
                          <Link href={`/projects/${g.project.id}/issues/${i.seq}`} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60">
                            <StatusIcon status={i.status} />
                            <IssueKey>
                              {g.project.key}-{i.seq}
                            </IssueKey>
                            <span className="min-w-0 flex-1 truncate" dir="auto">
                              {i.title}
                            </span>
                            <PriorityIcon priority={i.priority} />
                            {i.dueDate ? <span className={cn("text-xs tabular", overdue ? "font-medium text-[var(--viz-critical)]" : "text-muted-foreground")}>{fmtShort(i.dueDate)}</span> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("Remove {name}?", { name: person.name })}
        description={t("Their issues become unassigned and their risks lose an owner. Notes are kept.")}
        confirmLabel="Remove"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
