import { parse as parseDate, isValid } from "date-fns";
import type { IssueStatus, Priority } from "@/lib/types";

// Shared mapping rules for issue trackers. Names are matched by keyword so
// custom workflow states land somewhere sensible instead of failing.

export function mapStatus(raw: string): IssueStatus {
  const s = raw.trim().toLowerCase();
  if (!s) return "backlog";
  // Exact "ready to start" states first, so "Selected for Development" is
  // not caught by the in-progress keyword "development".
  if (/^(to ?do|to-do|selected for dev\w*|ready( for dev\w*)?|planned|next up|open|unstarted)$/.test(s)) return "todo";
  if (/cancel|won'?t|wont|duplicate|rejected|declined|invalid/.test(s)) return "cancelled";
  if (/done|resolved|complete|released|shipped|closed|merged|finished/.test(s)) return "done";
  if (/review|qa|test|verify|approval|awaiting/.test(s)) return "in_review";
  if (/progress|doing|started|development|working|active|implement/.test(s)) return "in_progress";
  if (/todo|to do|to-do|selected|ready|planned|next|open/.test(s)) return "todo";
  if (/triage|new|untriaged|inbox/.test(s)) return "triage";
  return "backlog";
}

export function mapPriority(raw: string): Priority {
  const s = raw.trim().toLowerCase();
  if (!s) return "none";
  if (/^(1|urgent|highest|blocker|critical|p0)$/.test(s)) return "urgent";
  if (/^(2|high|major|p1)$/.test(s)) return "high";
  if (/^(3|medium|normal|p2)$/.test(s)) return "medium";
  if (/^(4|low|lowest|minor|trivial|p3|p4)$/.test(s)) return "low";
  if (/urgent|blocker|critical/.test(s)) return "urgent";
  if (/high|major/.test(s)) return "high";
  if (/medium|normal/.test(s)) return "medium";
  if (/low|minor|trivial/.test(s)) return "low";
  return "none";
}

const FORMATS = [
  "dd/MMM/yy h:mm a",
  "dd/MMM/yyyy h:mm a",
  "dd/MMM/yy HH:mm",
  "dd/MMM/yyyy HH:mm",
  "yyyy-MM-dd HH:mm",
  "yyyy-MM-dd",
  "MM/dd/yyyy HH:mm",
  "MM/dd/yyyy",
  "dd/MM/yyyy",
  "d MMM yyyy",
  "MMM d, yyyy",
];

/** ISO timestamp from the many shapes trackers export, or undefined. */
export function toISO(raw: string | undefined): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime()) && /\d{4}-\d{2}-\d{2}/.test(s)) return direct.toISOString();
  for (const f of FORMATS) {
    const d = parseDate(s, f, new Date());
    if (isValid(d)) return d.toISOString();
  }
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return undefined;
}

export function toYMD(raw: string | undefined): string | undefined {
  const iso = toISO(raw);
  return iso ? iso.slice(0, 10) : undefined;
}

export function splitLabels(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((l) => l.trim().replace(/^#/, ""))
    .filter(Boolean);
}

export function keyOf(name: string, fallback = "PROJ") {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const base = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 4);
  const k = base.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k || fallback;
}

/** An imported issue before it is given ids and written. */
export interface ImportedIssue {
  projectName: string;
  projectKey?: string;
  seq?: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  assignee?: string;
  milestone?: string;
  labels: string[];
  estimate?: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  sourceKey?: string;
}

export interface ImportPlan {
  source: "linear" | "jira" | "csv";
  issues: ImportedIssue[];
  unmappedStatuses: Record<string, number>;
  warnings: string[];
}
