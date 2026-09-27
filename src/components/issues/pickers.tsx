"use client";
import { useState } from "react";
import { AlertTriangle, CalendarDays, CalendarRange, Diamond, Hash, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePeople } from "@/hooks/use-data";
import { fmtDate, fmtShort, isOverdue } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { transitionIssue, updateIssue } from "@/lib/repo";
import { ISSUE_STATUSES, PRIORITIES, type Cycle, type Issue, type IssueStatus, type Milestone, type Priority } from "@/lib/types";
import { PersonAvatar, PriorityIcon, StatusIcon, priorityLabel, statusLabel } from "@/components/ui-bits";
import { safeWrite } from "./issue-utils";

// Property pickers write immediately through repo.ts. `full` renders a
// labelled, full-width trigger for the detail sidebar; the default is a
// compact icon-only trigger for list rows and cards.

interface PickerProps {
  issue: Issue;
  full?: boolean;
  className?: string;
}

const NONE = "__none";

function PickerButton({
  full,
  icon,
  label,
  muted,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { full?: boolean; icon: React.ReactNode; label: string; muted?: boolean }) {
  return (
    <Button
      type="button"
      variant={full ? "outline" : "ghost"}
      size={full ? "sm" : "icon-xs"}
      className={cn(full && "w-full justify-start gap-2 font-normal", muted && "text-muted-foreground", className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {icon}
      {full ? <span className="truncate">{label}</span> : null}
    </Button>
  );
}

export function StatusPicker({ issue, full, className, statuses }: PickerProps & { statuses?: IssueStatus[] }) {
  const t = useT();
  const options = statuses ? ISSUE_STATUSES.filter((s) => statuses.includes(s.value)) : ISSUE_STATUSES;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PickerButton full={full} className={className} icon={<StatusIcon status={issue.status} />} label={statusLabel(issue.status)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={issue.status}
          onValueChange={(v) => v !== issue.status && void safeWrite(() => transitionIssue(issue.id, v as IssueStatus))}
        >
          {options.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              <StatusIcon status={s.value} /> {t(s.label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PriorityPicker({ issue, full, className }: PickerProps) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PickerButton full={full} className={className} icon={<PriorityIcon priority={issue.priority} />} label={priorityLabel(issue.priority)} muted={full && issue.priority === "none"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={issue.priority}
          onValueChange={(v) => v !== issue.priority && void safeWrite(() => updateIssue(issue.id, { priority: v as Priority }))}
        >
          {PRIORITIES.map((p) => (
            <DropdownMenuRadioItem key={p.value} value={p.value}>
              <PriorityIcon priority={p.value} /> {t(p.label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssigneePicker({ issue, full, className }: PickerProps) {
  const t = useT();
  const people = usePeople();
  const person = people.find((p) => p.id === issue.assigneeId) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PickerButton
          full={full}
          className={className}
          icon={<PersonAvatar person={person} size="xs" className="size-4 text-[9px]" />}
          label={person?.name ?? t("Unassigned")}
          muted={full && !person}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={issue.assigneeId ?? NONE}
          onValueChange={(v) => {
            const next = v === NONE ? undefined : v;
            if (next !== issue.assigneeId) void safeWrite(() => updateIssue(issue.id, { assigneeId: next }));
          }}
        >
          <DropdownMenuRadioItem value={NONE}>
            <PersonAvatar person={null} size="xs" /> {t("Unassigned")}
          </DropdownMenuRadioItem>
          {people.length ? <DropdownMenuSeparator /> : null}
          {people.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <PersonAvatar person={p} size="xs" /> <span className="truncate">{p.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MilestonePicker({ issue, milestones, full, className }: PickerProps & { milestones: Milestone[] }) {
  const t = useT();
  const current = milestones.find((m) => m.id === issue.milestoneId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PickerButton
          full={full}
          className={className}
          icon={<Diamond className={cn("size-3.5", current ? "text-[var(--viz-ordinal-3)]" : "text-muted-foreground")} />}
          label={current?.title ?? t("No milestone")}
          muted={full && !current}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={issue.milestoneId ?? NONE}
          onValueChange={(v) => {
            const next = v === NONE ? undefined : v;
            if (next !== issue.milestoneId) void safeWrite(() => updateIssue(issue.id, { milestoneId: next }));
          }}
        >
          <DropdownMenuRadioItem value={NONE}>
            <Diamond className="text-muted-foreground" /> {t("No milestone")}
          </DropdownMenuRadioItem>
          {milestones.length ? <DropdownMenuSeparator /> : null}
          {milestones.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <Diamond className={m.status === "done" ? "text-[var(--viz-good)]" : "text-[var(--viz-ordinal-3)]"} />
              <span className="truncate" dir="auto">{m.title}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CyclePicker({ issue, cycles, full, className }: PickerProps & { cycles: Cycle[] }) {
  const t = useT();
  const open = [...cycles].filter((c) => c.status !== "done").sort((a, b) => a.number - b.number);
  const current = cycles.find((c) => c.id === issue.cycleId);
  const label = current
    ? t(current.status === "active" ? "Cycle {n} · current" : current.status === "upcoming" ? "Cycle {n} · next" : "Cycle {n}", { n: current.number })
    : t("No cycle");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PickerButton full={full} className={className} icon={<CalendarRange className={cn("size-3.5", current ? "text-[var(--viz-series-1)]" : "text-muted-foreground")} />} label={label} muted={full && !current} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={issue.cycleId ?? NONE}
          onValueChange={(v) => {
            const next = v === NONE ? undefined : v;
            if (next !== issue.cycleId) void safeWrite(() => updateIssue(issue.id, { cycleId: next }));
          }}
        >
          <DropdownMenuRadioItem value={NONE}>
            <CalendarRange className="text-muted-foreground" /> {t("No cycle")}
          </DropdownMenuRadioItem>
          {open.length ? <DropdownMenuSeparator /> : null}
          {open.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              <CalendarRange className={c.status === "active" ? "text-[var(--viz-series-1)]" : "text-muted-foreground"} />
              {t(c.status === "active" ? "Cycle {n} · current" : "Cycle {n} · next", { n: c.number })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DueDatePicker({ issue, full, className }: PickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const overdue = issue.status !== "done" && issue.status !== "cancelled" && isOverdue(issue.dueDate);
  const label = issue.dueDate ? t("Due {date}", { date: fmtDate(issue.dueDate) }) : t("No due date");
  const fullLabel = issue.dueDate ? (overdue ? t("{date} · overdue", { date: fmtDate(issue.dueDate) }) : fmtDate(issue.dueDate)) : t("No due date");
  function save(v: string) {
    void safeWrite(() => updateIssue(issue.id, { dueDate: v || undefined }));
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerButton
          full={full}
          className={cn(overdue && "text-[var(--viz-critical)]", className)}
          icon={overdue ? <AlertTriangle className="size-3.5" /> : <CalendarDays className="size-3.5" />}
          label={full ? fullLabel : label}
          muted={full && !issue.dueDate}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            autoFocus
            defaultValue={issue.dueDate ?? ""}
            aria-label={t("Due date")}
            className="h-8 w-auto"
            onChange={(e) => e.target.value && save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                save(e.currentTarget.value);
                setOpen(false);
              }
            }}
          />
          {issue.dueDate ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => { save(""); setOpen(false); }}>
              {t("Clear")}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Small read-only due-date chip used in rows and cards. */
export function DueChip({ issue, className }: { issue: Issue; className?: string }) {
  const t = useT();
  if (!issue.dueDate) return null;
  const overdue = issue.status !== "done" && issue.status !== "cancelled" && isOverdue(issue.dueDate);
  return (
    <span
      className={cn("tabular inline-flex shrink-0 items-center gap-1 text-xs", overdue ? "font-medium text-[var(--viz-critical)]" : "text-muted-foreground", className)}
      title={overdue ? t("Overdue — due {date}", { date: fmtDate(issue.dueDate) }) : t("Due {date}", { date: fmtDate(issue.dueDate) })}
    >
      {overdue ? <AlertTriangle className="size-3" /> : null}
      {fmtShort(issue.dueDate)}
    </span>
  );
}

export function LabelsEditor({ issue, className }: { issue: Issue; className?: string }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const next = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !issue.labels.includes(s));
    setDraft("");
    if (next.length) void safeWrite(() => updateIssue(issue.id, { labels: [...issue.labels, ...next] }));
  }
  function remove(label: string) {
    void safeWrite(() => updateIssue(issue.id, { labels: issue.labels.filter((l) => l !== label) }));
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {issue.labels.map((l) => (
        <Badge key={l} variant="outline" className="h-5 gap-0.5 pe-0.5 font-normal">
          <span dir="auto">{l}</span>
          <button type="button" onClick={() => remove(l)} aria-label={t("Remove label {label}", { label: l })} className="rounded-full p-0.5 hover:bg-muted">
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        dir="auto"
        placeholder={issue.labels.length ? t("Add…") : t("Add label")}
        aria-label={t("Add label")}
        className="h-5 min-w-16 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
        onChange={(e) => {
          if (e.target.value.includes(",")) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && issue.labels.length) {
            remove(issue.labels[issue.labels.length - 1]);
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}

export function EstimateInput({ issue, className }: { issue: Issue; className?: string }) {
  const t = useT();
  function save(raw: string) {
    const n = raw.trim() === "" ? undefined : Number(raw);
    if (n !== undefined && (!Number.isFinite(n) || n < 0)) return;
    if (n !== issue.estimate) void safeWrite(() => updateIssue(issue.id, { estimate: n }));
  }
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Hash className="size-3.5 text-muted-foreground" />
      <Input
        key={issue.estimate ?? "none"}
        type="number"
        min={0}
        step={0.5}
        defaultValue={issue.estimate ?? ""}
        placeholder={t("None")}
        aria-label={t("Estimate")}
        className="h-7 w-20 text-xs"
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}
