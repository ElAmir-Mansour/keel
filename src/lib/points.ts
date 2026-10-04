import { addMonths, differenceInCalendarDays, format, startOfMonth, startOfQuarter } from "date-fns";
import { KPI_METRICS, type BonusTier, type Issue, type IssueEvent, type Kpi, type KpiCadence, type PointEntry, type PointRules } from "./types";

// Points and KPI scoring, pure so every rule is unit-tested. The rules follow
// what the research on incentives recommends for a tool like this:
//
// - Points are earned when an issue reaches done and reversed if it leaves
//   done. The amount is the estimate locked when work started, so an estimate
//   cannot be inflated after the fact.
// - Earned points are derived from the issue history on every read, so they
//   cannot drift from what happened. Manual adjustments and bonuses are stored
//   entries with a written reason; a bonus is a draft until approved.
// - A KPI's attainment is actual/target (or 2 − actual/target when lower is
//   better), clamped to 0–150%. Rates with too few items score as "not enough
//   data" and their weight moves to the others, visibly.
// - The overall score is the weighted mean. A payout multiplier follows a
//   threshold–target–stretch curve, blended with the team's score so people
//   are not set against each other.

export const ATTAINMENT_CAP = 1.5;
/** Share of a period that must have passed before a projected score is shown. */
export const PROJECT_AFTER = 0.15;
export const DEFAULT_MIN_SAMPLE = 3;

export const DEFAULT_RULES: Omit<PointRules, "createdAt" | "updatedAt"> = {
  id: "default",
  scale: "fibonacci",
  thresholdPct: 80,
  teamSharePct: 70,
  tiers: [
    { minScore: 115, bonusPct: 10, label: "Exceeds" },
    { minScore: 130, bonusPct: 25, label: "Outstanding" },
  ],
  showOnPeoplePage: true,
};

// ----- periods -------------------------------------------------------------------

/** "2026-10" for a month, "2026-Q4" for a quarter. */
export function periodKey(cadence: KpiCadence, d: Date = new Date()) {
  if (cadence === "month") return format(d, "yyyy-MM");
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function cadenceOf(key: string): KpiCadence {
  return /-Q[1-4]$/.test(key) ? "quarter" : "month";
}

/** [start, end) of a period, as local dates. */
export function periodRange(key: string): { start: Date; end: Date } {
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) {
    const start = startOfQuarter(new Date(Number(q[1]), (Number(q[2]) - 1) * 3, 1));
    return { start, end: addMonths(start, 3) };
  }
  const m = key.match(/^(\d{4})-(\d{2})$/);
  const start = m ? startOfMonth(new Date(Number(m[1]), Number(m[2]) - 1, 1)) : startOfMonth(new Date());
  return { start, end: addMonths(start, 1) };
}

export function shiftPeriod(key: string, by: number) {
  const { start } = periodRange(key);
  return periodKey(cadenceOf(key), addMonths(start, by * (cadenceOf(key) === "quarter" ? 3 : 1)));
}

export function periodLabel(key: string) {
  if (cadenceOf(key) === "quarter") return key.replace("-", " ").replace(/^(\d{4}) (Q\d)$/, "$2 $1");
  return format(periodRange(key).start, "MMMM yyyy");
}

const inRange = (iso: string | undefined, r: { start: Date; end: Date }) => {
  if (!iso) return false;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d >= r.start && d < r.end;
};

// ----- who earns what --------------------------------------------------------------

/** What finishing this issue is worth. */
export function pointsOf(i: Pick<Issue, "lockedPoints" | "estimate">) {
  return i.lockedPoints ?? i.estimate ?? 0;
}

/** Credits as shares that sum to 1; the assignee takes everything by default. */
export function creditsOf(i: Pick<Issue, "credits" | "assigneeId">): { personId: string; share: number }[] {
  const list = (i.credits ?? []).filter((c) => c.personId && c.share > 0);
  if (list.length) {
    const total = list.reduce((n, c) => n + c.share, 0);
    return list.map((c) => ({ personId: c.personId, share: c.share / total }));
  }
  return i.assigneeId ? [{ personId: i.assigneeId, share: 1 }] : [];
}

export function shareOf(i: Pick<Issue, "credits" | "assigneeId">, personId: string) {
  return creditsOf(i).find((c) => c.personId === personId)?.share ?? 0;
}

export interface LedgerLine {
  id: string;
  personId: string;
  issueId?: string;
  at: string;
  amount: number;
  kind: "earned" | "reversed" | PointEntry["kind"];
  reason?: string;
  status: PointEntry["status"];
  period?: string;
}

/** Earned and reversed lines from the issue history, one per credited person per transition. */
export function derivedLedger(issues: Issue[], events: IssueEvent[]): LedgerLine[] {
  const byIssue = new Map<string, IssueEvent[]>();
  for (const e of events) {
    const arr = byIssue.get(e.issueId) ?? [];
    arr.push(e);
    byIssue.set(e.issueId, arr);
  }
  const out: LedgerLine[] = [];
  for (const i of issues) {
    const pts = pointsOf(i);
    const credits = creditsOf(i);
    if (!pts || !credits.length) continue;
    const evs = (byIssue.get(i.id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
    const moves: { at: string; dir: 1 | -1 }[] = [];
    let done = false;
    for (const e of evs) {
      if (e.to === "done" && !done) {
        moves.push({ at: e.at, dir: 1 });
        done = true;
      } else if (done && e.to !== "done") {
        moves.push({ at: e.at, dir: -1 });
        done = false;
      }
    }
    // Issues imported without a history still count once.
    if (!evs.length && i.status === "done" && i.completedAt) moves.push({ at: i.completedAt, dir: 1 });
    moves.forEach((m, n) => {
      for (const c of credits) {
        out.push({
          id: `${i.id}:${n}:${c.personId}`,
          personId: c.personId,
          issueId: i.id,
          at: m.at,
          amount: Math.round(pts * c.share * m.dir * 100) / 100,
          kind: m.dir === 1 ? "earned" : "reversed",
          status: "approved",
        });
      }
    });
  }
  return out;
}

export function storedLedger(entries: PointEntry[]): LedgerLine[] {
  return entries.map((e) => ({ id: e.id, personId: e.personId, issueId: e.issueId, at: e.at, amount: e.amount, kind: e.kind, reason: e.reason, status: e.status, period: e.period }));
}

// ----- KPI results ----------------------------------------------------------------

export interface KpiContext {
  issues: Issue[];
  events: IssueEvent[];
}

/** The issues a KPI looks at: credited to its owner, and matching its filter or linked to it. */
export function kpiIssues(kpi: Kpi, issues: Issue[]) {
  const f = kpi.filter ?? {};
  const matches = (i: Issue) =>
    (!f.projectIds?.length || f.projectIds.includes(i.projectId)) &&
    (!f.labels?.length || i.labels.some((l) => f.labels!.includes(l))) &&
    (!f.priorities?.length || f.priorities.includes(i.priority));
  return issues.filter((i) => shareOf(i, kpi.personId) > 0 && (matches(i) || (i.kpiIds ?? []).includes(kpi.id)));
}

/** Whether a KPI would count this issue for its owner (for the "counts toward" chips). */
export function kpiCountsIssue(kpi: Kpi, issue: Issue) {
  return kpiIssues(kpi, [issue]).length === 1;
}

export function median(values: number[]) {
  if (!values.length) return null;
  const v = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const days = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface KpiResult {
  actual: number | null;
  sample: number;
  enough: boolean;
  issueIds: string[];
}

export function kpiResult(kpi: Kpi, ctx: KpiContext, key: string, today = new Date()): KpiResult {
  const r = periodRange(key);
  const rel = kpiIssues(kpi, ctx.issues);
  const meta = KPI_METRICS.find((m) => m.value === kpi.metric);
  const minSample = kpi.minSample ?? DEFAULT_MIN_SAMPLE;
  const evsByIssue = new Map<string, IssueEvent[]>();
  for (const e of ctx.events) {
    const arr = evsByIssue.get(e.issueId) ?? [];
    arr.push(e);
    evsByIssue.set(e.issueId, arr);
  }
  const finish = (actual: number | null, sample: number, ids: string[]): KpiResult => ({
    actual: actual === null ? null : round1(actual),
    sample,
    enough: actual !== null && (!meta?.rate || sample >= minSample),
    issueIds: ids,
  });

  switch (kpi.metric) {
    case "points_delivered": {
      const lines = derivedLedger(rel, ctx.events).filter((l) => l.personId === kpi.personId && inRange(l.at, r));
      const ids = [...new Set(lines.map((l) => l.issueId!))];
      // Nobody can miss a points target before any of their work has points.
      const sized = rel.some((i) => pointsOf(i) > 0 && i.status !== "cancelled");
      return finish(sized || lines.length ? lines.reduce((n, l) => n + l.amount, 0) : null, ids.length, ids);
    }
    case "commitment_ratio": {
      // In a running period only what is already due counts: an issue due next
      // month has not been missed yet. Finished early still counts as kept.
      const todayYmd = format(today, "yyyy-MM-dd");
      const due = rel.filter((i) => i.status !== "cancelled" && inRange(i.dueDate, r) && (i.dueDate! < todayYmd || (i.status === "done" && i.completedAt !== undefined)));
      const kept = due.filter((i) => i.status === "done" && i.completedAt && new Date(i.completedAt) < r.end);
      const weightOf = (i: Issue) => pointsOf(i) * shareOf(i, kpi.personId) || 1;
      const total = due.reduce((n, i) => n + weightOf(i), 0);
      const done = kept.reduce((n, i) => n + weightOf(i), 0);
      return finish(total ? (done / total) * 100 : null, due.length, due.map((i) => i.id));
    }
    case "on_time_rate": {
      const done = rel.filter((i) => i.status === "done" && i.dueDate && inRange(i.completedAt, r));
      const onTime = done.filter((i) => i.completedAt!.slice(0, 10) <= i.dueDate!);
      return finish(done.length ? (onTime.length / done.length) * 100 : null, done.length, done.map((i) => i.id));
    }
    case "cycle_time_median": {
      const done = rel.filter((i) => i.status === "done" && i.startedAt && inRange(i.completedAt, r));
      return finish(median(done.map((i) => days(i.startedAt!, i.completedAt!))), done.length, done.map((i) => i.id));
    }
    case "review_wait": {
      const waits: number[] = [];
      const ids: string[] = [];
      for (const i of rel) {
        if (i.status !== "done" || !inRange(i.completedAt, r)) continue;
        const evs = (evsByIssue.get(i.id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
        let since: string | null = null;
        let total = 0;
        let seen = false;
        for (const ev of evs) {
          if (ev.to === "in_review" && since === null) {
            since = ev.at;
            seen = true;
          } else if (since !== null && ev.to !== "in_review") {
            total += days(since, ev.at);
            since = null;
          }
        }
        if (seen) {
          waits.push(total);
          ids.push(i.id);
        }
      }
      return finish(median(waits), waits.length, ids);
    }
    case "reopen_rate": {
      const finished: Issue[] = [];
      let reopened = 0;
      for (const i of rel) {
        const evs = (evsByIssue.get(i.id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
        const firstDone = evs.find((e) => e.to === "done");
        if (!firstDone || !inRange(firstDone.at, r)) continue;
        finished.push(i);
        if (evs.some((e) => e.at > firstDone.at && e.from === "done" && e.to !== "done")) reopened += 1;
      }
      return finish(finished.length ? (reopened / finished.length) * 100 : null, finished.length, finished.map((i) => i.id));
    }
    case "manual": {
      const v = kpi.manual?.[key];
      return finish(typeof v === "number" ? v : null, typeof v === "number" ? 1 : 0, []);
    }
  }
}

/**
 * How far along the target a result is, 0..1.5. Higher-is-better reads
 * actual/target; lower-is-better reads 2 − actual/target, which stays finite
 * at zero. A stretch goal, when set, is where the cap is reached.
 */
export function attainment(kpi: Pick<Kpi, "direction" | "target" | "stretch">, actual: number) {
  const { target, stretch } = kpi;
  if (kpi.direction === "higher") {
    if (target <= 0) return actual > 0 ? ATTAINMENT_CAP : 1;
    if (actual <= target || stretch === undefined || stretch <= target) return clamp(actual / target);
    return clamp(1 + 0.5 * Math.min(1, (actual - target) / (stretch - target)));
  }
  if (target <= 0) return actual <= 0 ? 1 : clamp(1 - actual);
  if (actual >= target || stretch === undefined || stretch >= target) return clamp(2 - actual / target);
  return clamp(1 + 0.5 * Math.min(1, (target - actual) / (target - stretch)));
}

function clamp(n: number) {
  return Math.max(0, Math.min(ATTAINMENT_CAP, n));
}

export interface ScoredKpi {
  kpi: Kpi;
  result: KpiResult;
  attainment: number | null;
  /** Share of the person's total weight this KPI carries after redistribution, 0..1. */
  effectiveWeight: number;
}

export interface Scorecard {
  personId: string;
  period: string;
  kpis: ScoredKpi[];
  /** Weighted mean attainment, 0..1.5, or null when nothing could be scored. */
  score: number | null;
  /** In a running period: the score if cumulative KPIs keep their current pace. */
  projected: number | null;
}

/** All of a person's KPIs for the period's cadence, scored. */
export function scorecard(personId: string, kpis: Kpi[], ctx: KpiContext, key: string, today = new Date()): Scorecard {
  const cadence = cadenceOf(key);
  const mine = kpis.filter((k) => k.personId === personId && !k.archived && k.cadence === cadence);
  const rows = mine.map((kpi) => {
    const result = kpiResult(kpi, ctx, key, today);
    return { kpi, result, attainment: result.enough && result.actual !== null ? attainment(kpi, result.actual) : null, effectiveWeight: 0 };
  });
  const scored = rows.filter((r) => r.attainment !== null);
  const totalWeight = scored.reduce((n, r) => n + Math.max(0, r.kpi.weight), 0);
  for (const r of scored) r.effectiveWeight = totalWeight ? Math.max(0, r.kpi.weight) / totalWeight : 0;
  const score = scored.length && totalWeight ? scored.reduce((n, r) => n + r.effectiveWeight * r.attainment!, 0) : null;
  const f = elapsedFraction(key, today);
  let projected: number | null = null;
  // Too early, and one finished issue projects to the cap; wait for a sixth of the period.
  if (score !== null && f >= PROJECT_AFTER && f < 1) {
    projected = scored.reduce((n, r) => {
      const cumulative = r.kpi.metric === "points_delivered" || (r.kpi.metric === "manual" && r.kpi.direction === "higher");
      const a = cumulative && r.result.actual !== null ? attainment(r.kpi, r.result.actual / f) : r.attainment!;
      return n + r.effectiveWeight * a;
    }, 0);
  }
  return { personId, period: key, kpis: rows, score, projected };
}

// ----- payout and bonus -------------------------------------------------------------

/**
 * Payout multiplier from an overall score: nothing below the threshold, 0.5 at
 * the threshold rising to 1.0 at target, then to 1.5 at the cap.
 */
export function payoutCurve(score: number | null, thresholdPct: number) {
  if (score === null) return 0;
  const th = thresholdPct / 100;
  if (score < th) return 0;
  if (score <= 1) return th >= 1 ? 1 : 0.5 + 0.5 * ((score - th) / (1 - th));
  return Math.min(ATTAINMENT_CAP, score);
}

export function blendedMultiplier(individual: number | null, team: number | null, rules: Pick<PointRules, "thresholdPct" | "teamSharePct">) {
  const share = Math.max(0, Math.min(100, rules.teamSharePct)) / 100;
  const ind = payoutCurve(individual, rules.thresholdPct);
  const tm = team === null ? ind : payoutCurve(team, rules.thresholdPct);
  return Math.round((share * tm + (1 - share) * ind) * 100) / 100;
}

/** The highest tier the score reaches, if any. */
export function tierFor(score: number | null, tiers: BonusTier[]) {
  if (score === null) return null;
  const pct = score * 100;
  return tiers
    .slice()
    .sort((a, b) => b.minScore - a.minScore)
    .find((t) => pct >= t.minScore) ?? null;
}

export interface PersonPeriod {
  personId: string;
  period: string;
  earned: number;
  adjustments: number;
  bonuses: number;
  pendingBonuses: number;
  total: number;
  card: Scorecard;
  tier: BonusTier | null;
  suggestedBonus: number;
  multiplier: number;
}

/** Everything the person page and the team table show for one person and period. */
export function personPeriod(personId: string, key: string, data: { kpis: Kpi[]; issues: Issue[]; events: IssueEvent[]; entries: PointEntry[]; rules: Pick<PointRules, "thresholdPct" | "teamSharePct" | "tiers"> }, teamScore: number | null): PersonPeriod {
  const r = periodRange(key);
  const earned = derivedLedger(data.issues, data.events)
    .filter((l) => l.personId === personId && inRange(l.at, r))
    .reduce((n, l) => n + l.amount, 0);
  const mine = data.entries.filter((e) => e.personId === personId);
  const adjustments = mine.filter((e) => e.kind === "adjustment" && e.status === "approved" && inRange(e.at, r)).reduce((n, e) => n + e.amount, 0);
  const bonusesFor = (status: PointEntry["status"]) => mine.filter((e) => e.kind === "bonus" && e.status === status && (e.period ? e.period === key : inRange(e.at, r))).reduce((n, e) => n + e.amount, 0);
  const card = scorecard(personId, data.kpis, { issues: data.issues, events: data.events }, key);
  const tier = tierFor(card.score, data.rules.tiers);
  const bonuses = bonusesFor("approved");
  return {
    personId,
    period: key,
    earned: round1(earned),
    adjustments: round1(adjustments),
    bonuses: round1(bonuses),
    pendingBonuses: round1(bonusesFor("draft")),
    total: round1(earned + adjustments + bonuses),
    card,
    tier,
    suggestedBonus: tier ? Math.max(1, Math.round((earned * tier.bonusPct) / 100)) : 0,
    multiplier: blendedMultiplier(card.score, teamScore, data.rules),
  };
}

/** The team's score: the mean of everyone who could be scored. */
export function teamScore(personIds: string[], kpis: Kpi[], ctx: KpiContext, key: string) {
  const scores = personIds.map((p) => scorecard(p, kpis, ctx, key).score).filter((s): s is number => s !== null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

export function formatResult(kpi: Pick<Kpi, "metric" | "unit">, value: number | null) {
  if (value === null) return "—";
  const meta = KPI_METRICS.find((m) => m.value === kpi.metric);
  const unit = kpi.metric === "manual" ? (kpi.unit ?? "") : (meta?.unit ?? "");
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : n;
}

/** How many calendar days are left in the period, counting today. */
export function daysLeft(key: string, today = new Date()) {
  const { start, end } = periodRange(key);
  if (today < start) return differenceInCalendarDays(end, start);
  return Math.max(0, differenceInCalendarDays(end, today));
}

/** How far through the period today is, 0..1 (1 for past periods). */
export function elapsedFraction(key: string, today = new Date()) {
  const { start, end } = periodRange(key);
  if (today <= start) return 0;
  if (today >= end) return 1;
  return (today.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

/**
 * For KPIs that accumulate over the period (points delivered, most manual
 * counts), where the person would be by today if they were on track: early in
 * a quarter nobody is near the full target, and that should not read as failing.
 */
export function paceFor(kpi: Pick<Kpi, "metric" | "direction" | "target">, actual: number | null, key: string, today = new Date()) {
  const cumulative = kpi.metric === "points_delivered" || (kpi.metric === "manual" && kpi.direction === "higher");
  const f = elapsedFraction(key, today);
  if (!cumulative || f >= 1 || actual === null) return null;
  const expected = Math.round(kpi.target * f * 10) / 10;
  return { expected, fraction: f, onPace: actual >= expected, gap: Math.round((expected - actual) * 10) / 10 };
}
