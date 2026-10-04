"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Lock, Plus, Split, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/ui-bits";
import { usePeople } from "@/hooks/use-data";
import { useIssueKpis, usePointRules } from "@/hooks/use-points";
import { useT } from "@/lib/i18n";
import { creditsOf, pointsOf } from "@/lib/points";
import { linkIssueKpi, relockPoints, setCredits, updateIssue } from "@/lib/repo";
import { ESTIMATION_SCALES, type Issue, type IssueCredit } from "@/lib/types";
import { safeWrite } from "@/components/issues/issue-utils";

// Points on an issue: the estimate (with the workspace's scale as quick
// picks), the lock that freezes it when work starts, who earns it and in
// what shares, and which KPIs it counts toward.

export function scaleLabel(scale: string, value: number | undefined) {
  if (value === undefined) return "";
  const s = ESTIMATION_SCALES.find((x) => x.value === scale);
  const hit = s?.points.find((p) => p.value === value);
  return scale === "tshirt" && hit ? `${hit.label} · ${value}` : String(value);
}

/** Small "5 pts" chip for cards and rows. */
export function PointsChip({ issue, className }: { issue: Pick<Issue, "estimate" | "lockedPoints">; className?: string }) {
  const t = useT();
  const pts = issue.lockedPoints ?? issue.estimate;
  if (pts === undefined) return null;
  return (
    <span className={cn("inline-flex h-4 items-center gap-0.5 rounded border px-1 text-[10px] font-medium tabular-nums text-muted-foreground", className)} title={issue.lockedPoints !== undefined ? t("Locked when work started") : t("Points")}>
      {issue.lockedPoints !== undefined ? <Lock className="size-2.5" aria-hidden /> : null}
      {pts} {t("pts")}
    </span>
  );
}

export function PointsInput({ issue }: { issue: Issue }) {
  const t = useT();
  const rules = usePointRules();
  const [relock, setRelock] = useState(false);
  const scale = ESTIMATION_SCALES.find((s) => s.value === rules.scale) ?? ESTIMATION_SCALES[0];
  const locked = issue.lockedPoints !== undefined;

  function save(n: number | undefined) {
    if (n !== undefined && (!Number.isFinite(n) || n < 0)) return;
    if (n !== issue.estimate) void safeWrite(() => updateIssue(issue.id, { estimate: n }));
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {scale.points.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => (locked ? setRelock(true) : save(issue.estimate === p.value ? undefined : p.value))}
            aria-pressed={issue.estimate === p.value}
            className={cn(
              "h-6 min-w-6 rounded-md border px-1.5 text-xs tabular-nums transition-colors",
              (issue.lockedPoints ?? issue.estimate) === p.value ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
            title={scale.value === "tshirt" ? `${p.label} = ${p.value} ${t("pts")}` : undefined}
          >
            {p.label}
          </button>
        ))}
        {!locked ? (
          <Input
            key={issue.estimate ?? "none"}
            type="number"
            min={0}
            step={0.5}
            defaultValue={issue.estimate ?? ""}
            placeholder={t("Other")}
            aria-label={t("Points")}
            className="h-6 w-16 px-1.5 text-xs"
            onBlur={(e) => save(e.target.value.trim() === "" ? undefined : Number(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : null}
      </div>
      {locked ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          <span>{t("Earns {n} pts, locked when work started.", { n: issue.lockedPoints! })}</span>
          {issue.estimate !== undefined && issue.estimate !== issue.lockedPoints ? <span>{t("Estimate now {n}.", { n: issue.estimate })}</span> : null}
          <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => setRelock(true)}>
            {t("Re-estimate")}
          </Button>
        </div>
      ) : issue.estimate === undefined ? (
        <p className="text-xs text-muted-foreground">{t("Unestimated issues earn nothing.")}</p>
      ) : null}
      <RelockDialog open={relock} onOpenChange={setRelock} issue={issue} />
    </div>
  );
}

function RelockDialog({ open, onOpenChange, issue }: { open: boolean; onOpenChange: (v: boolean) => void; issue: Issue }) {
  const t = useT();
  const [value, setValue] = useState(String(issue.lockedPoints ?? issue.estimate ?? ""));
  const [reason, setReason] = useState("");
  const n = Number(value);
  const ok = value.trim() !== "" && Number.isFinite(n) && n >= 0 && reason.trim().length >= 3;
  async function submit() {
    if (!ok) return;
    await relockPoints(issue.id, n, reason);
    toast.success(t("Points changed to {n}; the reason is in the ledger.", { n }));
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Re-estimate after work started")}</DialogTitle>
          <DialogDescription>{t("Points lock when work starts so estimates cannot be inflated later. Change them only when the scope really changed, and say why; the change is recorded.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input type="number" min={0} step={0.5} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("New points")} className="w-28" />
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("Why the scope changed")} dir="auto" aria-label={t("Reason")} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!ok}>
            {t("Change points")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who earns the points: the assignee by default, or a split. */
export function CreditsEditor({ issue }: { issue: Issue }) {
  const t = useT();
  const people = usePeople();
  const credits = creditsOf(issue);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IssueCredit[]>([]);
  const pts = pointsOf(issue);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? t("Unknown");

  function begin() {
    const base = credits.length ? credits.map((c) => ({ personId: c.personId, share: Math.round(c.share * 100) })) : [];
    setDraft(base);
    setOpen(true);
  }
  const total = draft.reduce((n, c) => n + (Number(c.share) || 0), 0);
  async function save() {
    const list = draft.filter((c) => c.personId && c.share > 0).map((c) => ({ personId: c.personId, share: c.share / 100 }));
    // A single 100% share for the assignee is the default; store nothing.
    const isDefault = list.length === 1 && list[0].personId === issue.assigneeId;
    await setCredits(issue.id, isDefault ? [] : list);
    setOpen(false);
    toast.success(t("Credit split saved"));
  }

  return (
    <div className="grid gap-1">
      {credits.length ? (
        <ul className="grid gap-0.5 text-xs">
          {credits.map((c) => (
            <li key={c.personId} className="flex items-center gap-1.5">
              <PersonAvatar person={people.find((p) => p.id === c.personId)} size="xs" />
              <span className="min-w-0 flex-1 truncate">{name(c.personId)}</span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(c.share * 100)}%{pts ? ` · ${Math.round(pts * c.share * 10) / 10} ${t("pts")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("Assign someone to give them the points.")}</p>
      )}
      <Popover open={open} onOpenChange={(v) => (v ? begin() : setOpen(false))}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="w-fit text-xs text-muted-foreground">
            <Split /> {credits.length > 1 ? t("Edit split") : t("Split with others")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <p className="mb-2 text-xs text-muted-foreground">{t("Shares in percent. They are scaled to add up to 100.")}</p>
          <ul className="grid gap-1.5">
            {draft.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <select
                  value={c.personId}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, personId: e.target.value } : x)))}
                  className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-1.5 text-xs"
                  aria-label={t("Person")}
                >
                  <option value="">{t("Choose…")}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={c.share}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))}
                  className="h-7 w-16 px-1.5 text-xs"
                  aria-label={t("Share")}
                />
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("Remove")} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="xs" onClick={() => setDraft((d) => [...d, { personId: "", share: Math.max(0, 100 - total) || 50 }])}>
              <Plus /> {t("Add person")}
            </Button>
            <span className={cn("text-xs tabular-nums", total === 100 ? "text-muted-foreground" : "text-[var(--viz-serious)]")}>{t("Total {n}%", { n: total })}</span>
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button type="button" size="sm" onClick={() => void save()}>
              <Check /> {t("Save split")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** The KPIs this issue counts toward, and a way to link it to one its filter misses. */
export function KpiLinks({ issue }: { issue: Issue }) {
  const t = useT();
  const people = usePeople();
  const { counted, available } = useIssueKpis(issue);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  if (!counted.length && !available.length) {
    return <p className="text-xs text-muted-foreground">{creditsOf(issue).length ? t("No KPIs set for this person yet.") : t("Assign someone first.")}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {counted.map((c) => (
        <Badge key={c.kpi.id} variant="secondary" className="gap-1 font-normal">
          <Target className="size-3" aria-hidden />
          <Link href={`/team/${c.personId}`} className="hover:underline">
            {c.kpi.name}
          </Link>
          {counted.some((x) => x.personId !== c.personId) ? <span className="text-muted-foreground">· {name(c.personId)}</span> : null}
          {c.how === "explicit" ? (
            <button type="button" aria-label={t("Unlink {name}", { name: c.kpi.name })} onClick={() => void linkIssueKpi(issue.id, c.kpi.id, false)} className="rounded-full hover:text-destructive">
              <X className="size-3" />
            </button>
          ) : null}
        </Badge>
      ))}
      {available.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="h-5 px-1.5 text-xs text-muted-foreground">
              <Plus /> {t("Link a KPI")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("Its filter does not match; count it anyway")}</DropdownMenuLabel>
            {available.map((k) => (
              <DropdownMenuItem key={k.id} onSelect={() => void linkIssueKpi(issue.id, k.id, true)}>
                {k.name} <span className="ms-auto text-xs text-muted-foreground">{name(k.personId)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
