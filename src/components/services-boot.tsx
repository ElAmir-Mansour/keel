"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { boot as bootSync, onSyncConflicts, useSyncStatus } from "@/lib/sync/service";
import { boot as bootBackup, shouldNudge } from "@/lib/backup/service";
import { bootDigest, maybeRunDigest } from "@/lib/ai/digest";
import { bootSemantic } from "@/lib/ai/semantic";
import { bootGithub } from "@/lib/github/service";
import { rolloverAll } from "@/lib/cycles";
import { bootPwa } from "@/lib/pwa";
import { bootPersistence } from "@/lib/persistence";

/** Starts the background services once per page load and nudges about data safety. */
export function ServicesBoot() {
  const router = useRouter();
  const sync = useSyncStatus();
  const hasData = useLiveQuery(() => db.notes.count().then((n) => n > 0), [], false);

  useEffect(() => {
    void bootSync();
    void bootBackup();
    bootDigest();
    bootSemantic();
    bootGithub();
    bootPwa();
    bootPersistence();
    void rolloverAll().then((moved) => {
      if (moved) toast(`${moved} unfinished issue${moved === 1 ? "" : "s"} rolled into the new cycle`);
    });
    const digestTimer = setTimeout(() => {
      void maybeRunDigest().then((n) => {
        if (n) toast.success("This week's digest is ready", { action: { label: "Open", onClick: () => router.push(`/notes/${n.id}`) }, duration: 15000 });
      });
    }, 10000);
    return () => clearTimeout(digestTimer);
  }, [router]);

  // One toast per sync that kept a losing copy; the review list is in settings.
  useEffect(
    () =>
      onSyncConflicts((n) => {
        toast(n === 1 ? t("1 item had a sync conflict") : t("{n} items had sync conflicts", { n }), {
          description: t("It changed on two devices. The newer edit won and the other copy is kept."),
          action: { label: t("Review"), onClick: () => router.push("/settings#conflicts") },
          duration: 12000,
        });
      }),
    [router],
  );

  useEffect(() => {
    if (!hasData) return;
    const timer = setTimeout(() => {
      if (shouldNudge(sync.signedIn)) {
        // Settings → Storage repeats this wording; this toast stays the only nudge.
        toast(t("Your data lives only in this browser"), {
          description: t("Set up folder backups or sync so a cleared browser cannot take it with it."),
          action: { label: t("Settings"), onClick: () => router.push("/settings#backups") },
          duration: 12000,
        });
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [hasData, sync.signedIn, router]);

  return null;
}
