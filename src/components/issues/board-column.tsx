"use client";
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import type { Issue, IssueStatus, Person, Project } from "@/lib/types";
import { StatusIcon, statusLabel } from "@/components/ui-bits";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  issues,
  project,
  personById,
  onOpen,
  onAdd,
  footer,
}: {
  status: IssueStatus;
  issues: Issue[];
  project?: Project | null;
  personById: Map<string, Person>;
  onOpen: (issue: Issue) => void;
  onAdd: (title: string) => Promise<void>;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { container: true, status } });
  const ids = issues.map((i) => i.id);
  return (
    <section className="flex min-w-0 flex-col rounded-lg border bg-muted/30" aria-label={statusLabel(status)}>
      <header className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <StatusIcon status={status} />
        {statusLabel(status)}
        <span className="tabular text-xs font-normal text-muted-foreground">{issues.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "thin-scroll flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors max-h-[calc(100dvh-19rem)]",
            isOver && "bg-accent/50",
          )}
        >
          {issues.map((issue) => (
            <BoardCard key={issue.id} issue={issue} project={project} assignee={personById.get(issue.assigneeId ?? "")} onOpen={onOpen} />
          ))}
          {issues.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-md border border-dashed py-6 text-xs text-muted-foreground">{t("Drop here")}</div>
          ) : null}
        </div>
      </SortableContext>
      {footer}
      <AddCard onAdd={onAdd} />
    </section>
  );
}

function AddCard({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next = title.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await onAdd(next);
      setTitle("");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="m-1 justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Plus /> {t("Add issue")}
      </Button>
    );
  }
  return (
    <div className="p-2 pt-0">
      <Input
        autoFocus
        value={title}
        dir="auto"
        placeholder={t("Issue title, Enter to add")}
        aria-label={t("New issue title")}
        className="h-8 bg-card text-sm"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
    </div>
  );
}
