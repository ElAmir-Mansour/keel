"use client";
import Link from "next/link";
import { useMemo } from "react";
import { CircleDot, FilePlus, FileText, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { KindBadge, ProjectChip } from "@/components/ui-bits";
import { ago, fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { NOTE_STATUSES, type Note, type Project } from "@/lib/types";
import { backlinksTo, extractLinks, resolveLink, type LinkIndex } from "@/lib/wikilinks";
import { noteSnippet } from "./note-list";

function PanelSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {count !== undefined ? <span className="rounded-full bg-secondary px-1.5 text-[10px] font-medium normal-case tabular">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** The line of `body` that mentions any of `targets`, as a short snippet. */
function mentionSnippet(body: string, targets: string[]) {
  const wanted = targets.map((t) => t.toLowerCase());
  const line = body.split(/\r?\n/).find((l) => {
    const lower = l.toLowerCase();
    return wanted.some((t) => lower.includes(`[[${t}]]`) || lower.includes(`[[${t}|`));
  });
  return line ? noteSnippet(line, 110) : "";
}

/** Notes whose body links to one of `targets` (a title, KEY-12 or ADR-3). */
export function BacklinkList({ targets, notes, excludeId, emptyText }: { targets: string[]; notes: Note[]; excludeId?: string; emptyText?: string }) {
  const t = useT();
  const rows = useMemo(() => backlinksTo(targets, notes).filter((n) => n.id !== excludeId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [targets, notes, excludeId]);
  if (!rows.length) return <p className="text-xs text-muted-foreground">{emptyText ?? t("Nothing links here yet.")}</p>;
  return (
    <ul className="space-y-1">
      {rows.map((n) => {
        const snippet = mentionSnippet(n.body, targets);
        return (
          <li key={n.id}>
            <Link href={`/notes/${n.id}`} className="block rounded-md border px-2.5 py-1.5 hover:bg-muted/60">
              <span className="flex items-center gap-1.5 text-sm">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" dir="auto">
                  {n.title}
                </span>
              </span>
              {snippet ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground" dir="auto">
                  {snippet}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Outgoing links, backlinks and a properties summary for a note. */
export function NoteLinksPanel({ note, body, idx, project, className }: { note: Note; body: string; idx: LinkIndex; project?: Project | null; className?: string }) {
  const t = useT();
  const outgoing = useMemo(() => {
    const seen = new Set<string>();
    const out: { target: string; r: ReturnType<typeof resolveLink> }[] = [];
    for (const l of extractLinks(body)) {
      const key = l.target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ target: l.target, r: resolveLink(l.target, idx) });
    }
    return out;
  }, [body, idx]);
  const targets = useMemo(() => [note.title], [note.title]);
  const words = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);
  const status = NOTE_STATUSES.find((s) => s.value === note.status)?.label;

  return (
    <div className={cn("space-y-5 text-sm", className)}>
      <PanelSection title={t("Links")} count={outgoing.length}>
        {outgoing.length ? (
          <ul className="space-y-0.5">
            {outgoing.map(({ target, r }) => (
              <li key={target}>
                <Link
                  href={r.href}
                  className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/60", r.kind === "missing" && "text-muted-foreground")}
                  title={r.kind === "missing" ? t('Create "{name}"', { name: target }) : r.kind === "issue" ? r.issue.title : r.kind === "decision" ? r.decision.title : r.label}
                >
                  {r.kind === "note" ? <FileText className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                  {r.kind === "issue" ? <CircleDot className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                  {r.kind === "decision" ? <Scale className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                  {r.kind === "missing" ? <FilePlus className="size-3.5 shrink-0" /> : null}
                  <span className={cn("truncate", r.kind === "issue" && "font-mono text-xs", r.kind === "missing" && "underline decoration-dashed underline-offset-2")} dir="auto">
                    {r.label}
                  </span>
                  {r.kind === "missing" ? <span className="ms-auto text-[10px] uppercase tracking-wide">{t("create")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("No links yet. Type [[ in the body to link a note, issue or decision.")}</p>
        )}
      </PanelSection>

      <PanelSection title={t("Backlinks")}>
        <BacklinkList targets={targets} notes={idx.notes} excludeId={note.id} />
      </PanelSection>

      <PanelSection title={t("Properties")}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t("Kind")}</dt>
          <dd>
            <KindBadge kind={note.kind} />
          </dd>
          <dt className="text-muted-foreground">{t("Folder")}</dt>
          <dd className="truncate" dir="auto">
            {note.folder}
          </dd>
          {project ? (
            <>
              <dt className="text-muted-foreground">{t("Project")}</dt>
              <dd>
                <ProjectChip project={project} />
              </dd>
            </>
          ) : null}
          {status ? (
            <>
              <dt className="text-muted-foreground">{t("Status")}</dt>
              <dd>{t(status)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("Date")}</dt>
          <dd className="tabular">{fmtDate(note.date)}</dd>
          {note.tags.length ? (
            <>
              <dt className="text-muted-foreground">{t("Tags")}</dt>
              <dd className="truncate" dir="auto">
                {note.tags.map((tag) => `#${tag}`).join(" ")}
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("Created")}</dt>
          <dd className="tabular" title={note.createdAt}>
            {fmtDate(note.createdAt, "d MMM yyyy, HH:mm")}
          </dd>
          <dt className="text-muted-foreground">{t("Updated")}</dt>
          <dd className="tabular" title={note.updatedAt}>
            {ago(note.updatedAt)}
          </dd>
          <dt className="text-muted-foreground">{t("Length")}</dt>
          <dd className="tabular">
            {words === 1 ? t("1 word") : t("{n} words", { n: words })} · {t("{n} chars", { n: body.length.toLocaleString() })}
          </dd>
        </dl>
      </PanelSection>
    </div>
  );
}
