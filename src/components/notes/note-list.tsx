"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Pin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { KindBadge, ProjectChip } from "@/components/ui-bits";
import { ago, fmtShort } from "@/lib/dates";
import { NOTE_KINDS, type Note, type Project } from "@/lib/types";

export type NoteSort = "updated" | "created" | "title" | "date";

export interface NoteListFilters {
  q: string;
  kind: string;
  sort: string;
}

const SORTS: { value: NoteSort; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Created" },
  { value: "date", label: "Note date" },
  { value: "title", label: "Title" },
];

/** First meaningful line of a body, with markdown syntax stripped. */
export function noteSnippet(body: string, max = 140) {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, a?: string) => a ?? t)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .replace(/\|/g, " ")
      .trim();
    if (line && !/^[-:| ]+$/.test(line)) return line.length > max ? line.slice(0, max - 1) + "…" : line;
  }
  return "";
}

export function filterAndSortNotes(notes: Note[], f: NoteListFilters) {
  const q = f.q.trim().toLowerCase();
  const kind = f.kind;
  const sort = (SORTS.some((s) => s.value === f.sort) ? f.sort : "updated") as NoteSort;
  const rows = notes.filter((n) => {
    if (kind && n.kind !== kind) return false;
    if (!q) return true;
    return n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)) || n.body.toLowerCase().includes(q);
  });
  rows.sort((a, b) => {
    switch (sort) {
      case "created":
        return b.createdAt.localeCompare(a.createdAt);
      case "date":
        return b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt);
      case "title":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      default:
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  });
  return rows;
}

function isEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * The list half of the vault, shared by /notes and a project's notes tab.
 * Search, kind and sort are controlled by the caller so the vault can keep
 * them in the URL while a project tab keeps them local.
 */
export function NoteList({
  notes,
  projects,
  filters,
  onFiltersChange,
  emptyState,
  loading = false,
  className,
}: {
  notes: Note[];
  projects: Project[];
  filters: NoteListFilters;
  onFiltersChange: (patch: Partial<NoteListFilters>) => void;
  emptyState?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const rows = useMemo(() => filterAndSortNotes(notes, filters), [notes, filters]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  // j / k move a cursor through the list, Enter opens. Only when nothing is
  // focused for typing, and never when something else already handled the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      if (e.key === "j") {
        e.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, c + 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        // A focused link or button has its own Enter; only act from the page itself.
        if (e.target instanceof HTMLElement && e.target.closest("a, button, [role='button'], [role='combobox'], [role='option'], [role='menuitem'], [role='dialog']")) return;
        const n = rows[cursor];
        if (n) {
          e.preventDefault();
          router.push(`/notes/${n.id}`);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, router]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const sort = SORTS.some((s) => s.value === filters.sort) ? filters.sort : "updated";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.q}
            dir="auto"
            onChange={(e) => {
              setCursor(-1);
              onFiltersChange({ q: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            placeholder="Search titles, text and tags"
            aria-label="Search notes"
            className="h-8 ps-8"
          />
        </div>
        <Select value={filters.kind || "__all"} onValueChange={(v) => onFiltersChange({ kind: v === "__all" ? "" : v })}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All kinds</SelectItem>
            {NOTE_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => onFiltersChange({ sort: v === "updated" ? "" : v })}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Sort">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <ul className="space-y-1" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="space-y-2 rounded-md px-3 py-2.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        emptyState ?? <p className="py-10 text-center text-sm text-muted-foreground">No notes match.</p>
      ) : (
        <>
          <ul ref={listRef} className="divide-y rounded-lg border bg-card" role="list">
            {rows.map((n, i) => {
              const project = n.projectId ? projectById.get(n.projectId) : undefined;
              const snippet = noteSnippet(n.body);
              return (
                <li key={n.id} data-active={i === cursor}>
                  <Link
                    href={`/notes/${n.id}`}
                    onMouseEnter={() => setCursor(i)}
                    className={cn("flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none", i === cursor && "bg-accent")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        {n.pinned ? <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" /> : null}
                        <span className="truncate text-sm font-medium" dir="auto">
                          {n.title}
                        </span>
                        <KindBadge kind={n.kind} className="shrink-0" />
                      </div>
                      {snippet ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
                          {snippet}
                        </p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="truncate">{n.folder}</span>
                        {project ? <ProjectChip project={project} link={false} className="text-[11px]" /> : null}
                        <span className="tabular">{fmtShort(n.date)}</span>
                        {n.tags.length ? <span className="truncate">{n.tags.map((t) => `#${t}`).join(" ")}</span> : null}
                      </div>
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular" title={n.updatedAt}>
                      {ago(n.updatedAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground max-md:hidden">
            {rows.length} {rows.length === 1 ? "note" : "notes"} · <Kbd>J</Kbd> <Kbd>K</Kbd> to move, <Kbd>↵</Kbd> to open
          </p>
        </>
      )}
    </div>
  );
}
