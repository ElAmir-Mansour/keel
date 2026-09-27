import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { PROJECT_COLORS, type Issue, type IssueEvent, type IssueStatus, type Milestone, type Note, type Person, type Project } from "@/lib/types";
import type { ImportPlan } from "./common";
import type { ObsidianPlan } from "./obsidian";

// Writes a plan in one transaction. Projects and people are matched by name
// (or key) against what exists; issue numbers from the source are kept when
// free, otherwise the next free number is used. A status history is
// synthesised from the timestamps so the charts have something honest.

const id = () => nanoid(12);

export interface ApplyResult {
  projects: number;
  people: number;
  milestones: number;
  issues: number;
  notes: number;
  updatedNotes: number;
}

export async function applyIssuePlan(plan: ImportPlan): Promise<ApplyResult> {
  const result: ApplyResult = { projects: 0, people: 0, milestones: 0, issues: 0, notes: 0, updatedNotes: 0 };
  const now = new Date().toISOString();
  await db.transaction("rw", [db.projects, db.people, db.milestones, db.issues, db.issueEvents, db.settings], async () => {
    const projects = await db.projects.toArray();
    const people = await db.people.toArray();
    const byName = new Map<string, Project>();
    for (const p of projects) {
      byName.set(p.name.toLowerCase(), p);
      byName.set(p.key.toLowerCase(), p);
    }
    const peopleByName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
    const usedKeys = new Set(projects.map((p) => p.key));
    const newProjects: Project[] = [];
    const newPeople: Person[] = [];
    const newMilestones: Milestone[] = [];
    const newIssues: Issue[] = [];
    const newEvents: IssueEvent[] = [];
    const milestonesByProject = new Map<string, Map<string, Milestone>>();
    const seqByProject = new Map<string, Set<number>>();

    async function projectFor(name: string, key?: string): Promise<Project> {
      const hit = byName.get(name.toLowerCase()) ?? (key ? byName.get(key.toLowerCase()) : undefined);
      if (hit) return hit;
      let k = (key ?? name.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PROJ";
      let i = 2;
      while (usedKeys.has(k)) k = `${k.slice(0, 5)}${i++}`;
      usedKeys.add(k);
      const p: Project = {
        id: id(),
        key: k,
        name,
        description: "",
        color: PROJECT_COLORS[(projects.length + newProjects.length) % PROJECT_COLORS.length],
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      newProjects.push(p);
      byName.set(name.toLowerCase(), p);
      byName.set(k.toLowerCase(), p);
      return p;
    }

    function personFor(name: string): Person {
      const hit = peopleByName.get(name.toLowerCase());
      if (hit) return hit;
      const p: Person = { id: id(), name, role: "", color: PROJECT_COLORS[(people.length + newPeople.length) % PROJECT_COLORS.length], createdAt: now, updatedAt: now };
      newPeople.push(p);
      peopleByName.set(name.toLowerCase(), p);
      return p;
    }

    async function milestoneFor(project: Project, title: string): Promise<Milestone> {
      let map = milestonesByProject.get(project.id);
      if (!map) {
        map = new Map((await db.milestones.where({ projectId: project.id }).toArray()).map((m) => [m.title.toLowerCase(), m]));
        milestonesByProject.set(project.id, map);
      }
      const hit = map.get(title.toLowerCase());
      if (hit) return hit;
      const m: Milestone = { id: id(), projectId: project.id, title, description: "", status: "active", order: map.size, createdAt: now, updatedAt: now };
      map.set(title.toLowerCase(), m);
      newMilestones.push(m);
      return m;
    }

    async function nextSeq(project: Project, wanted?: number) {
      let used = seqByProject.get(project.id);
      if (!used) {
        used = new Set((await db.issues.where({ projectId: project.id }).toArray()).map((i) => i.seq));
        seqByProject.set(project.id, used);
      }
      if (wanted && !used.has(wanted)) {
        used.add(wanted);
        return wanted;
      }
      let s = used.size ? Math.max(...used) + 1 : 1;
      while (used.has(s)) s += 1;
      used.add(s);
      return s;
    }

    for (const it of plan.issues) {
      const project = await projectFor(it.projectName, it.projectKey);
      const assignee = it.assignee ? personFor(it.assignee) : undefined;
      const milestone = it.milestone ? await milestoneFor(project, it.milestone) : undefined;
      const seq = await nextSeq(project, it.seq);
      const startedAt = it.startedAt ?? (it.status === "in_progress" || it.status === "in_review" || it.status === "done" ? it.completedAt ?? it.updatedAt : undefined);
      const issue: Issue = {
        id: id(),
        projectId: project.id,
        seq,
        milestoneId: milestone?.id,
        title: it.title,
        description: it.description,
        status: it.status,
        priority: it.priority,
        assigneeId: assignee?.id,
        dueDate: it.dueDate,
        estimate: it.estimate,
        labels: it.labels,
        order: seq,
        startedAt: it.status === "done" || it.status === "in_progress" || it.status === "in_review" ? startedAt : undefined,
        completedAt: it.status === "done" ? it.completedAt ?? it.updatedAt : undefined,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      };
      newIssues.push(issue);
      // Synthesised history: created → (started) → final.
      const path: { at: string; to: IssueStatus }[] = [{ at: it.createdAt, to: it.status === "triage" ? "triage" : "backlog" }];
      if (issue.startedAt && it.status !== "cancelled") path.push({ at: issue.startedAt, to: "in_progress" });
      if (it.status === "done") path.push({ at: issue.completedAt ?? it.updatedAt, to: "done" });
      else if (it.status === "cancelled") path.push({ at: it.cancelledAt ?? it.updatedAt, to: "cancelled" });
      else if (it.status !== "backlog" && it.status !== "triage" && it.status !== "in_progress") path.push({ at: it.updatedAt, to: it.status });
      let prev: IssueStatus | null = null;
      for (const step of path) {
        if (step.to === prev) continue;
        newEvents.push({ id: id(), issueId: issue.id, projectId: project.id, at: step.at, from: prev, to: step.to });
        prev = step.to;
      }
    }

    await db.projects.bulkAdd(newProjects);
    await db.people.bulkAdd(newPeople);
    await db.milestones.bulkAdd(newMilestones);
    await db.issues.bulkAdd(newIssues);
    await db.issueEvents.bulkAdd(newEvents);
    await db.settings.where("key").startsWith("sync.cursor").delete();
    result.projects = newProjects.length;
    result.people = newPeople.length;
    result.milestones = newMilestones.length;
    result.issues = newIssues.length;
  });
  return result;
}

export async function applyObsidianPlan(plan: ObsidianPlan, mode: "skip" | "overwrite"): Promise<ApplyResult> {
  const result: ApplyResult = { projects: 0, people: 0, milestones: 0, issues: 0, notes: 0, updatedNotes: 0 };
  await db.transaction("rw", [db.notes, db.settings], async () => {
    const existing = new Map((await db.notes.toArray()).map((n) => [n.title.toLowerCase(), n]));
    const adds: Note[] = [];
    for (const n of plan.notes) {
      const hit = existing.get(n.title.toLowerCase());
      if (hit) {
        if (mode === "overwrite") {
          await db.notes.update(hit.id, { ...n, createdAt: hit.createdAt, updatedAt: new Date().toISOString() });
          result.updatedNotes += 1;
        }
        continue;
      }
      const note: Note = { id: id(), ...n };
      existing.set(note.title.toLowerCase(), note);
      adds.push(note);
    }
    await db.notes.bulkAdd(adds);
    await db.settings.where("key").startsWith("sync.cursor").delete();
    result.notes = adds.length;
  });
  return result;
}
