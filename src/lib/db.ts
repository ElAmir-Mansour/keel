import Dexie, { type EntityTable } from "dexie";
import type {
  Decision,
  Issue,
  IssueEvent,
  Milestone,
  Note,
  Person,
  Project,
  Risk,
  Setting,
  Update,
} from "./types";

// One IndexedDB database, one schema version list. Bump the version and add a
// new `.version(n).stores({...})` block for every schema change; Dexie applies
// them in order so older browsers upgrade cleanly. Never edit a shipped block.

export class KeelDB extends Dexie {
  projects!: EntityTable<Project, "id">;
  milestones!: EntityTable<Milestone, "id">;
  issues!: EntityTable<Issue, "id">;
  issueEvents!: EntityTable<IssueEvent, "id">;
  decisions!: EntityTable<Decision, "id">;
  notes!: EntityTable<Note, "id">;
  risks!: EntityTable<Risk, "id">;
  people!: EntityTable<Person, "id">;
  updates!: EntityTable<Update, "id">;
  settings!: EntityTable<Setting, "key">;

  constructor() {
    super("keel");
    this.version(1).stores({
      projects: "id, key, status, updatedAt",
      milestones: "id, projectId, status, dueDate, order",
      issues:
        "id, projectId, [projectId+seq], milestoneId, status, priority, assigneeId, dueDate, updatedAt, completedAt, createdAt",
      issueEvents: "id, issueId, projectId, at",
      decisions: "id, projectId, seq, status, date",
      notes: "id, projectId, personId, kind, folder, date, status, title, updatedAt",
      risks: "id, projectId, status, kind, updatedAt",
      people: "id, name",
      updates: "id, projectId, date",
      settings: "key",
    });
  }
}

export const db = new KeelDB();

export const TABLE_NAMES = [
  "projects",
  "milestones",
  "issues",
  "issueEvents",
  "decisions",
  "notes",
  "risks",
  "people",
  "updates",
  "settings",
] as const;
