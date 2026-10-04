"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtBytes, useT } from "@/lib/i18n";
import { useBackupStatus } from "@/lib/backup/service";
import { useSyncStatus } from "@/lib/sync/service";
import { assessStorage, refreshPersistence, requestPersistence, usePersistence } from "@/lib/persistence";

export function StorageSettings() {
  const t = useT();
  const p = usePersistence();
  const backup = useBackupStatus();
  const sync = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const a = assessStorage(p, { backupFolder: Boolean(backup.folder), syncSignedIn: sync.signedIn });

  // Usage grows with the workspace, so read it fresh whenever Settings opens.
  useEffect(() => {
    void refreshPersistence();
  }, []);

  async function ask() {
    setBusy(true);
    try {
      const granted = await requestPersistence();
      setRefused(!granted);
      if (granted) toast.success(t("The browser will keep Keel's data"));
    } finally {
      setBusy(false);
    }
  }

  if (a.state === "checking") return <Skeleton className="h-10" />;

  return (
    <div className="space-y-3">
      <p data-testid="storage-status" className="flex items-start gap-2 text-sm">
        {a.state === "persisted" ? (
          <>
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--viz-good)]" aria-hidden />
            <span>{t("Persistent. The browser will not clear Keel's data to free up space; only you can, by clearing this site's data.")}</span>
          </>
        ) : (
          <>
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--viz-warning)]" aria-hidden />
            <span>
              {a.state === "unsupported"
                ? t("Not persistent. This browser cannot promise to keep data here, so it may clear Keel's data to free up space.")
                : t("Not persistent. The browser may clear Keel's data to free up space.")}
            </span>
          </>
        )}
      </p>
      {p.usage !== null && p.quota ? (
        <p data-testid="storage-usage" className="text-xs text-muted-foreground tabular">
          {t("{used} used of {quota} available", { used: fmtBytes(p.usage), quota: fmtBytes(p.quota) })}
        </p>
      ) : null}
      {a.canAsk ? (
        <div className="space-y-2">
          <Button size="sm" variant="outline" onClick={() => void ask()} disabled={busy}>
            <ShieldCheck /> {busy ? t("Asking…") : t("Ask the browser to keep Keel's data")}
          </Button>
          {refused ? (
            <p className="text-xs text-muted-foreground">
              {t("The browser said no for now. Browsers tend to agree once Keel is installed as an app or used often; until then, backups are what keep the data safe.")}
            </p>
          ) : null}
        </div>
      ) : null}
      {a.atRisk ? (
        <div
          role="note"
          data-testid="storage-warning"
          className="flex gap-2 rounded-lg border border-[color-mix(in_oklab,var(--viz-warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--viz-warning)_10%,transparent)] p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--viz-warning)]" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">{t("Your data lives only in this browser")}</p>
            <p className="text-muted-foreground">
              {t("The browser may clear it to free up space, and Safari can clear it after a week without a visit.")}{" "}
              {t("Set up folder backups or sync so a cleared browser cannot take it with it.")}
            </p>
            <a href="#backups" className="inline-block underline underline-offset-4">
              {t("Set up backups")}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
