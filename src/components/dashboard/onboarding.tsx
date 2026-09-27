"use client";
import { useState } from "react";
import { FolderPlus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { seedSample } from "@/lib/seed";
import { useUi } from "@/lib/ui-store";
import { EmptyState } from "@/components/ui-bits";

export function Onboarding() {
  const { openQuickCreate } = useUi();
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      await seedSample();
      toast.success("Sample workspace loaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load sample data");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EmptyState
      icon={<FolderPlus />}
      title="Your workspace is empty"
      description="Start with a project, or load a two-project sample with eight weeks of history so every chart has something to show."
      className="py-16"
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={load} disabled={busy}>
          <Sparkles className="size-4" />
          {busy ? "Loading…" : "Load sample data"}
        </Button>
        <Button variant="outline" onClick={() => openQuickCreate("project")}>
          New project
        </Button>
      </div>
      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <Kbd>⌘K</Kbd> search
        </span>
        <span>
          <Kbd>C</Kbd> new issue
        </span>
        <span>
          <Kbd>N</Kbd> new note
        </span>
        <span>
          <Kbd>T</Kbd> today&apos;s note
        </span>
      </p>
    </EmptyState>
  );
}
