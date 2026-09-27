"use client";
import { useState } from "react";
import { toast } from "sonner";
import { FolderOpen, HardDriveDownload, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ago } from "@/lib/dates";
import { backupNow, chooseFolder, forgetFolder, requestPermission, setSchedule, useBackupStatus } from "@/lib/backup/service";

const INTERVALS = [
  { value: 1, label: "Every hour" },
  { value: 6, label: "Every 6 hours" },
  { value: 24, label: "Daily" },
  { value: 168, label: "Weekly" },
];

export function BackupSettings() {
  const s = useBackupStatus();
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(typeof r === "string" ? `${label}: ${r}` : label);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!s.supported) {
    return (
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2 text-muted-foreground">
          <ShieldAlert className="size-4" /> This browser cannot write to a folder on its own. Use <strong>Export JSON</strong> above regularly, or open Keel in Chrome or Edge to enable automatic folder backups.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick a folder once (a synced folder such as iCloud Drive, Dropbox or OneDrive is ideal). While Keel is open it writes a full JSON backup on the schedule below and keeps the newest copies.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run("Backup folder set", () => chooseFolder())} disabled={busy}>
          <FolderOpen /> {s.folder ? "Change folder" : "Choose folder"}
        </Button>
        {s.folder ? (
          <>
            <Badge variant="secondary">{s.folder}</Badge>
            {s.permission === "granted" ? null : (
              <Button size="sm" variant="outline" onClick={() => run("Access granted", () => requestPermission())}>
                Grant access again
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => run("Backup written", () => backupNow())} disabled={busy || s.running}>
              <HardDriveDownload /> Back up now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run("Folder forgotten", () => forgetFolder())}>
              Forget folder
            </Button>
          </>
        ) : null}
      </div>
      {s.folder ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Select value={String(s.intervalHours)} onValueChange={(v) => void setSchedule(Number(v), s.keep)}>
            <SelectTrigger size="sm" className="w-auto" aria-label="Backup interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((i) => (
                <SelectItem key={i.value} value={String(i.value)}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(s.keep)} onValueChange={(v) => void setSchedule(s.intervalHours, Number(v))}>
            <SelectTrigger size="sm" className="w-auto" aria-label="Copies to keep">
              <span className="text-muted-foreground">Keep</span> <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[3, 7, 14, 30].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} copies
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{s.lastAt ? `Last backup ${ago(s.lastAt)}` : "No backup yet"}</span>
          {s.lastError ? <span className="text-xs text-[var(--viz-critical)]">{s.lastError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
