// Domain types for Keel. Every record carries string ids (nanoid) and ISO
// timestamps so the whole database round-trips through JSON export/import.

export type ProjectStatus = "active" | "paused" | "done" | "archived";
export type Health = "on_track" | "at_risk" | "off_track";

export interface CycleConfig {
  enabled: boolean;
  lengthWeeks: 1 | 2 | 3 | 4;
}

export interface Project {
  id: string;
  key: string; // short uppercase key, e.g. "KEEL" → issues read KEEL-12
  name: string;
  description: string;
  color: string; // one of PROJECT_COLORS
  status: ProjectStatus;
  targetDate?: string; // YYYY-MM-DD
  leadId?: string;
  /** Optional fixed-length cycles; unfinished work rolls over automatically. */
  cycleConfig?: CycleConfig;
  createdAt: string;
  updatedAt: string;
}

export type CycleStatus = "upcoming" | "active" | "done";

export interface Cycle {
  id: string;
  projectId: string;
  number: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, inclusive
  status: CycleStatus;
  createdAt: string;
  updatedAt: string;
}

/** A saved set of issue-list filters, per project or global. */
export interface SavedView {
  id: string;
  projectId?: string;
  name: string;
  params: string; // URL query string
  createdAt: string;
  updatedAt: string;
}

export type MilestoneStatus = "planned" | "active" | "done";

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  startDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  status: MilestoneStatus;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type IssueStatus =
  | "triage"
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export interface Issue {
  id: string;
  projectId: string;
  seq: number; // per-project sequence → KEY-seq
  milestoneId?: string;
  cycleId?: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  assigneeId?: string;
  dueDate?: string; // YYYY-MM-DD
  estimate?: number; // points; off by default
  /** The estimate when work started. This is what completing the issue earns. */
  lockedPoints?: number;
  /** Who earns the points, as shares that sum to 1. Absent: the assignee earns all of them. */
  credits?: IssueCredit[];
  /** KPIs this issue counts toward on top of those whose filter matches it. */
  kpiIds?: string[];
  labels: string[];
  order: number; // manual order inside a board column
  snoozedUntil?: string; // ISO; triage snooze
  startedAt?: string; // first time it entered in_progress
  completedAt?: string; // when it entered done
  createdAt: string;
  updatedAt: string;
}

export interface IssueEvent {
  id: string;
  issueId: string;
  projectId: string;
  at: string; // ISO
  from: IssueStatus | null;
  to: IssueStatus;
}


export type DecisionStatus =
  | "proposed"
  | "accepted"
  | "superseded"
  | "deprecated";

export interface Decision {
  id: string;
  projectId?: string;
  seq: number; // global ADR number
  title: string;
  status: DecisionStatus;
  date: string; // YYYY-MM-DD
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// The vault. Every markdown document is a Note: daily notes, meeting notes,
// 1:1s, PRDs, RFCs, runbooks, post-mortems, weekly updates and plain pages.
// Kind picks the template and the default folder; status is optional and
// only meaningful for documents that go through review.
export type NoteKind =
  | "page"
  | "daily"
  | "meeting"
  | "oneonone"
  | "retro"
  | "quick"
  | "prd"
  | "rfc"
  | "runbook"
  | "postmortem"
  | "weekly";

export type NoteStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "superseded"
  | "archived";

export interface Note {
  id: string;
  projectId?: string;
  personId?: string; // for 1:1 notes
  kind: NoteKind;
  folder: string; // "/" separated path, e.g. "Daily", "Projects/Platform base"
  title: string;
  date: string; // YYYY-MM-DD
  status?: NoteStatus;
  body: string; // markdown; [[Title]] links other notes, [[KEY-12]] issues, [[ADR-3]] decisions
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RiskKind = "risk" | "assumption" | "issue" | "dependency";
export type RiskStatus = "open" | "mitigating" | "closed" | "accepted";

export interface Risk {
  id: string;
  projectId: string;
  seq: number;
  kind: RiskKind;
  title: string;
  description: string;
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  status: RiskStatus;
  ownerId?: string;
  mitigation: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  email?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

// ----- points and KPIs ---------------------------------------------------------
// Points are earned when an issue reaches done and taken back if it is
// reopened; the amount is the estimate locked when work started. Each person
// has their own KPIs, scored per month or quarter against a target, weighted,
// and rolled into one score that decides any bonus. Earned points are derived
// from the issue history, never stored, so they cannot drift; only manual
// adjustments and bonuses are stored, append-only, each with a reason.

export interface IssueCredit {
  personId: string;
  share: number; // 0..1
}

export type KpiMetric =
  | "points_delivered"
  | "commitment_ratio"
  | "on_time_rate"
  | "cycle_time_median"
  | "review_wait"
  | "reopen_rate"
  | "manual";

export type KpiCadence = "month" | "quarter";
export type KpiDirection = "higher" | "lower";

export interface KpiFilter {
  projectIds?: string[];
  labels?: string[];
  priorities?: Priority[];
}

export interface Kpi {
  id: string;
  personId: string;
  name: string;
  metric: KpiMetric;
  direction: KpiDirection;
  target: number;
  /** Optional stretch goal; reaching it scores the 150% cap. */
  stretch?: number;
  cadence: KpiCadence;
  /** Relative weight; a person's weights are shown as shares of their total. */
  weight: number;
  filter?: KpiFilter;
  /** Rates below this many items score as "not enough data" instead of a number. */
  minSample?: number;
  /** Unit label for manual KPIs. */
  unit?: string;
  /** Manual results by period key (2026-10 or 2026-Q4). */
  manual?: Record<string, number>;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PointEntryKind = "adjustment" | "bonus" | "relock";
export type PointEntryStatus = "approved" | "draft" | "declined";

export interface PointEntry {
  id: string;
  personId: string;
  issueId?: string;
  kind: PointEntryKind;
  amount: number;
  reason: string;
  /** The period a bonus is for (2026-Q4). */
  period?: string;
  status: PointEntryStatus;
  at: string; // ISO
  createdAt: string;
  updatedAt: string;
}

export type EstimationScale = "fibonacci" | "linear" | "powers" | "tshirt";

export interface BonusTier {
  /** Overall score, in percent, from which the tier applies. */
  minScore: number;
  /** Extra points as a percentage of the points earned in the period. */
  bonusPct: number;
  label: string;
}

/** Workspace-wide rules for points and bonuses (one record, id "default"). */
export interface PointRules {
  id: string;
  scale: EstimationScale;
  /** Below this overall score (percent) the payout multiplier is zero. */
  thresholdPct: number;
  /** Share of the payout that follows the team's score rather than the person's (percent). */
  teamSharePct: number;
  tiers: BonusTier[];
  /** Show each person's score and points on the People page (alphabetical, never ranked). */
  showOnPeoplePage: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ESTIMATION_SCALES: { value: EstimationScale; label: string; points: { value: number; label: string }[] }[] = [
  { value: "fibonacci", label: "Fibonacci", points: [1, 2, 3, 5, 8, 13].map((n) => ({ value: n, label: String(n) })) },
  { value: "linear", label: "Linear 1–5", points: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
  { value: "powers", label: "Powers of two", points: [1, 2, 4, 8, 16].map((n) => ({ value: n, label: String(n) })) },
  {
    value: "tshirt",
    label: "T-shirt sizes",
    points: [
      { value: 1, label: "XS" },
      { value: 2, label: "S" },
      { value: 3, label: "M" },
      { value: 5, label: "L" },
      { value: 8, label: "XL" },
    ],
  },
];

export const KPI_METRICS: { value: KpiMetric; label: string; unit: string; direction: KpiDirection; rate: boolean; hint: string }[] = [
  { value: "points_delivered", label: "Points delivered", unit: "pts", direction: "higher", rate: false, hint: "Points from issues they finished in the period, minus any reopened." },
  { value: "commitment_ratio", label: "Commitment kept", unit: "%", direction: "higher", rate: true, hint: "Of the points due in the period, the share finished by its end." },
  { value: "on_time_rate", label: "On-time delivery", unit: "%", direction: "higher", rate: true, hint: "Issues finished on or before their due date." },
  { value: "cycle_time_median", label: "Cycle time (median)", unit: "days", direction: "lower", rate: true, hint: "Days from started to done, middle value." },
  { value: "review_wait", label: "Review wait (median)", unit: "days", direction: "lower", rate: true, hint: "Days their issues sat in review, middle value." },
  { value: "reopen_rate", label: "Reopen rate", unit: "%", direction: "lower", rate: true, hint: "Issues finished in the period that were later reopened." },
  { value: "manual", label: "Manual", unit: "", direction: "higher", rate: false, hint: "A result you enter yourself each period: a learning goal, interviews run, an incident review." },
];

/** A snapshot of a note's title and body, kept so edits can be undone later. */
export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  body: string;
  savedAt: string;
  updatedAt: string; // same as savedAt; keeps the record syncable by version
  /** Why the version exists when it is not an ordinary edit. */
  label?: "sync-conflict";
}

// Timelines: a hand-made chronology of what happened and what comes next.
// Entries are embedded in the timeline record so one timeline is one unit for
// sync, export and the AI tools. Dates are YYYY-MM-DD; an entry with an end
// draws as a bar, a milestone as a diamond, anything else as a dot.
export type TimelineEntryKind = "event" | "milestone";
export type TimelineEntryStatus = "done" | "active" | "planned";
/** Red / amber / green as managers read it: on track, at risk, off track. */
export type Rag = "on" | "risk" | "off";
export type Confidence = "high" | "medium" | "low";

export interface TimelineEntry {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD, inclusive; makes the entry a range
  group?: string; // swimlane / category, e.g. "Design", "Ops"
  kind?: TimelineEntryKind; // default "event"
  /** Explicit state; when absent it follows from the dates and today. */
  status?: TimelineEntryStatus;
  note?: string; // one or two lines of markdown
  link?: string; // wikilink target: PLAT-12, ADR-3 or a note title
  // Management view. Only entries marked `exec` appear on the slide.
  exec?: boolean;
  /** The date first committed to (the end for a range); slippage is measured against it. */
  baseline?: string; // YYYY-MM-DD
  owner?: string;
  confidence?: Confidence;
  /** Overrides the computed RAG; `why` says in a few words what the colour means. */
  rag?: Rag;
  why?: string;
}

/** A decision leadership has to take, with who owns it and by when. */
export interface TimelineAsk {
  id: string;
  decision: string;
  owner?: string;
  neededBy?: string; // YYYY-MM-DD
  done?: boolean;
}

/** What the executive items looked like at a review, so the next one can say what changed. */
export interface TimelineSnapshot {
  id: string;
  at: string; // YYYY-MM-DD
  items: { id: string; title: string; date: string; rag: Rag; state: TimelineEntryStatus }[];
}

export interface Timeline {
  id: string;
  projectId?: string;
  title: string;
  description: string;
  entries: TimelineEntry[];
  /** Optional fixed window; otherwise the chart fits the entries. */
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  // Management view
  /** The action title on the slide; generated from the data when empty. */
  headline?: string;
  owner?: string;
  asOf?: string; // YYYY-MM-DD; today when empty
  nextReview?: string; // YYYY-MM-DD
  asks?: TimelineAsk[];
  snapshots?: TimelineSnapshot[];
  /** Mirror the slide's time axis for an Arabic-only audience. */
  mirror?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const RAGS: { value: Rag; label: string }[] = [
  { value: "on", label: "On track" },
  { value: "risk", label: "At risk" },
  { value: "off", label: "Off track" },
];
export const CONFIDENCES: { value: Confidence; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** A pull request or commit that mentions an issue key (GitHub integration). */
export interface CodeLink {
  id: string; // pr:owner/repo#123 or commit:owner/repo@sha
  issueId: string;
  projectId: string;
  kind: "pr" | "commit";
  repo: string; // owner/name
  number?: number;
  sha?: string;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed" | "committed";
  author?: string;
  createdAt: string;
  mergedAt?: string;
  updatedAt: string;
  syncedAt: string;
}

/** One embedded chunk of a note, issue or decision (semantic search index). */
export interface Embedding {
  id: string; // kind:recordId:chunk
  kind: "note" | "issue" | "decision";
  recordId: string;
  chunk: number;
  title: string;
  text: string;
  version: string; // the record's updatedAt when embedded
  vector: Float32Array;
}

/**
 * A copy that lost a sync merge: the same record changed on two devices
 * between syncs, the newer edit won, and this one is kept so it can be looked
 * at, restored or dismissed. A losing note's text goes into its version
 * history instead and `versionId` points at it; every other table keeps the
 * losing record itself in `data`.
 */
export interface SyncConflict {
  id: string;
  tbl: string; // the record's table
  recordId: string;
  title: string; // the record's title or name, for the list
  data?: Record<string, unknown>;
  versionId?: string;
  /** The winning change was a delete, so restoring brings the record back. */
  winnerDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Tombstone left behind by every delete so sync can propagate removals. */
export interface Deletion {
  id: string; // the deleted record's id
  tbl: string; // its table name
  deletedAt: string;
}

export interface Update {
  id: string;
  projectId: string;
  date: string; // YYYY-MM-DD
  health: Health;
  summary: string; // markdown
  createdAt: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Display metadata. Order matters: it is the flow order used by the
// cumulative-flow chart and the board columns.

export const ISSUE_STATUSES: {
  value: IssueStatus;
  label: string;
  short: string;
}[] = [
  { value: "triage", label: "Triage", short: "Triage" },
  { value: "backlog", label: "Backlog", short: "Backlog" },
  { value: "todo", label: "Todo", short: "Todo" },
  { value: "in_progress", label: "In progress", short: "Doing" },
  { value: "in_review", label: "In review", short: "Review" },
  { value: "done", label: "Done", short: "Done" },
  { value: "cancelled", label: "Cancelled", short: "Cancelled" },
];

export const BOARD_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export const PRIORITIES: { value: Priority; label: string; rank: number }[] = [
  { value: "urgent", label: "Urgent", rank: 0 },
  { value: "high", label: "High", rank: 1 },
  { value: "medium", label: "Medium", rank: 2 },
  { value: "low", label: "Low", rank: 3 },
  { value: "none", label: "No priority", rank: 4 },
];

export const HEALTHS: { value: Health; label: string }[] = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "off_track", label: "Off track" },
];

export const DECISION_STATUSES: { value: DecisionStatus; label: string }[] = [
  { value: "proposed", label: "Proposed" },
  { value: "accepted", label: "Accepted" },
  { value: "superseded", label: "Superseded" },
  { value: "deprecated", label: "Deprecated" },
];

export const NOTE_KINDS: { value: NoteKind; label: string; folder: string }[] = [
  { value: "page", label: "Page", folder: "Pages" },
  { value: "daily", label: "Daily note", folder: "Daily" },
  { value: "meeting", label: "Meeting", folder: "Meetings" },
  { value: "oneonone", label: "1:1", folder: "1-1s" },
  { value: "retro", label: "Retro", folder: "Retros" },
  { value: "quick", label: "Quick note", folder: "Inbox" },
  { value: "prd", label: "PRD", folder: "Specs" },
  { value: "rfc", label: "RFC / design", folder: "Specs" },
  { value: "runbook", label: "Runbook", folder: "Runbooks" },
  { value: "postmortem", label: "Post-mortem", folder: "Post-mortems" },
  { value: "weekly", label: "Weekly update", folder: "Updates" },
];

export const NOTE_STATUSES: { value: NoteStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "superseded", label: "Superseded" },
  { value: "archived", label: "Archived" },
];

export function noteFolder(kind: NoteKind) {
  return NOTE_KINDS.find((k) => k.value === kind)?.folder ?? "Pages";
}

export const RISK_KINDS: { value: RiskKind; label: string }[] = [
  { value: "risk", label: "Risk" },
  { value: "assumption", label: "Assumption" },
  { value: "issue", label: "Issue" },
  { value: "dependency", label: "Dependency" },
];

export const RISK_STATUSES: { value: RiskStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "mitigating", label: "Mitigating" },
  { value: "accepted", label: "Accepted" },
  { value: "closed", label: "Closed" },
];

export const PROJECT_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

export function issueKey(project: Pick<Project, "key">, issue: Pick<Issue, "seq">) {
  return `${project.key}-${issue.seq}`;
}

export function riskScore(r: Pick<Risk, "likelihood" | "impact">) {
  return r.likelihood * r.impact;
}
