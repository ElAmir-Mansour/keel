import { csvRecords, pick } from "./csv";
import { keyOf, mapPriority, mapStatus, splitLabels, toISO, toYMD, type ImportPlan, type ImportedIssue } from "./common";

// Jira "Export → CSV (all fields)". Projects map one to one; the sprint, or
// failing that the parent/epic, becomes the milestone; the issue number is
// kept from the key.

export function isJiraCSV(headers: string[]) {
  return headers.includes("issue key") && headers.includes("summary");
}

export function planJira(text: string): ImportPlan {
  const { headers, rows } = csvRecords(text);
  const plan: ImportPlan = { source: "jira", issues: [], unmappedStatuses: {}, warnings: [] };
  if (!isJiraCSV(headers)) plan.warnings.push("This does not look like a Jira export (expected Issue key and Summary columns).");
  for (const r of rows) {
    const title = pick(r, "Summary");
    if (!title) continue;
    const keyRaw = pick(r, "Issue key");
    const m = keyRaw.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    const projectName = pick(r, "Project name", "Project") || (m ? m[1] : "Imported");
    const statusRaw = pick(r, "Status");
    const status = mapStatus(statusRaw);
    if (status === "backlog" && statusRaw && !/backlog/i.test(statusRaw)) plan.unmappedStatuses[statusRaw] = (plan.unmappedStatuses[statusRaw] ?? 0) + 1;
    const createdAt = toISO(pick(r, "Created")) ?? new Date().toISOString();
    const resolved = toISO(pick(r, "Resolved"));
    const type = pick(r, "Issue Type").toLowerCase();
    if (type === "epic") continue; // epics become milestones through their children
    const milestone = pick(r, "Sprint") || pick(r, "Parent summary", "Epic Link Summary", "Custom field (Epic Link)") || undefined;
    const estimateRaw = pick(r, "Custom field (Story point estimate)", "Custom field (Story Points)", "Story Points", "Original Estimate");
    const issue: ImportedIssue = {
      projectName,
      projectKey: (pick(r, "Project key") || (m ? m[1] : keyOf(projectName))).toUpperCase().slice(0, 6),
      seq: m ? Number(m[2]) : undefined,
      title,
      description: pick(r, "Description"),
      status,
      priority: mapPriority(pick(r, "Priority")),
      assignee: pick(r, "Assignee") || undefined,
      milestone,
      labels: [...splitLabels(pick(r, "Labels")), ...(type && type !== "task" && type !== "story" ? [type] : [])],
      estimate: estimateRaw ? Number(estimateRaw) || undefined : undefined,
      dueDate: toYMD(pick(r, "Due date", "Due Date")),
      createdAt,
      updatedAt: toISO(pick(r, "Updated")) ?? createdAt,
      startedAt: undefined,
      completedAt: status === "done" ? resolved ?? toISO(pick(r, "Updated")) : undefined,
      cancelledAt: status === "cancelled" ? resolved ?? toISO(pick(r, "Updated")) : undefined,
      sourceKey: keyRaw || undefined,
    };
    plan.issues.push(issue);
  }
  return plan;
}
