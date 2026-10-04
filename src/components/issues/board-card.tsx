"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { issueKey, type Issue, type Person, type Project } from "@/lib/types";
import { IssueKey, PersonAvatar, PriorityIcon } from "@/components/ui-bits";
import { DueChip } from "./pickers";
import { PointsChip } from "@/components/points/issue-points";

// The card body is shared by the sortable card and the drag overlay so the
// thing under the pointer looks exactly like the thing being moved.

export function CardBody({
  issue,
  project,
  assignee,
  overlay,
  className,
}: {
  issue: Issue;
  project?: Project | null;
  assignee?: Person | null;
  overlay?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card p-2.5 text-sm shadow-xs",
        overlay ? "cursor-grabbing rotate-1 shadow-lg ring-1 ring-foreground/10" : "hover:border-foreground/30",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <IssueKey>{project ? issueKey(project, issue) : `#${issue.seq}`}</IssueKey>
        <DueChip issue={issue} className="ms-auto" />
      </div>
      <div className="mt-1 line-clamp-3 leading-snug" dir="auto">
        {issue.title}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <PriorityIcon priority={issue.priority} />
        {issue.labels.slice(0, 2).map((l) => (
          <Badge key={l} variant="outline" className="h-4 max-w-24 px-1.5 text-[10px] font-normal">
            <span className="truncate" dir="auto">{l}</span>
          </Badge>
        ))}
        {issue.labels.length > 2 ? <span className="text-[10px] text-muted-foreground">+{issue.labels.length - 2}</span> : null}
        <PointsChip issue={issue} className="ms-auto" />
        <PersonAvatar person={assignee} size="xs" className={issue.estimate === undefined && issue.lockedPoints === undefined ? "ms-auto" : undefined} />
      </div>
    </div>
  );
}

export function BoardCard({
  issue,
  project,
  assignee,
  onOpen,
}: {
  issue: Issue;
  project?: Project | null;
  assignee?: Person | null;
  onOpen: (issue: Issue) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { status: issue.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(issue)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        // Space lifts the card (see the keyboard sensor); Enter opens it.
        if (e.key === "Enter" && !e.defaultPrevented && !isDragging) {
          e.preventDefault();
          onOpen(issue);
        }
      }}
      className={cn("cursor-grab touch-manipulation rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50", isDragging && "opacity-40")}
      aria-label={`${project ? issueKey(project, issue) : `#${issue.seq}`}: ${issue.title}`}
    >
      <CardBody issue={issue} project={project} assignee={assignee} />
    </div>
  );
}
