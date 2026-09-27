"use client";
import { db } from "@/lib/db";
import { createDecision, createIssue, createNote, createRisk, transitionIssue, updateIssue } from "@/lib/repo";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { issueKey, type IssueStatus, type NoteKind, type Priority, type Project, type RiskKind } from "@/lib/types";
import type { ToolCall } from "./client";

// What a proposed tool call would do, and how to do it once approved. Every
// executor validates its input again: the schema is strict on the API side,
// but the browser still owns the final check before it writes.

export interface ActionPreview {
  title: string;
  lines: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function resolveProject(key: unknown, fallbackId?: string): Promise<Project | undefined> {
  const k = str(key).trim().toUpperCase();
  if (k) {
    const byKey = await db.projects.where("key").equals(k).first();
    if (byKey) return byKey;
  }
  if (fallbackId) {
    const p = await db.projects.get(fallbackId);
    if (p) return p;
  }
  return (await db.projects.where("status").equals("active").sortBy("name"))[0];
}

async function resolveIssue(key: string) {
  const m = key.trim().toUpperCase().match(/^([A-Z][A-Z0-9]{1,5})-(\d+)$/);
  if (!m) return null;
  const project = await db.projects.where("key").equals(m[1]).first();
  if (!project) return null;
  const issue = await db.issues.where("[projectId+seq]").equals([project.id, Number(m[2])]).first();
  return issue ? { project, issue } : null;
}

export function previewToolCall(call: ToolCall): ActionPreview {
  const i = call.input;
  switch (call.name) {
    case "create_issues": {
      const issues = Array.isArray(i.issues) ? (i.issues as Record<string, unknown>[]) : [];
      return {
        title: `Create ${issues.length} issue${issues.length === 1 ? "" : "s"}${opt(i.projectKey) ? ` in ${str(i.projectKey)}` : ""}`,
        lines: issues.map((x) => `${str(x.title)}${opt(x.priority) && x.priority !== "none" ? ` · ${str(x.priority)}` : ""}${opt(x.dueDate) ? ` · due ${str(x.dueDate)}` : ""}`),
      };
    }
    case "log_decision":
      return { title: `Log decision: ${str(i.title)}`, lines: [`Decision: ${str(i.decision).slice(0, 160)}`, `Status: ${str(i.status) || "proposed"}`] };
    case "create_note":
      return { title: `Create note: ${str(i.title)}`, lines: [`${str(i.kind) || "page"} · ${str(i.body).length} chars${Array.isArray(i.tags) && i.tags.length ? ` · #${(i.tags as string[]).join(" #")}` : ""}`] };
    case "update_issue": {
      const changes = [
        opt(i.status) ? `status → ${str(i.status)}` : null,
        opt(i.priority) ? `priority → ${str(i.priority)}` : null,
        opt(i.assignee) ? `assignee → ${str(i.assignee)}` : null,
        opt(i.dueDate) ? `due → ${str(i.dueDate)}` : null,
      ].filter(Boolean) as string[];
      return { title: `Update ${str(i.key)}`, lines: changes.length ? changes : ["No changes"] };
    }
    case "add_risk":
      return { title: `Add ${str(i.kind) || "risk"}: ${str(i.title)}`, lines: [`Likelihood ${Number(i.likelihood)} × impact ${Number(i.impact)}`] };
    default:
      return { title: call.name, lines: [JSON.stringify(i).slice(0, 200)] };
  }
}

/** Runs an approved call and returns a short result the model can read. */
export async function executeToolCall(call: ToolCall, ctx: { projectId?: string }): Promise<string> {
  const i = call.input;
  switch (call.name) {
    case "create_issues": {
      const project = await resolveProject(i.projectKey, ctx.projectId);
      if (!project) throw new Error("No project to create issues in. Create a project first.");
      const issues = Array.isArray(i.issues) ? (i.issues as Record<string, unknown>[]) : [];
      const keys: string[] = [];
      for (const x of issues.slice(0, 20)) {
        const title = str(x.title).trim();
        if (!title) continue;
        const created = await createIssue({
          projectId: project.id,
          title,
          description: str(x.description),
          priority: (opt(x.priority) as Priority | undefined) ?? "none",
          dueDate: opt(x.dueDate),
          status: (opt(x.status) as IssueStatus | undefined) ?? "backlog",
        });
        keys.push(issueKey(project, created));
      }
      return keys.length ? `Created ${keys.join(", ")} in ${project.name}.` : "Nothing created.";
    }
    case "log_decision": {
      const project = opt(i.projectKey) ? await resolveProject(i.projectKey, ctx.projectId) : ctx.projectId ? await db.projects.get(ctx.projectId) : undefined;
      const d = await createDecision({
        title: str(i.title).trim() || "Untitled decision",
        context: str(i.context),
        decision: str(i.decision),
        consequences: str(i.consequences),
        alternatives: str(i.alternatives),
        projectId: project?.id,
        status: i.status === "accepted" ? "accepted" : "proposed",
      });
      return `Logged ADR-${d.seq}: ${d.title}.`;
    }
    case "create_note": {
      const project = opt(i.projectKey) ? await resolveProject(i.projectKey, ctx.projectId) : ctx.projectId ? await db.projects.get(ctx.projectId) : undefined;
      const kind = (opt(i.kind) as NoteKind | undefined) ?? "page";
      const n = await createNote({
        title: str(i.title).trim() || "Untitled",
        body: str(i.body) || NOTE_TEMPLATES[kind],
        kind,
        projectId: project?.id,
        tags: Array.isArray(i.tags) ? (i.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.replace(/^#/, "")) : [],
      });
      return `Created note [[${n.title}]].`;
    }
    case "update_issue": {
      const hit = await resolveIssue(str(i.key));
      if (!hit) throw new Error(`No issue ${str(i.key)} in this workspace.`);
      const patch: Record<string, unknown> = {};
      if (opt(i.priority)) patch.priority = str(i.priority);
      if (opt(i.dueDate)) patch.dueDate = str(i.dueDate);
      if (opt(i.assignee)) {
        const name = str(i.assignee).toLowerCase();
        const person = (await db.people.toArray()).find((p) => p.name.toLowerCase() === name || p.name.toLowerCase().startsWith(name));
        if (!person) throw new Error(`No person named ${str(i.assignee)}.`);
        patch.assigneeId = person.id;
      }
      if (Object.keys(patch).length) await updateIssue(hit.issue.id, patch);
      if (opt(i.status)) await transitionIssue(hit.issue.id, str(i.status) as IssueStatus);
      return `Updated ${issueKey(hit.project, hit.issue)}.`;
    }
    case "add_risk": {
      const project = await resolveProject(i.projectKey, ctx.projectId);
      if (!project) throw new Error("No project to add the risk to.");
      const clamp = (v: unknown) => Math.min(5, Math.max(1, Math.round(Number(v) || 3))) as 1 | 2 | 3 | 4 | 5;
      const r = await createRisk({
        projectId: project.id,
        title: str(i.title).trim() || "Untitled risk",
        kind: (opt(i.kind) as RiskKind | undefined) ?? "risk",
        likelihood: clamp(i.likelihood),
        impact: clamp(i.impact),
        mitigation: str(i.mitigation),
      });
      return `Added ${project.key}-R${r.seq}: ${r.title}.`;
    }
    default:
      throw new Error(`Unknown tool ${call.name}.`);
  }
}
