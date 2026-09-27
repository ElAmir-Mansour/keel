"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { boot as bootSync, useSyncStatus } from "@/lib/sync/service";
import { boot as bootBackup, shouldNudge } from "@/lib/backup/service";
import { bootDigest, maybeRunDigest } from "@/lib/ai/digest";
import { bootSemantic } from "@/lib/ai/semantic";

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
    const t = setTimeout(() => {
      void maybeRunDigest().then((n) => {
        if (n) toast.success("This week's digest is ready", { action: { label: "Open", onClick: () => router.push(`/notes/${n.id}`) }, duration: 15000 });
      });
    }, 10000);
    return () => clearTimeout(t);
  }, [router]);

  useEffect(() => {
    if (!hasData) return;
    const t = setTimeout(() => {
      if (shouldNudge(sync.signedIn)) {
        toast("Your data lives only in this browser", {
          description: "Set up folder backups or sync so a cleared browser cannot take it with it.",
          action: { label: "Settings", onClick: () => router.push("/settings#backups") },
          duration: 12000,
        });
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [hasData, sync.signedIn, router]);

  return null;
}
