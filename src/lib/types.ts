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
  estimate?: number; // optional points/hours, off by default
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

/** A snapshot of a note's title and body, kept so edits can be undone later. */
export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  body: string;
  savedAt: string;
  updatedAt: string; // same as savedAt; keeps the record syncable by version
}

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
