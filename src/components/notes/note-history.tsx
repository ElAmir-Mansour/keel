"use client";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { History, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownView } from "@/components/markdown";
import { db } from "@/lib/db";
import { ago, fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { restoreNoteVersion } from "@/lib/repo";
import type { NoteVersion } from "@/lib/types";

/** Past versions of a note: browse, preview, restore. */
export function NoteHistory({ noteId }: { noteId: string }) {
  const t = useT();
  const versions = useLiveQuery(() => db.noteVersions.where({ noteId }).reverse().sortBy("savedAt"), [noteId], [] as NoteVersion[]);
  const [open, setOpen] = useState<NoteVersion | null>(null);

  async function restore(v: NoteVersion) {
    await restoreNoteVersion(v.id);
    setOpen(null);
    toast.success(t("Version restored"));
  }

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="size-3.5" /> {t("History")}
        {versions.length ? <span className="font-normal normal-case">· {versions.length}</span> : null}
      </h3>
      {versions.length ? (
        <ul className="space-y-1 text-sm">
          {versions.slice(0, 8).map((v) => (
            <li key={v.id}>
              <button type="button" className="w-full truncate text-start text-muted-foreground hover:text-foreground" onClick={() => setOpen(v)} title={fmtDate(v.savedAt, "d MMM yyyy HH:mm")}>
                {ago(v.savedAt)} · {v.body.length} {t("chars")}
                {v.label === "sync-conflict" ? (
                  <Badge variant="outline" className="ms-1.5">
                    {t("Sync conflict")}
                  </Badge>
                ) : null}
              </button>
            </li>
          ))}
          {versions.length > 8 ? <li className="text-xs text-muted-foreground">{t("… and {n} older", { n: versions.length - 8 })}</li> : null}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("Versions appear as you edit, at most one every five minutes.")}</p>
      )}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle dir="auto">{open.title}</DialogTitle>
                <DialogDescription>
                  {open.label === "sync-conflict"
                    ? t("Kept from a sync conflict {when}: the note changed on two devices and this text lost to the newer edit.", { when: fmtDate(open.savedAt, "d MMM yyyy HH:mm") })
                    : t("Saved {when}", { when: fmtDate(open.savedAt, "d MMM yyyy HH:mm") })}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border p-3">{open.body.trim() ? <MarkdownView body={open.body} className="text-sm" /> : <p className="text-sm text-muted-foreground">{t("Empty")}</p>}</div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(null)}>
                  {t("Close")}
                </Button>
                <Button onClick={() => void restore(open)}>
                  <RotateCcw /> {t("Restore this version")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
