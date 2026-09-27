"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { useT } from "@/lib/i18n";
import { createNote } from "@/lib/repo";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { NOTE_KINDS, type NoteKind } from "@/lib/types";

/**
 * /notes/new?title=&kind=&project= — the target of a missing [[wikilink]].
 * Creates the note and replaces itself with it. If a note with that title
 * already exists (created since the link was rendered) it opens that instead,
 * so following a link never makes a duplicate.
 */
export function NewNote() {
  const sp = useSearchParams();
  const router = useRouter();
  const t = useT();
  // Strict mode runs effects twice; only one note may come out of it.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const title = (sp.get("title") ?? "").trim();
    const kindParam = sp.get("kind");
    const kind: NoteKind = NOTE_KINDS.some((k) => k.value === kindParam) ? (kindParam as NoteKind) : "page";
    const projectId = sp.get("project") || undefined;
    void (async () => {
      if (title) {
        const lower = title.toLowerCase();
        const existing = await db.notes.filter((n) => n.title.toLowerCase() === lower).first();
        if (existing) {
          router.replace(`/notes/${existing.id}`);
          return;
        }
      }
      const n = await createNote({ kind, title, projectId, body: NOTE_TEMPLATES[kind] });
      router.replace(`/notes/${n.id}`);
    })();
  }, [sp, router]);

  return (
    <div className="space-y-4" aria-busy>
      <p className="text-sm text-muted-foreground">{t("Creating note…")}</p>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
