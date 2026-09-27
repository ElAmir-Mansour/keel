"use client";
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Download, ExternalLink, Monitor, Moon, Sun, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { setLang, useLang, useT, type Lang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { AiSettings } from "@/components/ai/ai-settings";
import { SyncSettings } from "@/components/settings/sync-settings";
import { ImportSettings } from "@/components/settings/import-settings";
import { DigestSettings } from "@/components/settings/digest-settings";
import { SemanticSettings } from "@/components/settings/semantic-settings";
import { InstallSettings } from "@/components/settings/install-settings";
import { GithubSettings } from "@/components/settings/github-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { PageHeader } from "@/components/ui-bits";
import { useIsEmptyWorkspace } from "@/hooks/use-data";
import { useMounted } from "@/hooks/use-mounted";
import { todayYMD } from "@/lib/dates";
import { clearAll, countAll, downloadJSON, EXPORT_FORMAT, exportAll, importAll, type ExportFile } from "@/lib/export";
import { seedSample } from "@/lib/seed";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import pkg from "../../../package.json";

// Labels stay English here and are translated at render time with t().
const THEMES = [
  { value: "system", label: "System", hint: "Follow the OS", Icon: Monitor },
  { value: "light", label: "Light", hint: "Always light", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark", Icon: Moon },
];

// The language names are shown as-is in their own script, never translated.
const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
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
  const t = useT();
  const lang = useLang();
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
    toast.success(t("Export downloaded"));
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
      toast.error(t("Not a Keel export file"));
    }
  }

  async function onImport() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await importAll(pending.data, mode);
      toast.success(mode === "replace" ? t("Workspace replaced from export") : t("Export merged into workspace"));
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Import failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onSeed() {
    if (busy) return;
    setBusy(true);
    try {
      await seedSample();
      toast.success(t("Sample workspace loaded"));
    } finally {
      setBusy(false);
    }
  }

  /** "12 issues, 3 notes" for the import preview, with the table names translated. */
  function describeCounts(c: Record<string, number>) {
    return Object.entries(c)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${t(COUNT_LABELS.find(([key]) => key === k)?.[1] ?? k)}`)
      .join(", ");
  }

  return (
    <>
      <PageHeader title={t("Settings")} description={t("Appearance, your data, backups, sync, shortcuts and the AI assistant.")} />

      <SettingsSection id="appearance" title={t("Appearance")} description={t("Theme is remembered in this browser.")}>
        {mounted ? (
          <div role="radiogroup" aria-label={t("Theme")} className="grid gap-2 sm:grid-cols-3">
            {THEMES.map((th) => (
              <label key={th.value} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/60 has-[:checked]:border-foreground/50 has-[:checked]:bg-accent")}>
                <input type="radio" name="theme" value={th.value} checked={theme === th.value} onChange={() => setTheme(th.value)} className="sr-only" />
                <th.Icon className="size-4 text-muted-foreground" />
                <span className="grid">
                  <span className="font-medium">{t(th.label)}</span>
                  <span className="text-xs text-muted-foreground">{t(th.hint)}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <Skeleton className="h-16" />
        )}
        <div className="space-y-2">
          <p className="text-xs font-medium">{t("Language")}</p>
          <div role="radiogroup" aria-label={t("Language")} className="inline-grid grid-cols-2 gap-1 rounded-lg border p-1">
            {LANGS.map((l) => (
              <label
                key={l.value}
                className="cursor-pointer rounded-md px-4 py-1.5 text-center text-sm hover:bg-muted/60 has-[:checked]:bg-accent has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
              >
                <input type="radio" name="lang" value={l.value} checked={lang === l.value} onChange={() => setLang(l.value)} className="sr-only" />
                <span lang={l.value} dir={l.value === "ar" ? "rtl" : "ltr"}>
                  {l.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection id="data" title={t("Data")} description={t("Everything lives in this browser's IndexedDB. Export regularly; there is no server copy.")}>
        {counts ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {COUNT_LABELS.map(([k, label]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b py-1">
                <dt className="text-muted-foreground">{t(label)}</dt>
                <dd className="font-medium tabular">{counts[k] ?? 0}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Skeleton className="h-16" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onExport()}>
            <Download /> {t("Export JSON")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload /> {t("Import JSON")}
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onPickFile(e)} aria-label={t("Import file")} />
          <Button size="sm" variant="outline" onClick={() => void onSeed()} disabled={!empty || busy}>
            {t("Load sample data")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmClear(true)}>
            {t("Clear all data")}
          </Button>
        </div>
        {counts && !empty ? <p className="text-xs text-muted-foreground">{t("Sample data can only be loaded into an empty workspace. Export, then clear all data, to try it.")}</p> : null}
      </SettingsSection>

      <SettingsSection id="import" title={t("Import")} description={t("Bring in an Obsidian vault, or the issues you track in Linear or Jira. You see a preview before anything is written.")}>
        <ImportSettings />
      </SettingsSection>

      <SettingsSection id="backups" title={t("Automatic backups")} description={t("A JSON copy of everything, written to a folder on a schedule while Keel is open.")}>
        <BackupSettings />
      </SettingsSection>

      <SettingsSection id="sync" title={t("Sync across devices")} description={t("Optional. Your own Supabase project holds an encrypted-in-transit copy; nothing is shared with anyone else.")}>
        <SyncSettings />
      </SettingsSection>

      <SettingsSection id="github" title={t("GitHub")} description={t("Link pull requests and commits to issues, and let a merged PR close the issue.")}>
        <GithubSettings />
      </SettingsSection>

      <SettingsSection id="shortcuts" title={t("Keyboard shortcuts")} description={t("Single keys work whenever you are not typing in a field.")}>
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
                          <span className="text-xs text-muted-foreground">{t("then")}</span>
                          {s.then.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{t(s.what)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>

      <SettingsSection id="ai" title={t("AI assistant")} description={t("Optional. Nothing is sent anywhere until you ask it something.")}>
        <AiSettings />
      </SettingsSection>

      <SettingsSection id="digest" title={t("Weekly digest")} description={t("A note per week across all active projects, written on the day you choose.")}>
        <DigestSettings />
      </SettingsSection>

      <SettingsSection id="semantic" title={t("Semantic search")} description={t("Optional, on-device. Search and the assistant find notes by meaning.")}>
        <SemanticSettings />
      </SettingsSection>

      <SettingsSection id="install" title={t("Install as an app")} description={t("Your own window, an icon, and it opens offline.")}>
        <InstallSettings />
      </SettingsSection>

      <SettingsSection id="about" title={t("About")}>
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Keel</span> <span className="font-mono text-xs text-muted-foreground">v{pkg.version}</span>
          </p>
          <p className="text-muted-foreground">{t("Local-first: your data never leaves this browser unless you export it or use the AI assistant.")}</p>
          <p>
            <a href="https://github.com/ElAmir-Mansour/keel" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-4">
              {t("Source on GitHub")} <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      </SettingsSection>

      <Dialog open={pending !== null} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Import {name}", { name: pending?.name ?? "" })}</DialogTitle>
            <DialogDescription>{pending ? describeCounts(pending.counts) || t("An empty export") : null}</DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label={t("Import mode")} className="grid gap-2">
            {(
              [
                { value: "replace", label: "Replace everything", hint: "Clears the current workspace first. What you have now is gone unless you exported it." },
                { value: "merge", label: "Merge", hint: "Adds the records; anything with the same id is overwritten, everything else is kept." },
              ] as const
            ).map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-muted/60 has-[:checked]:border-foreground/50 has-[:checked]:bg-accent">
                <input type="radio" name="import-mode" value={o.value} checked={mode === o.value} onChange={() => setMode(o.value)} className="mt-1" />
                <span className="grid">
                  <span className="font-medium">{t(o.label)}</span>
                  <span className="text-xs text-muted-foreground">{t(o.hint)}</span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("Cancel")}
            </Button>
            <Button variant={mode === "replace" ? "destructive" : "default"} onClick={() => void onImport()} disabled={busy}>
              {mode === "replace" ? t("Replace workspace") : t("Merge into workspace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("Clear all data?")}
        description={t("Every project, issue, note, decision, risk, person and setting in this browser is deleted. There is no undo; export first if in doubt.")}
        confirmLabel={t("Delete everything")}
        destructive
        typeToConfirm="DELETE"
        onConfirm={async () => {
          await clearAll();
          toast.success(t("Workspace cleared"));
        }}
      />
    </>
  );
}
