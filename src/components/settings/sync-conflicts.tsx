"use client";
import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownView } from "@/components/markdown";
import { db } from "@/lib/db";
import { ago, fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { dismissConflict, restoreConflict } from "@/lib/repo";
import { sameContent } from "@/lib/sync/engine";
import type { SyncConflict } from "@/lib/types";

// Labels stay English here and are translated at render time with t().
const KINDS: Record<string, string> = {
  projects: "Project",
  milestones: "Milestone",
  issues: "Issue",
  issueEvents: "Issue event",
  decisions: "Decision",
  notes: "Note",
  risks: "Risk",
  people: "Person",
  updates: "Update",
  cycles: "Cycle",
  views: "Saved view",
  noteVersions: "Note version",
  timelines: "Timeline",
  kpis: "KPI",
  pointEntries: "Points entry",
  pointRules: "Points rules",
};

/** Bookkeeping fields left out of the comparison. */
const HIDDEN = new Set(["id", "createdAt", "updatedAt"]);

/** Where a conflicting record opens, from the kept copy's own fields. */
function hrefOf(c: SyncConflict): string | null {
  const d = c.data ?? {};
  switch (c.tbl) {
    case "notes":
      return `/notes/${c.recordId}`;
    case "decisions":
      return `/decisions/${c.recordId}`;
    case "projects":
      return `/projects/${c.recordId}`;
    case "people":
      return `/team/${c.recordId}`;
    case "timelines":
      return `/timelines/${c.recordId}`;
    case "issues":
      return d.projectId && d.seq ? `/projects/${d.projectId}/issues/${d.seq}` : null;
    case "risks":
      return d.projectId ? `/projects/${d.projectId}/risks` : null;
    default:
      return null;
  }
}

function show(v: unknown) {
  if (v === undefined || v === null || v === "") return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Copies kept when a record changed on two devices between syncs: compare, restore or dismiss. */
export function SyncConflicts() {
  const t = useT();
  const conflicts = useLiveQuery(() => db.syncConflicts.orderBy("createdAt").reverse().toArray(), [], [] as SyncConflict[]);
  const [open, setOpen] = useState<SyncConflict | null>(null);

  async function dismiss(c: SyncConflict) {
    await dismissConflict(c.id);
    setOpen(null);
    toast.success(t("Conflict dismissed"));
  }

  async function restore(c: SyncConflict) {
    await restoreConflict(c.id);
    setOpen(null);
    toast.success(t("Version restored"));
  }

  return (
    <div id="conflicts" className="scroll-mt-20 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("Sync conflicts")}
        {conflicts.length ? <span className="font-normal normal-case"> · {conflicts.length}</span> : null}
      </h3>
      {conflicts.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {conflicts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Badge variant="secondary">{t(KINDS[c.tbl] ?? c.tbl)}</Badge>
              <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
                {c.title || t("Untitled")}
              </span>
              <span className="text-xs text-muted-foreground" title={fmtDate(c.createdAt, "d MMM yyyy HH:mm")}>
                {ago(c.createdAt)}
              </span>
              <Button size="xs" variant="outline" onClick={() => setOpen(c)}>
                {t("Compare")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => void dismiss(c)}>
                {t("Dismiss")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("None. When a record changes on two devices between syncs, the newer edit wins and the other copy is kept here.")}</p>
      )}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {open ? <ConflictDetail conflict={open} onRestore={() => void restore(open)} onDismiss={() => void dismiss(open)} onClose={() => setOpen(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConflictDetail({ conflict: c, onRestore, onDismiss, onClose }: { conflict: SyncConflict; onRestore: () => void; onDismiss: () => void; onClose: () => void }) {
  const t = useT();
  // undefined while loading, null when the record is gone.
  const current = useLiveQuery(async () => ((await db.table(c.tbl).get(c.recordId)) as Record<string, unknown> | undefined) ?? null, [c.tbl, c.recordId]);
  const version = useLiveQuery(async () => (c.versionId ? ((await db.noteVersions.get(c.versionId)) ?? null) : null), [c.versionId]);
  const href = current ? hrefOf(c) : null;
  const kept = c.data ?? {};
  const fields = [...new Set([...Object.keys(kept), ...Object.keys(current ?? {})])]
    .filter((k) => !HIDDEN.has(k))
    .filter((k) => (current ? !sameContent({ v: kept[k] }, { v: current[k] }) : kept[k] !== undefined))
    .sort();

  let description: string;
  if (c.versionId) description = t("This text lost to a newer edit of the same note. It is also in the note's history.");
  else if (current === null) description = t("The record was deleted on one device while this copy was edited on another. Restoring brings it back.");
  else description = t("This copy lost to a newer edit. Fields that differ from the current record:");

  return (
    <>
      <DialogHeader>
        <DialogTitle dir="auto">
          {t(KINDS[c.tbl] ?? c.tbl)} · {c.title || t("Untitled")}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <p className="text-xs text-muted-foreground">{t("Kept {when}", { when: fmtDate(c.createdAt, "d MMM yyyy HH:mm") })}</p>
      </DialogHeader>
      {c.versionId ? (
        version ? (
          <div className="rounded-md border p-3">
            {version.title !== c.title ? (
              <p className="mb-2 font-medium" dir="auto">
                {version.title}
              </p>
            ) : null}
            {version.body.trim() ? <MarkdownView body={version.body} className="text-sm" /> : <p className="text-sm text-muted-foreground">{t("Empty")}</p>}
          </div>
        ) : version === null ? (
          <p className="text-sm text-muted-foreground">{t("This version is no longer in the note's history.")}</p>
        ) : null
      ) : fields.length ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-start font-medium">{t("Field")}</th>
                <th className="px-3 py-1.5 text-start font-medium">{t("Kept copy")}</th>
                {current ? <th className="px-3 py-1.5 text-start font-medium">{t("Current")}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {fields.map((k) => (
                <tr key={k}>
                  {/* Field names are the stored keys, shown as-is like code. */}
                  <td className="px-3 py-1.5 font-mono text-xs" dir="ltr">
                    {k}
                  </td>
                  <td className="max-w-64 whitespace-pre-wrap break-words px-3 py-1.5" dir="auto">
                    {show(kept[k])}
                  </td>
                  {current ? (
                    <td className="max-w-64 whitespace-pre-wrap break-words px-3 py-1.5 text-muted-foreground" dir="auto">
                      {show(current[k])}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : current ? (
        <p className="text-sm text-muted-foreground">{t("The current record now matches this copy.")}</p>
      ) : null}
      <DialogFooter>
        {href ? (
          <Button variant="ghost" asChild>
            <Link href={href} onClick={onClose}>
              {t("Open")}
            </Link>
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
        <Button onClick={onRestore} disabled={Boolean(c.versionId) && !version}>
          <RotateCcw /> {t("Restore this version")}
        </Button>
      </DialogFooter>
    </>
  );
}
