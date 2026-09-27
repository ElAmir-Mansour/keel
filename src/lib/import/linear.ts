import { csvRecords, pick } from "./csv";
import { keyOf, mapPriority, mapStatus, splitLabels, toISO, toYMD, type ImportPlan, type ImportedIssue } from "./common";

// Linear "Export CSV" from a team or view. Teams become projects; Linear
// projects become milestones; the numeric part of the ID is kept as the
// issue number when the key matches.

export function isLinearCSV(headers: string[]) {
  return headers.includes("id") && headers.includes("team") && headers.includes("title") && headers.includes("status");
}

export function planLinear(text: string): ImportPlan {
  const { headers, rows } = csvRecords(text);
  const plan: ImportPlan = { source: "linear", issues: [], unmappedStatuses: {}, warnings: [] };
  if (!isLinearCSV(headers)) plan.warnings.push("This does not look like a Linear export (expected ID, Team, Title, Status columns).");
  for (const r of rows) {
    const title = pick(r, "Title");
    if (!title) continue;
    const idRaw = pick(r, "ID");
    const m = idRaw.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    const team = pick(r, "Team") || "Imported";
    const statusRaw = pick(r, "Status");
    const status = mapStatus(statusRaw);
    if (status === "backlog" && statusRaw && !/backlog/i.test(statusRaw)) plan.unmappedStatuses[statusRaw] = (plan.unmappedStatuses[statusRaw] ?? 0) + 1;
    const createdAt = toISO(pick(r, "Created")) ?? new Date().toISOString();
    const issue: ImportedIssue = {
      projectName: team,
      projectKey: m ? m[1].toUpperCase().slice(0, 6) : keyOf(team),
      seq: m ? Number(m[2]) : undefined,
      title,
      description: pick(r, "Description"),
      status,
      priority: mapPriority(pick(r, "Priority")),
      assignee: pick(r, "Assignee") || undefined,
      milestone: pick(r, "Project", "Project Milestone") || undefined,
      labels: splitLabels(pick(r, "Labels")),
      estimate: pick(r, "Estimate") ? Number(pick(r, "Estimate")) || undefined : undefined,
      dueDate: toYMD(pick(r, "Due Date")),
      createdAt,
      updatedAt: toISO(pick(r, "Updated")) ?? createdAt,
      startedAt: toISO(pick(r, "Started")),
      completedAt: toISO(pick(r, "Completed")),
      cancelledAt: toISO(pick(r, "Canceled", "Cancelled")),
      sourceKey: idRaw || undefined,
    };
    if (issue.cancelledAt && issue.status !== "done") issue.status = "cancelled";
    plan.issues.push(issue);
  }
  return plan;
}
