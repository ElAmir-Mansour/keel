import { db } from "@/lib/db";
import type { TimelineEntry } from "@/lib/types";

// Dated records a project already holds, offered as timeline entries so a
// timeline starts from facts rather than from memory.

export type ProjectSourceKey = "milestones" | "decisions" | "cycles" | "issues" | "target";

export const PROJECT_SOURCES: { key: ProjectSourceKey; label: string; hint: string }[] = [
  { key: "milestones", label: "Milestones", hint: "Dated milestones; those with a start and a due date become bars." },
  { key: "decisions", label: "Decisions", hint: "Each ADR on its date, linked as ADR-n." },
  { key: "cycles", label: "Cycles", hint: "One bar per cycle." },
  { key: "issues", label: "Completed issues with a due date", hint: "Shipped work as events, linked by key." },
  { key: "target", label: "Project target date", hint: "The target as a milestone." },
];

export async function entriesFromProject(projectId: string, sources: ProjectSourceKey[]): Promise<Partial<TimelineEntry>[]> {
  const out: Partial<TimelineEntry>[] = [];
  const want = new Set(sources);
  const project = await db.projects.get(projectId);
  if (!project) return out;
  if (want.has("milestones")) {
    const ms = await db.milestones.where({ projectId }).sortBy("order");
    for (const m of ms) {
      if (!m.startDate && !m.dueDate) continue;
      out.push({
        title: m.title,
        start: m.startDate ?? m.dueDate!,
        end: m.startDate && m.dueDate && m.dueDate > m.startDate ? m.dueDate : undefined,
        kind: m.startDate && m.dueDate ? undefined : "milestone",
        group: "Milestones",
        status: m.status === "done" ? "done" : undefined,
      });
    }
  }
  if (want.has("decisions")) {
    const ds = await db.decisions.where({ projectId }).toArray();
    for (const d of ds) out.push({ title: d.title, start: d.date, group: "Decisions", link: `ADR-${d.seq}` });
  }
  if (want.has("cycles")) {
    const cs = await db.cycles.where({ projectId }).toArray();
    for (const c of cs) out.push({ title: `Cycle ${c.number}`, start: c.startDate, end: c.endDate, group: "Cycles" });
  }
  if (want.has("issues")) {
    const is = await db.issues.where({ projectId }).toArray();
    for (const i of is) {
      if (i.status !== "done" || !i.dueDate) continue;
      const done = i.completedAt?.slice(0, 10) ?? i.dueDate;
      out.push({ title: i.title, start: done, group: "Shipped", link: `${project.key}-${i.seq}`, status: "done" });
    }
  }
  if (want.has("target") && project.targetDate) {
    out.push({ title: `${project.name} target`, start: project.targetDate, kind: "milestone", group: "Milestones" });
  }
  return out;
}
