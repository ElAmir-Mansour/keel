"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Award, Check, ChevronLeft, ChevronRight, ClipboardCopy, Lock, Minus, Pencil, Plus, Sparkles, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Section } from "@/components/ui-bits";
import { useProjects } from "@/hooks/use-data";
import { usePointsData } from "@/hooks/use-points";
import { STATUS_COLOR } from "@/lib/chart-theme";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import {
  ATTAINMENT_CAP,
  daysLeft,
  derivedLedger,
  elapsedFraction,
  paceFor,
  formatResult,
  periodKey,
  periodLabel,
  periodRange,
  personPeriod,
  shiftPeriod,
  storedLedger,
  teamScore,
  type LedgerLine,
  type ScoredKpi,
} from "@/lib/points";
import { addPointEntry, createKpi, decidePointEntry, deleteDraftEntry, setKpiManual } from "@/lib/repo";
import { KPI_METRICS, type KpiCadence, type Person } from "@/lib/types";
import { KpiDialog } from "./kpi-dialog";

// A person's points and KPIs for one month or quarter. Private to the lead's
// own workspace by design: no ranking, every number traceable to the issues
// or the written reason behind it.

export const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function attainmentColor(a: number) {
  return a >= 1 ? STATUS_COLOR.good : a >= 0.8 ? STATUS_COLOR.warning : STATUS_COLOR.serious;
}

/** 0–150% bar with a tick at target. */
export function AttainmentBar({ value, pace, tone: toneProp, className }: { value: number | null; pace?: number | null; tone?: number | null; className?: string }) {
  const t = useT();
  const w = value === null ? 0 : (Math.min(ATTAINMENT_CAP, value) / ATTAINMENT_CAP) * 100;
  // Mid-period, colour by pace rather than by the full-period target; an
  // explicit null tone means "too early to judge" and draws neutral.
  const tone = toneProp !== undefined ? toneProp : value === null ? null : pace ? value / pace : value;
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="meter" aria-valuemin={0} aria-valuemax={150} aria-valuenow={value === null ? undefined : Math.round(value * 100)} aria-label={t("Attainment")}>
      {value !== null ? <div className="h-full rounded-full transition-[width]" style={{ width: `${w}%`, backgroundColor: tone === null ? "var(--viz-deemphasis)" : attainmentColor(tone) }} /> : null}
      <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${(1 / ATTAINMENT_CAP) * 100}%` }} aria-hidden />
      {pace ? <div className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${(Math.min(1, pace) / ATTAINMENT_CAP) * 100}%` }} title={t("Where they would be by today")} aria-hidden /> : null}
    </div>
  );
}

const STARTER: { metric: (typeof KPI_METRICS)[number]["value"]; target: number; weight: number }[] = [
  { metric: "points_delivered", target: 30, weight: 50 },
  { metric: "on_time_rate", target: 85, weight: 30 },
  { metric: "reopen_rate", target: 10, weight: 20 },
];

export function PersonScorecard({ person }: { person: Person }) {
  const t = useT();
  const data = usePointsData();
  const projects = useProjects();
  const mine = data.kpis.filter((k) => k.personId === person.id && !k.archived);
  const defaultCadence: KpiCadence = mine.some((k) => k.cadence === "quarter") || !mine.length ? "quarter" : "month";
  const [cadence, setCadence] = useState<KpiCadence>(defaultCadence);
  const [key, setKey] = useState(() => periodKey(defaultCadence));
  const [dialog, setDialog] = useState<{ open: boolean; kpiId: string | null }>({ open: false, kpiId: null });
  const [adjust, setAdjust] = useState<{ kind: "adjustment" | "bonus" } | null>(null);
  const current = periodKey(cadence);

  const ctx = useMemo(() => ({ issues: data.issues, events: data.events }), [data.issues, data.events]);
  const team = useMemo(() => teamScore(data.people.map((p) => p.id), data.kpis, ctx, key), [data.people, data.kpis, ctx, key]);
  const pp = useMemo(() => personPeriod(person.id, key, { kpis: data.kpis, issues: data.issues, events: data.events, entries: data.entries, rules: data.rules }, team), [person.id, key, data, team]);

  const lines = useMemo(() => {
    const r = periodRange(key);
    const inR = (iso: string) => new Date(iso) >= r.start && new Date(iso) < r.end;
    const derived = derivedLedger(data.issues, data.events).filter((l) => l.personId === person.id && inR(l.at));
    const stored = storedLedger(data.entries).filter((l) => l.personId === person.id && (l.period ? l.period === key : inR(l.at)));
    return [...derived, ...stored].sort((a, b) => b.at.localeCompare(a.at));
  }, [data.issues, data.events, data.entries, person.id, key]);

  const issueById = useMemo(() => new Map(data.issues.map((i) => [i.id, i])), [data.issues]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const editing = dialog.kpiId ? data.kpis.find((k) => k.id === dialog.kpiId) : null;
  const bonusDrafted = data.entries.some((e) => e.personId === person.id && e.kind === "bonus" && e.period === key && e.status !== "declined");

  function switchCadence(c: KpiCadence) {
    setCadence(c);
    setKey(periodKey(c));
  }

  async function addStarter() {
    for (const s of STARTER) {
      const meta = KPI_METRICS.find((m) => m.value === s.metric)!;
      await createKpi({ personId: person.id, name: t(meta.label), metric: s.metric, direction: meta.direction, target: s.target, cadence: "quarter", weight: s.weight });
    }
    switchCadence("quarter");
    toast.success(t("Three starter KPIs added; adjust the targets to fit {name}.", { name: person.name }));
  }

  async function copySummary() {
    const rows = pp.card.kpis.map((r) => `- ${r.kpi.name}: ${formatResult(r.kpi, r.result.actual)} of ${formatResult(r.kpi, r.kpi.target)} (${r.attainment === null ? "not enough data" : pct(r.attainment)})`);
    const text = [`**${person.name} — ${periodLabel(key)}**`, `Points: ${pp.total} · Score: ${pct(pp.card.score)}${pp.tier ? ` · ${pp.tier.label}` : ""}`, ...rows].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Summary copied; paste it into your 1:1 note."));
    } catch {
      toast.error(t("Could not copy"));
    }
  }

  const issueLabel = (l: LedgerLine) => {
    const i = l.issueId ? issueById.get(l.issueId) : undefined;
    const p = i ? projectById.get(i.projectId) : undefined;
    return i && p ? { href: `/projects/${p.id}/issues/${i.seq}`, key: `${p.key}-${i.seq}`, title: i.title } : null;
  };

  return (
    <Section
      title={t("Points and KPIs")}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => void copySummary()} disabled={!pp.card.kpis.length && !pp.total}>
            <ClipboardCopy /> {t("Copy summary")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => setAdjust({ kind: "adjustment" })}>
            <Plus /> {t("Adjust points")}
          </Button>
          <Button size="xs" onClick={() => setDialog({ open: true, kpiId: null })}>
            <Target /> {t("Add KPI")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={cadence} onValueChange={(v) => switchCadence(v as KpiCadence)}>
          <TabsList className="h-8">
            <TabsTrigger value="quarter" className="text-xs">
              {t("Quarter")}
            </TabsTrigger>
            <TabsTrigger value="month" className="text-xs">
              {t("Month")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          <Button size="icon-xs" variant="ghost" aria-label={t("Previous period")} onClick={() => setKey((k) => shiftPeriod(k, -1))}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <span className="min-w-28 text-center text-sm font-medium tabular-nums">{periodLabel(key)}</span>
          <Button size="icon-xs" variant="ghost" aria-label={t("Next period")} onClick={() => setKey((k) => shiftPeriod(k, 1))} disabled={key >= current}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </div>
        {key === current ? <span className="text-xs text-muted-foreground">{t("{n} days left", { n: daysLeft(key) })}</span> : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("Points")} value={String(pp.total)} sub={pp.adjustments || pp.bonuses ? t("{e} earned · {a} adjusted · {b} bonus", { e: pp.earned, a: pp.adjustments, b: pp.bonuses }) : t("from finished issues")} />
        <Tile
          label={key === current ? t("KPI score so far") : t("KPI score")}
          value={pct(pp.card.score)}
          sub={
            pp.card.score === null
              ? t("nothing scored yet")
              : key === current && pp.card.projected !== null
                ? t("on pace for {p} · {g} of the period gone", { p: pct(pp.card.projected), g: pct(elapsedFraction(key)) })
                : key === current
                  ? t("too early to project · {g} of the period gone", { g: pct(elapsedFraction(key)) })
                  : t("weighted, capped at 150%")
          }
          tone={pp.card.score}
        />
        <Tile label={t("Bonus")} value={pp.tier ? t(pp.tier.label) : "—"} sub={t("payout ×{m} · team {team}", { m: pp.multiplier.toFixed(2), team: pct(team) })} />
        <Tile label={t("Waiting for you")} value={String(lines.filter((l) => l.status === "draft").length)} sub={t("bonus drafts to approve")} />
      </dl>

      {mine.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <p>{t("No KPIs for {name} yet. Pick three to five that matter, weight them, and every finished issue moves them.", { name: person.name })}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void addStarter()}>
              <Sparkles /> {t("Add a starter set")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, kpiId: null })}>
              <Target /> {t("Add one KPI")}
            </Button>
          </div>
        </div>
      ) : pp.card.kpis.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No KPIs are scored per {cadence}. Switch the period above.", { cadence: cadence === "month" ? t("month") : t("quarter") })}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" aria-label={t("KPIs")}>
          {pp.card.kpis.map((r) => (
            <KpiRow key={r.kpi.id} row={r} period={key} onEdit={() => setDialog({ open: true, kpiId: r.kpi.id })} />
          ))}
        </ul>
      )}

      {pp.tier && !bonusDrafted ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--viz-good)_40%,transparent)] bg-[color-mix(in_oklab,var(--viz-good)_8%,transparent)] p-3 text-sm">
          <Award className="size-4 text-[var(--viz-good-text)]" aria-hidden />
          <span className="min-w-0 flex-1">{t("{name} reached {tier} ({score}). Suggested bonus: {n} points.", { name: person.name, tier: t(pp.tier.label), score: pct(pp.card.score), n: pp.suggestedBonus })}</span>
          <Button size="sm" variant="outline" onClick={() => setAdjust({ kind: "bonus" })}>
            {t("Draft bonus")}
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Ledger · {period}", { period: periodLabel(key) })}</h3>
        {lines.length ? (
          <ul className="divide-y overflow-hidden rounded-lg border text-sm" aria-label={t("Points ledger")}>
            {lines.slice(0, 40).map((l) => {
              const link = issueLabel(l);
              return (
                <li key={l.id} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5", l.status === "declined" && "opacity-60")}>
                  <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(l.at, "d MMM")}</span>
                  <LedgerKind kind={l.kind} status={l.status} />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {link ? (
                      <Link href={link.href} className="hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{link.key}</span> {link.title}
                      </Link>
                    ) : null}
                    {l.reason ? <span className={link ? "ms-1 text-muted-foreground" : undefined}>{link ? `— ${l.reason}` : l.reason}</span> : null}
                  </span>
                  <span className={cn("w-14 shrink-0 text-end font-medium tabular-nums", l.amount < 0 ? "text-[var(--viz-critical)]" : l.kind === "relock" ? "text-muted-foreground" : "")}>
                    {l.amount > 0 ? "+" : ""}
                    {l.amount}
                  </span>
                  {l.status === "draft" ? (
                    <span className="flex gap-1">
                      <Button size="xs" onClick={() => void decidePointEntry(l.id, "approved").then(() => toast.success(t("Bonus approved")))}>
                        <Check /> {t("Approve")}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => void decidePointEntry(l.id, "declined")}>
                        <X /> {t("Decline")}
                      </Button>
                      <Button size="icon-xs" variant="ghost" aria-label={t("Delete draft")} onClick={() => void deleteDraftEntry(l.id)}>
                        <Minus />
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("Nothing yet this period. Points appear here when an issue with points reaches done.")}</p>
        )}
      </div>

      <KpiDialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} personId={person.id} kpi={editing} />
      {adjust ? (
        <AdjustDialog
          kind={adjust.kind}
          person={person}
          period={key}
          suggested={adjust.kind === "bonus" ? pp.suggestedBonus : undefined}
          suggestedReason={adjust.kind === "bonus" && pp.tier ? `${t(pp.tier.label)}: ${t("KPI score")} ${pct(pp.card.score)} ${t("in")} ${periodLabel(key)}` : ""}
          onClose={() => setAdjust(null)}
        />
      ) : null}
    </Section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number | null }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums" style={tone !== undefined && tone !== null ? { color: tone >= 1 ? "var(--viz-good-text)" : undefined } : undefined}>
        {value}
      </dd>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function LedgerKind({ kind, status }: { kind: LedgerLine["kind"]; status: LedgerLine["status"] }) {
  const t = useT();
  const label = kind === "earned" ? t("Earned") : kind === "reversed" ? t("Reopened") : kind === "bonus" ? (status === "draft" ? t("Bonus · draft") : status === "declined" ? t("Bonus · declined") : t("Bonus")) : kind === "relock" ? t("Re-estimated") : t("Adjustment");
  return (
    <Badge variant={kind === "bonus" ? "default" : "outline"} className="h-5 shrink-0 gap-1 px-1.5 text-[10px] font-normal">
      {kind === "relock" ? <Lock className="size-2.5" aria-hidden /> : null}
      {label}
    </Badge>
  );
}

function KpiRow({ row, period, onEdit }: { row: ScoredKpi; period: string; onEdit: () => void }) {
  const t = useT();
  const { kpi, result, attainment } = row;
  const pace = paceFor(kpi, result.actual, period);
  const meta = KPI_METRICS.find((m) => m.value === kpi.metric)!;
  const [manual, setManual] = useState<string | null>(null);
  const filterBits = [kpi.filter?.projectIds?.length ? t("one project") : null, kpi.filter?.labels?.length ? `#${kpi.filter.labels.join(" #")}` : null, kpi.filter?.priorities?.length ? t(kpi.filter.priorities[0]) : null].filter(Boolean);
  return (
    <li className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(8rem,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium" dir="auto">
            {kpi.name}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-xs text-muted-foreground">{kpi.name.trim().toLowerCase() === t(meta.label).toLowerCase() || kpi.name.trim().toLowerCase() === meta.label.toLowerCase() ? "ⓘ" : t(meta.label)}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {t(meta.hint)} {kpi.direction === "lower" ? t("Lower is better.") : null}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Weight {w}", { w: kpi.weight })}
          {row.effectiveWeight ? ` · ${t("{p} of the score", { p: pct(row.effectiveWeight) })}` : ""}
          {filterBits.length ? ` · ${filterBits.join(" · ")}` : ""}
        </p>
      </div>
      <div className="text-sm tabular-nums">
        {kpi.metric === "manual" ? (
          <span className="inline-flex items-center gap-1">
            <Input
              type="number"
              step="any"
              value={manual ?? (result.actual ?? "")}
              onChange={(e) => setManual(e.target.value)}
              onBlur={() => {
                if (manual === null) return;
                void setKpiManual(kpi.id, period, manual.trim() === "" ? undefined : Number(manual));
                setManual(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="—"
              aria-label={t("Result for {name}", { name: kpi.name })}
              className="h-7 w-20 text-xs"
            />
            <span className="text-xs text-muted-foreground">
              / {formatResult(kpi, kpi.target)}
            </span>
          </span>
        ) : (
          <>
            <span className="font-medium">{formatResult(kpi, result.actual)}</span> <span className="text-muted-foreground">/ {formatResult(kpi, kpi.target)}</span>
            {kpi.stretch !== undefined ? <span className="text-xs text-muted-foreground"> · {t("stretch {v}", { v: formatResult(kpi, kpi.stretch) })}</span> : null}
          </>
        )}
      </div>
      <div className="grid gap-0.5">
        <AttainmentBar value={attainment} pace={pace ? pace.fraction : null} />
        <span className="text-xs text-muted-foreground">
          {attainment !== null
            ? pct(attainment)
            : result.actual === null
              ? kpi.metric === "points_delivered"
                ? t("no estimated work yet")
                : t("no data yet")
              : t("not enough data ({n} of {m})", { n: result.sample, m: kpi.minSample ?? 3 })}
          {meta.rate && attainment !== null ? ` · ${t("{n} issues", { n: result.sample })}` : ""}
          {pace ? ` · ${pace.onPace ? t("on pace") : t("{n} behind pace", { n: formatResult(kpi, pace.gap) })}` : ""}
        </span>
      </div>
      <Button size="icon-xs" variant="ghost" aria-label={t("Edit {name}", { name: kpi.name })} onClick={onEdit} className="justify-self-end">
        <Pencil />
      </Button>
    </li>
  );
}

function AdjustDialog({ kind, person, period, suggested, suggestedReason, onClose }: { kind: "adjustment" | "bonus"; person: Person; period: string; suggested?: number; suggestedReason: string; onClose: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState(suggested !== undefined ? String(suggested) : "");
  const [reason, setReason] = useState(suggestedReason);
  const n = Number(amount);
  const ok = amount.trim() !== "" && Number.isFinite(n) && n !== 0 && reason.trim().length >= 3;
  async function submit() {
    if (!ok) return;
    await addPointEntry({ personId: person.id, kind, amount: n, reason, period: kind === "bonus" ? period : undefined });
    toast.success(kind === "bonus" ? t("Bonus drafted; approve it in the ledger.") : t("Adjustment recorded."));
    onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "bonus" ? t("Draft a bonus for {name}", { name: person.name }) : t("Adjust {name}'s points", { name: person.name })}</DialogTitle>
          <DialogDescription>
            {kind === "bonus"
              ? t("A bonus starts as a draft and counts only once you approve it. The reason stays in the ledger.")
              : t("For work that has no issue (an incident, mentoring, a hard review) or to correct a mistake. Use a negative number to take points away. The reason stays in the ledger.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t("Points")} placeholder={t("Points, e.g. 3 or -2")} className="w-40" autoFocus />
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("Reason (required)")} aria-label={t("Reason")} dir="auto" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!ok}>
            {kind === "bonus" ? t("Draft bonus") : t("Record adjustment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
