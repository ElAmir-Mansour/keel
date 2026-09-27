"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Check, ChevronDown, Diamond, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ISSUE_STATUSES,
  PRIORITIES,
  type Issue,
  type IssueStatus,
  type Milestone,
  type Person,
  type Priority,
  type Project,
} from "@/lib/types";
import { PersonAvatar, PriorityIcon, StatusIcon } from "@/components/ui-bits";
import { compareIssues, isRecentlyDone } from "./issue-utils";

// Filter state lives in the URL so a filtered view is a link. Empty means
// "no filter"; `done=1` widens the default visibility to old done and
// cancelled issues.

export type GroupBy = "none" | "status" | "milestone" | "assignee";

export interface IssueFilterState {
  q: string;
  status: IssueStatus[];
  priority: Priority[];
  assignee: string; // "", "none" or a person id
  milestone: string; // "", "none" or a milestone id
  group: GroupBy;
  done: boolean;
}

const STATUS_VALUES = new Set<string>(ISSUE_STATUSES.map((s) => s.value));
const PRIORITY_VALUES = new Set<string>(PRIORITIES.map((p) => p.value));
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "status", label: "Status" },
  { value: "milestone", label: "Milestone" },
  { value: "assignee", label: "Assignee" },
];

function parseFilters(sp: URLSearchParams): IssueFilterState {
  const list = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const group = sp.get("group") ?? "none";
  return {
    q: sp.get("q") ?? "",
    status: list("status").filter((s) => STATUS_VALUES.has(s)) as IssueStatus[],
    priority: list("priority").filter((p) => PRIORITY_VALUES.has(p)) as Priority[],
    assignee: sp.get("assignee") ?? "",
    milestone: sp.get("milestone") ?? "",
    group: GROUPS.some((g) => g.value === group) ? (group as GroupBy) : "none",
    done: sp.get("done") === "1",
  };
}

export function useIssueFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);

  const set = useCallback(
    (patch: Partial<IssueFilterState>) => {
      const next = new URLSearchParams(sp.toString());
      const put = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
      if (patch.q !== undefined) put("q", patch.q);
      if (patch.status) put("status", patch.status.join(","));
      if (patch.priority) put("priority", patch.priority.join(","));
      if (patch.assignee !== undefined) put("assignee", patch.assignee);
      if (patch.milestone !== undefined) put("milestone", patch.milestone);
      if (patch.group !== undefined) put("group", patch.group === "none" ? "" : patch.group);
      if (patch.done !== undefined) put("done", patch.done ? "1" : "");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const clear = useCallback(() => {
    const next = new URLSearchParams(sp.toString());
    for (const k of ["q", "status", "priority", "assignee", "milestone"]) next.delete(k);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const active =
    (filters.q ? 1 : 0) + (filters.status.length ? 1 : 0) + (filters.priority.length ? 1 : 0) + (filters.assignee ? 1 : 0) + (filters.milestone ? 1 : 0);

  return { filters, set, clear, active };
}

/** Apply the URL filters. Without a status filter, old done and cancelled issues stay hidden unless `done` is on. */
export function applyIssueFilters(issues: Issue[], f: IssueFilterState, project?: Pick<Project, "key"> | null) {
  const q = f.q.trim().toLowerCase();
  return issues.filter((i) => {
    if (i.status === "triage") return false;
    if (f.status.length) {
      if (!f.status.includes(i.status)) return false;
    } else if (!f.done) {
      if (i.status === "cancelled") return false;
      if (i.status === "done" && !isRecentlyDone(i)) return false;
    }
    if (f.priority.length && !f.priority.includes(i.priority)) return false;
    if (f.assignee === "none" ? i.assigneeId : f.assignee && i.assigneeId !== f.assignee) return false;
    if (f.milestone === "none" ? i.milestoneId : f.milestone && i.milestoneId !== f.milestone) return false;
    if (q) {
      const key = project ? `${project.key}-${i.seq}`.toLowerCase() : "";
      if (!i.title.toLowerCase().includes(q) && !key.includes(q) && !i.labels.some((l) => l.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

export interface IssueGroup {
  key: string;
  label: string | null;
  icon?: React.ReactNode;
  items: Issue[];
}

export function groupIssues(issues: Issue[], by: GroupBy, ctx: { milestones: Milestone[]; people: Person[] }): IssueGroup[] {
  const sorted = [...issues].sort(compareIssues);
  if (by === "none") return [{ key: "all", label: null, items: sorted }];
  const buckets = new Map<string, Issue[]>();
  const push = (k: string, i: Issue) => buckets.set(k, [...(buckets.get(k) ?? []), i]);
  const groups: IssueGroup[] = [];
  if (by === "status") {
    for (const i of sorted) push(i.status, i);
    for (const s of ISSUE_STATUSES) {
      const items = buckets.get(s.value);
      if (items) groups.push({ key: s.value, label: s.label, icon: <StatusIcon status={s.value} />, items });
    }
  } else if (by === "milestone") {
    for (const i of sorted) push(i.milestoneId ?? "none", i);
    for (const m of ctx.milestones) {
      const items = buckets.get(m.id);
      if (items) groups.push({ key: m.id, label: m.title, icon: <Diamond className="size-3.5 text-[var(--viz-ordinal-3)]" />, items });
    }
    const none = buckets.get("none");
    if (none) groups.push({ key: "none", label: "No milestone", icon: <Diamond className="size-3.5 text-muted-foreground" />, items: none });
  } else {
    for (const i of sorted) push(i.assigneeId ?? "none", i);
    for (const p of ctx.people) {
      const items = buckets.get(p.id);
      if (items) groups.push({ key: p.id, label: p.name, icon: <PersonAvatar person={p} size="xs" />, items });
    }
    const none = buckets.get("none");
    if (none) groups.push({ key: "none", label: "Unassigned", icon: <PersonAvatar person={null} size="xs" />, items: none });
  }
  return groups;
}

type Field = "q" | "status" | "priority" | "assignee" | "milestone" | "group";
const ALL_FIELDS: Field[] = ["q", "status", "priority", "assignee", "milestone", "group"];

export function IssueFilters({
  milestones,
  people,
  fields = ALL_FIELDS,
  className,
}: {
  milestones: Milestone[];
  people: Person[];
  fields?: Field[];
  className?: string;
}) {
  const { filters, set, clear, active } = useIssueFilters();
  const has = (f: Field) => fields.includes(f);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {has("q") ? (
        <div className="relative">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Filter…"
            aria-label="Filter issues"
            dir="auto"
            className="h-7 w-40 ps-7 text-xs"
            onKeyDown={(e) => e.key === "Escape" && set({ q: "" })}
          />
        </div>
      ) : null}
      {has("status") ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterButton active={filters.status.length}>
              Status
            </FilterButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {ISSUE_STATUSES.filter((s) => s.value !== "triage").map((s) => (
              <DropdownMenuCheckboxItem key={s.value} checked={filters.status.includes(s.value)} onCheckedChange={() => set({ status: toggle(filters.status, s.value) })} onSelect={(e) => e.preventDefault()}>
                <StatusIcon status={s.value} /> {s.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {has("priority") ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterButton active={filters.priority.length}>Priority</FilterButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {PRIORITIES.map((p) => (
              <DropdownMenuCheckboxItem key={p.value} checked={filters.priority.includes(p.value)} onCheckedChange={() => set({ priority: toggle(filters.priority, p.value) })} onSelect={(e) => e.preventDefault()}>
                <PriorityIcon priority={p.value} /> {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {has("assignee") ? (
        <Select value={filters.assignee || "__any"} onValueChange={(v) => set({ assignee: v === "__any" ? "" : v })}>
          <SelectTrigger size="sm" className={cn("h-7 text-xs", filters.assignee && "border-foreground/40")} aria-label="Assignee">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any">Anyone</SelectItem>
            <SelectItem value="none">
              <PersonAvatar person={null} size="xs" /> Unassigned
            </SelectItem>
            {people.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <PersonAvatar person={p} size="xs" /> {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {has("milestone") ? (
        <Select value={filters.milestone || "__any"} onValueChange={(v) => set({ milestone: v === "__any" ? "" : v })}>
          <SelectTrigger size="sm" className={cn("h-7 max-w-48 text-xs", filters.milestone && "border-foreground/40")} aria-label="Milestone">
            <SelectValue placeholder="Milestone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any">Any milestone</SelectItem>
            <SelectItem value="none">No milestone</SelectItem>
            {milestones.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <Diamond className="text-[var(--viz-ordinal-3)]" /> <span dir="auto">{m.title}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {has("group") ? (
        <Select value={filters.group} onValueChange={(v) => set({ group: v as GroupBy })}>
          <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Group by">
            <span className="text-muted-foreground">Group</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {active ? (
        <Button type="button" variant="ghost" size="xs" onClick={clear} className="text-muted-foreground">
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}

function FilterButton({ active, children, ...props }: React.ComponentProps<typeof Button> & { active: number }) {
  return (
    <Button type="button" variant="outline" size="sm" className={cn("h-7 gap-1 text-xs font-normal", active && "border-foreground/40")} {...props}>
      {active ? <Check className="size-3" /> : null}
      {children}
      {active ? <span className="tabular text-muted-foreground">{active}</span> : null}
      <ChevronDown className="size-3 opacity-60" />
    </Button>
  );
}
