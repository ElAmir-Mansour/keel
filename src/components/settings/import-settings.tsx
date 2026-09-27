"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, FolderOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { csvRecords } from "@/lib/import/csv";
import type { ImportPlan } from "@/lib/import/common";
import { isLinearCSV, planLinear } from "@/lib/import/linear";
import { isJiraCSV, planJira } from "@/lib/import/jira";
import { planObsidian, type ObsidianPlan, type VaultFile } from "@/lib/import/obsidian";
import { applyIssuePlan, applyObsidianPlan } from "@/lib/import/apply";

// Three sources, one shape: read → plan (preview) → apply. Nothing is
// written until the person confirms the preview.

type DirHandle = { name: string; entries(): AsyncIterable<[string, FileSystemHandle & { kind: string; getFile?: () => Promise<File> }]> };
type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: "read" }) => Promise<DirHandle> };

async function readDirectory(dir: DirHandle, prefix = ""): Promise<VaultFile[]> {
  const out: VaultFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      if (name.startsWith(".")) continue;
      out.push(...(await readDirectory(handle as unknown as DirHandle, path)));
    } else if (handle.kind === "file" && name.toLowerCase().endsWith(".md") && handle.getFile) {
      const f = await handle.getFile();
      out.push({ path, text: await f.text(), modifiedAt: f.lastModified });
    }
  }
  return out;
}

async function readFileList(files: FileList): Promise<VaultFile[]> {
  const out: VaultFile[] = [];
  for (const f of Array.from(files)) {
    if (!f.name.toLowerCase().endsWith(".md")) continue;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const path = rel.split("/").slice(1).join("/") || rel; // drop the picked root folder
    out.push({ path, text: await f.text(), modifiedAt: f.lastModified });
  }
  return out;
}

export function ImportSettings() {
  const router = useRouter();
  const [vault, setVault] = useState<ObsidianPlan | null>(null);
  const [vaultMode, setVaultMode] = useState<"skip" | "overwrite">("skip");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const supportsPicker = typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";

  async function pickVault() {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) return dirInput.current?.click();
    try {
      setBusy(true);
      const dir = await picker({ mode: "read" });
      setVault(planObsidian(await readDirectory(dir)));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onVaultFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setBusy(true);
    try {
      setVault(planObsidian(await readFileList(e.target.files)));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const { headers } = csvRecords(text);
    const p = isJiraCSV(headers) ? planJira(text) : isLinearCSV(headers) ? planLinear(text) : planLinear(text);
    if (!isJiraCSV(headers) && !isLinearCSV(headers)) p.warnings.unshift("Could not recognise the export; mapped it as Linear-style columns. Check the preview.");
    setPlan(p);
    e.target.value = "";
  }

  async function applyVault() {
    if (!vault) return;
    setBusy(true);
    try {
      const r = await applyObsidianPlan(vault, vaultMode);
      toast.success(`Imported ${r.notes} notes${r.updatedNotes ? `, updated ${r.updatedNotes}` : ""}`, { action: { label: "Open notes", onClick: () => router.push("/notes") } });
      setVault(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyIssues() {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await applyIssuePlan(plan);
      toast.success(`Imported ${r.issues} issues into ${r.projects ? `${r.projects} new project${r.projects === 1 ? "" : "s"}` : "existing projects"}${r.people ? `, ${r.people} people` : ""}`, {
        action: { label: "Open projects", onClick: () => router.push("/projects") },
      });
      setPlan(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const projectsInPlan = plan ? [...new Set(plan.issues.map((i) => i.projectName))] : [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={pickVault} disabled={busy}>
            <FolderOpen /> Obsidian vault or folder of .md files
          </Button>
          <input ref={dirInput} type="file" multiple className="hidden" onChange={onVaultFiles} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          {!supportsPicker ? <span className="text-xs text-muted-foreground">Your browser will ask for a folder to upload.</span> : null}
        </div>
        {vault ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{vault.notes.length} notes</Badge>
              {vault.skipped.length ? <span className="text-xs text-muted-foreground">{vault.skipped.length} non-markdown files skipped</span> : null}
              <Select value={vaultMode} onValueChange={(v) => setVaultMode(v as "skip" | "overwrite")}>
                <SelectTrigger size="sm" className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Keep existing notes with the same title</SelectItem>
                  <SelectItem value="overwrite">Overwrite notes with the same title</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={applyVault} disabled={busy || !vault.notes.length}>
                <Upload /> Import notes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setVault(null)}>
                Cancel
              </Button>
            </div>
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">
              {vault.notes.slice(0, 12).map((n) => (
                <li key={n.folder + n.title} className="truncate">
                  {n.folder}/{n.title} · {n.kind}
                  {n.tags.length ? ` · #${n.tags.join(" #")}` : ""}
                </li>
              ))}
              {vault.notes.length > 12 ? <li>… and {vault.notes.length - 12} more</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => csvInput.current?.click()} disabled={busy}>
            <FileSpreadsheet /> Linear or Jira CSV export
          </Button>
          <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsv} />
          <span className="text-xs text-muted-foreground">Linear: team → Export CSV. Jira: Issues → Export → CSV (all fields).</span>
        </div>
        {plan ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{plan.source === "jira" ? "Jira" : "Linear"}</Badge>
              <Badge variant="secondary">{plan.issues.length} issues</Badge>
              <span className="text-xs text-muted-foreground">
                into {projectsInPlan.length} project{projectsInPlan.length === 1 ? "" : "s"}: {projectsInPlan.slice(0, 4).join(", ")}
                {projectsInPlan.length > 4 ? "…" : ""}
              </span>
              <Button size="sm" onClick={applyIssues} disabled={busy || !plan.issues.length}>
                <Upload /> Import issues
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
                Cancel
              </Button>
            </div>
            {plan.warnings.map((w) => (
              <p key={w} className="mt-2 text-xs text-[var(--viz-serious)]">
                {w}
              </p>
            ))}
            {Object.keys(plan.unmappedStatuses).length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Statuses that will land in Backlog: {Object.entries(plan.unmappedStatuses).map(([k, n]) => `${k} (${n})`).join(", ")}
              </p>
            ) : null}
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">
              {plan.issues.slice(0, 12).map((i) => (
                <li key={(i.sourceKey ?? "") + i.title} className="truncate">
                  {i.sourceKey ?? "•"} {i.title} · {i.status}
                  {i.assignee ? ` · ${i.assignee}` : ""}
                </li>
              ))}
              {plan.issues.length > 12 ? <li>… and {plan.issues.length - 12} more</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
