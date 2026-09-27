"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Diamond } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { issueKey, type Issue, type Milestone, type Person, type Project } from "@/lib/types";
import { IssueKey, PersonAvatar, PriorityIcon, ProjectDot } from "@/components/ui-bits";
import { DueChip, StatusPicker } from "./pickers";
import { issueHref } from "./issue-utils";

// Dense list row. The title link is stretched over the whole row with a
// pseudo-element, so the row stays valid HTML while the inline status button
// and any trailing controls sit above it with their own z-index.

const MAX_LABELS = 3;

export function IssueRow({
  issue,
  project,
  milestone,
  assignee,
  selected,
  showStatus = true,
  showProject = false,
  trailing,
  onSelect,
  className,
}: {
  issue: Issue;
  project?: Project | null;
  milestone?: Milestone | null;
  assignee?: Person | null;
  selected?: boolean;
  showStatus?: boolean;
  showProject?: boolean;
  trailing?: React.ReactNode;
  onSelect?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const key = project ? issueKey(project, issue) : `#${issue.seq}`;
  const extra = issue.labels.length - MAX_LABELS;

  return (
    <div
      ref={ref}
      data-selected={selected || undefined}
      onMouseMove={onSelect}
      className={cn(
        "group relative flex h-9 items-center gap-2 px-2 text-sm hover:bg-muted/60 data-selected:bg-accent",
        className,
      )}
    >
      {showStatus ? (
        <span className="relative z-10 -ms-1">
          <StatusPicker issue={issue} />
        </span>
      ) : null}
      <PriorityIcon priority={issue.priority} />
      {showProject ? <ProjectDot project={project} /> : null}
      <IssueKey className="w-16 shrink-0 truncate">{key}</IssueKey>
      <Link
        href={issueHref(issue)}
        dir="auto"
        className={cn("min-w-0 flex-1 truncate after:absolute after:inset-0 after:content-['']", issue.status === "done" && "text-muted-foreground line-through decoration-muted-foreground/50", issue.status === "cancelled" && "text-muted-foreground")}
      >
        {issue.title}
      </Link>
      {milestone ? (
        <span className="hidden max-w-40 shrink-0 items-center gap-1 truncate text-xs text-muted-foreground md:inline-flex" title={milestone.title}>
          <Diamond className="size-3 shrink-0" />
          <span className="truncate" dir="auto">{milestone.title}</span>
        </span>
      ) : null}
      {issue.labels.slice(0, MAX_LABELS).map((l) => (
        <Badge key={l} variant="outline" className="hidden h-4 px-1.5 text-[10px] font-normal sm:inline-flex">
          <span dir="auto">{l}</span>
        </Badge>
      ))}
      {extra > 0 ? <span className="hidden text-[10px] text-muted-foreground sm:inline">+{extra}</span> : null}
      <DueChip issue={issue} />
      <PersonAvatar person={assignee} size="xs" />
      {trailing ? <span className="relative z-10 flex items-center">{trailing}</span> : null}
    </div>
  );
}
