"use client";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Eye,
  Inbox,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  HEALTHS,
  ISSUE_STATUSES,
  NOTE_KINDS,
  PRIORITIES,
  type Health,
  type IssueStatus,
  type NoteKind,
  type Person,
  type Priority,
  type Project,
} from "@/lib/types";

// Small presentational atoms shared by every page. Status and health always
// pair an icon with a label so colour never carries meaning alone.

export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "triage":
      return <Inbox className={cn(c, "text-muted-foreground")} />;
    case "backlog":
      return <CircleDashed className={cn(c, "text-muted-foreground")} />;
    case "todo":
      return <Circle className={cn(c, "text-foreground/70")} />;
    case "in_progress":
      return <CircleDot className={cn(c, "text-[var(--viz-series-4)]")} />;
    case "in_review":
      return <Eye className={cn(c, "text-[var(--viz-series-7)]")} />;
    case "done":
      return <CheckCircle2 className={cn(c, "text-[var(--viz-series-1)]")} />;
    case "cancelled":
      return <CircleSlash className={cn(c, "text-muted-foreground")} />;
  }
}

export function statusLabel(status: IssueStatus) {
  return ISSUE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function StatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <StatusIcon status={status} />
      {t(statusLabel(status))}
    </span>
  );
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (priority) {
    case "urgent":
      return <AlertTriangle className={cn(c, "text-[var(--viz-critical)]")} />;
    case "high":
      return <SignalHigh className={cn(c, "text-foreground")} />;
    case "medium":
      return <SignalMedium className={cn(c, "text-foreground/80")} />;
    case "low":
      return <SignalLow className={cn(c, "text-muted-foreground")} />;
    default:
      return <Minus className={cn(c, "text-muted-foreground/60")} />;
  }
}

export function priorityLabel(p: Priority) {
  return PRIORITIES.find((x) => x.value === p)?.label ?? p;
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <PriorityIcon priority={priority} />
      {t(priorityLabel(priority))}
    </span>
  );
}

export function HealthBadge({ health, className, size = "sm" }: { health?: Health | null; className?: string; size?: "sm" | "md" }) {
  const t = useT();
  const label = t(HEALTHS.find((h) => h.value === health)?.label ?? "No update");
  const icon =
    health === "on_track" ? (
      <CheckCircle2 className="size-3.5 text-[var(--viz-good)]" />
    ) : health === "at_risk" ? (
      <AlertTriangle className="size-3.5 text-[var(--viz-warning)]" />
    ) : health === "off_track" ? (
      <XCircle className="size-3.5 text-[var(--viz-critical)]" />
    ) : (
      <CircleDashed className="size-3.5 text-muted-foreground" />
    );
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
        size === "sm" ? "text-xs" : "text-sm",
        health === "on_track" && "border-[color-mix(in_oklab,var(--viz-good)_35%,transparent)] bg-[color-mix(in_oklab,var(--viz-good)_8%,transparent)]",
        health === "at_risk" && "border-[color-mix(in_oklab,var(--viz-warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--viz-warning)_10%,transparent)]",
        health === "off_track" && "border-[color-mix(in_oklab,var(--viz-critical)_35%,transparent)] bg-[color-mix(in_oklab,var(--viz-critical)_8%,transparent)]",
        !health && "text-muted-foreground",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function PersonAvatar({ person, className, size = "sm" }: { person?: Person | null; className?: string; size?: "xs" | "sm" | "md" }) {
  const t = useT();
  const dim = size === "xs" ? "size-5 text-[10px]" : size === "sm" ? "size-6 text-[11px]" : "size-8 text-xs";
  if (!person) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full border border-dashed text-muted-foreground", dim, className)} title={t("Unassigned")}>
        <Circle className="size-3" />
      </span>
    );
  }
  return (
    <Avatar className={cn(dim, className)} title={person.name}>
      <AvatarFallback style={{ backgroundColor: person.color, color: "white" }} className="font-medium">
        {initials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function PersonChip({ person, className }: { person?: Person | null; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <PersonAvatar person={person} size="xs" />
      <span className={cn(!person && "text-muted-foreground")}>{person?.name ?? t("Unassigned")}</span>
    </span>
  );
}

export function ProjectDot({ project, className }: { project?: Pick<Project, "color"> | null; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-sm", className)} style={{ backgroundColor: project?.color ?? "var(--viz-muted)" }} />;
}

export function ProjectChip({ project, className, link = true }: { project?: Project | null; className?: string; link?: boolean }) {
  if (!project) return null;
  const inner = (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <ProjectDot project={project} />
      <span className="truncate">{project.name}</span>
    </span>
  );
  return link ? (
    <Link href={`/projects/${project.id}`} className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function KindBadge({ kind, className }: { kind: NoteKind; className?: string }) {
  const t = useT();
  const label = t(NOTE_KINDS.find((k) => k.value === kind)?.label ?? kind);
  return (
    <Badge variant="secondary" className={cn("font-normal", className)}>
      {label}
    </Badge>
  );
}

export function IssueKey({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{children}</span>;
}

export function DeltaArrow({ value }: { value: number }) {
  if (value > 0) return <ArrowUp className="size-3" />;
  if (value < 0) return <ArrowDown className="size-3" />;
  return <Minus className="size-3" />;
}

export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border border-dashed py-12", className)}>
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

export function Section({ title, actions, children, className }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
