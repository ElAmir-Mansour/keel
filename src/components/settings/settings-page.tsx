"use client";
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Download, ExternalLink, Monitor, Moon, Sun, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { AiSettings } from "@/components/ai/ai-settings";
import { PageHeader } from "@/components/ui-bits";
import { useIsEmptyWorkspace } from "@/hooks/use-data";
import { useMounted } from "@/hooks/use-mounted";
import { todayYMD } from "@/lib/dates";
import { clearAll, countAll, downloadJSON, EXPORT_FORMAT, exportAll, importAll, type ExportFile } from "@/lib/export";
import { seedSample } from "@/lib/seed";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import pkg from "../../../package.json";

const THEMES = [
  { value: "system", label: "System", hint: "Follow the OS", Icon: Monitor },
  { value: "light", label: "Light", hint: "Always light", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark", Icon: Moon },
];

const COUNT_LABELS: [string, string][] = [
  ["projects", "Projects"],
  ["milestones", "Milestones"],
  ["issues", "Issues"],
  ["notes", "Notes"],
  ["decisions", "Decisions"],
  ["risks", "Risks"],
  ["people", "People"],
  ["updates", "Updates"],
];

const SHORTCUTS: { keys: string[]; then?: string[]; what: string }[] = [
  { keys: ["⌘", "K"], what: "Command palette: search and jump anywhere" },
  { keys: ["/"], what: "Search" },
  { keys: ["C"], what: "New issue" },
  { keys: ["N"], what: "New note" },
  { keys: ["T"], what: "Open today's daily note" },
  { keys: ["A"], what: "Ask the AI assistant" },
  { keys: ["G"], then: ["H"], what: "Go home" },
  { keys: ["G"], then: ["I"], what: "Go to inbox" },
  { keys: ["G"], then: ["P"], what: "Go to projects" },
  { keys: ["G"], then: ["N"], what: "Go to notes" },
  { keys: ["G"], then: ["D"], what: "Go to decisions" },
  { keys: ["G"], then: ["R"], what: "Go to risks" },
  { keys: ["G"], then: ["G"], what: "Go to the graph" },
  { keys: ["G"], then: ["T"], what: "Go to people" },
  { keys: ["J", "K"], what: "Move through a list" },
  { keys: ["↵"], what: "Open the selected item" },
  { keys: ["Esc"], what: "Close a dialog or leave a field" },
];

function SettingsSection({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid gap-4 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/** /settings */
export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const counts = useLiveQuery(() => countAll(), [], null);
  const empty = useIsEmptyWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: ExportFile; counts: Record<string, number> } | null>(null);
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    const data = await exportAll();
    downloadJSON(data, `keel-export-${todayYMD()}.json`);
    toast.success("Export downloaded");
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as ExportFile;
      if (data?.format !== EXPORT_FORMAT || typeof data.tables !== "object") throw new Error("format");
      const c: Record<string, number> = {};
      for (const [k, v] of Object.entries(data.tables)) c[k] = Array.isArray(v) ? v.length : 0;
      setMode("replace");
      setPending({ name: file.name, data, counts: c });
    } catch {
      toast.error("Not a Keel export file");
    }
  }

  async function onImport() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await importAll(pending.data, mode);
      toast.success(mode === "replace" ? "Workspace replaced from export" : "Export merged into workspace");
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSeed() {
    if (busy) return;
    setBusy(true);
    try {
      await seedSample();
      toast.success("Sample workspace loaded");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Appearance, your data, shortcuts and the AI assistant." />

      <SettingsSection id="appearance" title="Appearance" description="Theme is remembered in this browser.">
        {mounted ? (
          <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-3">
            {THEMES.map((t) => (
              <label key={t.value} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/60 has-[:checked]:border-foreground/50 has-[:checked]:bg-accent")}>
                <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => setTheme(t.value)} className="sr-only" />
                <t.Icon className="size-4 text-muted-foreground" />
                <span className="grid">
                  <span className="font-medium">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <Skeleton className="h-16" />
        )}
      </SettingsSection>

      <SettingsSection id="data" title="Data" description="Everything lives in this browser's IndexedDB. Export regularly; there is no server copy.">
        {counts ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {COUNT_LABELS.map(([k, label]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b py-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular">{counts[k] ?? 0}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Skeleton className="h-16" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onExport()}>
            <Download /> Export JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload /> Import JSON
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onPickFile(e)} aria-label="Import file" />
          <Button size="sm" variant="outline" onClick={() => void onSeed()} disabled={!empty || busy}>
            Load sample data
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmClear(true)}>
            Clear all data
          </Button>
        </div>
        {counts && !empty ? <p className="text-xs text-muted-foreground">Sample data can only be loaded into an empty workspace. Export, then clear all data, to try it.</p> : null}
      </SettingsSection>

      <SettingsSection id="shortcuts" title="Keyboard shortcuts" description="Single keys work whenever you are not typing in a field.">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableBody>
              {SHORTCUTS.map((s) => (
                <TableRow key={s.what}>
                  <TableCell className="w-40">
                    <span className="inline-flex items-center gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                      {s.then ? (
                        <>
                          <span className="text-xs text-muted-foreground">then</span>
                          {s.then.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{s.what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>

      <SettingsSection id="ai" title="AI assistant" description="Optional. Nothing is sent anywhere until you ask it something.">
        <AiSettings />
      </SettingsSection>

      <SettingsSection id="about" title="About">
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Keel</span> <span className="font-mono text-xs text-muted-foreground">v{pkg.version}</span>
          </p>
          <p className="text-muted-foreground">Local-first: your data never leaves this browser unless you export it or use the AI assistant.</p>
          <p>
            <a href="https://github.com/ElAmir-Mansour/keel" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-4">
              Source on GitHub <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      </SettingsSection>

      <Dialog open={pending !== null} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {pending?.name}</DialogTitle>
            <DialogDescription>
              {pending ? Object.entries(pending.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ") || "An empty export" : null}
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Import mode" className="grid gap-2">
            {(
              [
                { value: "replace", label: "Replace everything", hint: "Clears the current workspace first. What you have now is gone unless you exported it." },
                { value: "merge", label: "Merge", hint: "Adds the records; anything with the same id is overwritten, everything else is kept." },
              ] as const
            ).map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-muted/60 has-[:checked]:border-foreground/50 has-[:checked]:bg-accent">
                <input type="radio" name="import-mode" value={o.value} checked={mode === o.value} onChange={() => setMode(o.value)} className="mt-1" />
                <span className="grid">
                  <span className="font-medium">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant={mode === "replace" ? "destructive" : "default"} onClick={() => void onImport()} disabled={busy}>
              {mode === "replace" ? "Replace workspace" : "Merge into workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all data?"
        description="Every project, issue, note, decision, risk, person and setting in this browser is deleted. There is no undo; export first if in doubt."
        confirmLabel="Delete everything"
        destructive
        typeToConfirm="DELETE"
        onConfirm={async () => {
          await clearAll();
          toast.success("Workspace cleared");
        }}
      />
    </>
  );
}
