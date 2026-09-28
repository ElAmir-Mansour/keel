"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderSync, PackageOpen, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { importAll, type ExportFile } from "@/lib/export";
import { applyObsidianPlan } from "@/lib/import/apply";
import { planObsidian, type VaultFile } from "@/lib/import/obsidian";
import { fmtDate } from "@/lib/dates";

interface Status {
  dir: string | null;
  notes?: number;
  bundles?: { name: string; size: number; modifiedAt: number }[];
}

async function fetchStatus(): Promise<Status> {
  try {
    const res = await fetch("/api/local/status", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Status) : { dir: null };
  } catch {
    return { dir: null };
  }
}

/**
 * Only appears when Keel runs locally with KEEL_LOCAL_DIR set: imports the
 * Markdown notes and JSON bundles that live in that folder.
 */
export function LocalSettings() {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"skip" | "overwrite">("overwrite");
  const [busy, setBusy] = useState(false);

  const refresh = () => fetchStatus().then(setStatus);
  useEffect(() => {
    fetchStatus().then(setStatus);
  }, []);

  if (!status?.dir) return null;

  async function importNotes() {
    setBusy(true);
    try {
      const res = await fetch("/api/local/notes", { cache: "no-store" });
      const { files } = (await res.json()) as { files: VaultFile[] };
      const plan = planObsidian(files);
      const r = await applyObsidianPlan(plan, mode);
      toast.success(t("Imported {n} notes, updated {u}", { n: r.notes, u: r.updatedNotes }), { action: { label: t("Open notes"), onClick: () => router.push("/notes") } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importBundle(name: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/local/bundle?name=${encodeURIComponent(name)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(t("Bundle not found"));
      const file = (await res.json()) as ExportFile;
      await importAll(file, "merge");
      toast.success(t("Imported {name}", { name }), { action: { label: t("Open projects"), onClick: () => router.push("/projects") } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("Keel is running on this machine and watches a folder. Markdown files under vault/ become notes; JSON bundles under import/ merge projects, issues, decisions and risks. Point your automatic backups at backups/ and anything working in your terminal can read the workspace too.")}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="font-mono">
          {status.dir}
        </Badge>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw /> {t("Refresh")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void importNotes()} disabled={busy || !status.notes}>
          <FolderSync /> {t("Import {n} notes from vault/", { n: status.notes ?? 0 })}
        </Button>
        <Select value={mode} onValueChange={(v) => setMode(v as "skip" | "overwrite")}>
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="overwrite">{t("Overwrite notes with the same title")}</SelectItem>
            <SelectItem value="skip">{t("Keep existing notes with the same title")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {status.bundles?.length ? (
        <ul className="space-y-1.5 text-sm">
          {status.bundles.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-2">
              <PackageOpen className="size-3.5 text-muted-foreground" />
              <span className="font-mono">{b.name}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(b.size / 1024)} KB · {fmtDate(new Date(b.modifiedAt).toISOString(), "d MMM HH:mm")}
              </span>
              <Button size="xs" variant="outline" onClick={() => void importBundle(b.name)} disabled={busy}>
                {t("Import bundle")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("No bundles in import/ yet.")}</p>
      )}
    </div>
  );
}
