"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/ui-store";
import { NoteList, type NoteListFilters } from "./note-list";

/** /projects/[id]/notes — the vault list scoped to one project. The project header comes from the layout. */
export function ProjectNotes() {
  const { id } = useParams<{ id: string }>();
  const { openQuickCreate } = useUi();
  const t = useT();
  const projects = useProjects();
  const notes = useLiveQuery(() => db.notes.where({ projectId: id }).toArray(), [id], null);
  const [filters, setFilters] = useState<NoteListFilters>({ q: "", kind: "", sort: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {notes ? (notes.length === 1 ? t("1 note linked to this project") : t("{n} notes linked to this project", { n: notes.length })) : t("Loading notes")}
        </p>
        <Button size="sm" onClick={() => openQuickCreate("note", id)}>
          <Plus /> {t("New note for this project")}
        </Button>
      </div>
      <NoteList
        notes={notes ?? []}
        projects={projects}
        filters={filters}
        onFiltersChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        loading={notes === null}
        emptyState={
          notes && notes.length === 0 ? (
            <EmptyState icon={<FileText />} title={t("No notes for this project yet")} description={t("Meeting notes, specs, runbooks and post-mortems filed under this project show up here.")}>
              <Button size="sm" onClick={() => openQuickCreate("note", id)}>
                <Plus /> {t("New note")}
              </Button>
            </EmptyState>
          ) : undefined
        }
      />
    </div>
  );
}
