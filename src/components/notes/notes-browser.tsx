"use client";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, FileText, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { todayYMD } from "@/lib/dates";
import { getOrCreateDailyNote } from "@/lib/repo";
import { useUi } from "@/lib/ui-store";
import { NoteList } from "./note-list";
import { useUrlFilters } from "./use-url-filters";
import { inFolder, VaultRail } from "./vault-rail";

const KEYS = ["folder", "tag", "q", "kind", "sort"] as const;

/** /notes — the vault: folder rail on the left, searchable list on the right. */
export function NotesBrowser() {
  const router = useRouter();
  const { openQuickCreate } = useUi();
  const notes = useLiveQuery(() => db.notes.toArray(), [], null);
  const projects = useProjects();
  const [f, setF] = useUrlFilters(KEYS);

  const scoped = useMemo(() => (notes ?? []).filter((n) => inFolder(n, f.folder) && (!f.tag || n.tags.includes(f.tag))), [notes, f.folder, f.tag]);
  const listFilters = useMemo(() => ({ q: f.q, kind: f.kind, sort: f.sort }), [f.q, f.kind, f.sort]);

  const openToday = () => void getOrCreateDailyNote(todayYMD()).then((n) => router.push(`/notes/${n.id}`));

  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={openToday}>
        <CalendarDays /> Today
      </Button>
      <Button size="sm" onClick={() => openQuickCreate("note")}>
        <Plus /> New note
      </Button>
    </>
  );

  if (notes && notes.length === 0) {
    return (
      <>
        <PageHeader title="Notes" description="Your vault. Markdown notes that link to each other, to issues and to decisions." actions={actions} />
        <EmptyState
          icon={<FileText />}
          title="An empty vault"
          description="Write in markdown. Type [[ to link another note, an issue like PLAT-12, or a decision like ADR-3 — links resolve as you type, and every note lists what links back to it. Press T for today's daily note; it is created the first time you open it."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={openToday}>
              <CalendarDays /> Open today&apos;s note
            </Button>
            <Button size="sm" variant="outline" onClick={() => openQuickCreate("note")}>
              <Plus /> New note
            </Button>
          </div>
        </EmptyState>
      </>
    );
  }

  const activeFilters = [f.folder ? { key: "folder" as const, label: f.folder } : null, f.tag ? { key: "tag" as const, label: `#${f.tag}` } : null].filter(Boolean) as { key: "folder" | "tag"; label: string }[];

  return (
    <>
      <PageHeader title="Notes" description="Your vault. Markdown notes that link to each other, to issues and to decisions." actions={actions} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="thin-scroll lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
          <VaultRail notes={notes ?? []} folder={f.folder} tag={f.tag} onFolder={(folder) => setF({ folder })} onTag={(tag) => setF({ tag })} />
        </aside>
        <div className="min-w-0 space-y-3">
          {activeFilters.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Showing
              {activeFilters.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setF({ [a.key]: "" })}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-foreground hover:bg-muted"
                  aria-label={`Clear ${a.key} filter`}
                  dir="auto"
                >
                  {a.label}
                  <X className="size-3" />
                </button>
              ))}
            </div>
          ) : null}
          <NoteList
            notes={scoped}
            projects={projects}
            filters={listFilters}
            onFiltersChange={(patch) => setF(patch)}
            loading={notes === null}
            emptyState={
              <p className="py-10 text-center text-sm text-muted-foreground">
                No notes match.{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => setF({ folder: "", tag: "", q: "", kind: "" })}>
                  Clear filters
                </button>
              </p>
            }
          />
        </div>
      </div>
    </>
  );
}
