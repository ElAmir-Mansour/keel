import Dexie, { type EntityTable } from "dexie";
import type {
  CodeLink,
  Cycle,
  Decision,
  Deletion,
  Embedding,
  Issue,
  IssueEvent,
  Milestone,
  Note,
  Person,
  Project,
  Risk,
  SavedView,
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
  deletions!: EntityTable<Deletion, "id">;
  embeddings!: EntityTable<Embedding, "id">;
  codeLinks!: EntityTable<CodeLink, "id">;
  cycles!: EntityTable<Cycle, "id">;
  views!: EntityTable<SavedView, "id">;

  constructor(name = "keel") {
    super(name);
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
    // v2: tombstones for sync, and people gain updatedAt.
    this.version(2)
      .stores({
        people: "id, name, updatedAt",
        deletions: "id, tbl, deletedAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table("people")
          .toCollection()
          .modify((p: { createdAt: string; updatedAt?: string }) => {
            if (!p.updatedAt) p.updatedAt = p.createdAt;
          });
      });
    // v3: the semantic index (device-local, rebuilt on demand).
    this.version(3).stores({
      embeddings: "id, recordId, kind, version",
    });
    // v4: pull requests and commits linked to issues (device-local, re-synced from GitHub).
    this.version(4).stores({
      codeLinks: "id, issueId, projectId, kind, updatedAt",
    });
    // v5: cycles with roll-over, saved views, and a cycle index on issues.
    this.version(5).stores({
      issues:
        "id, projectId, [projectId+seq], milestoneId, cycleId, status, priority, assigneeId, dueDate, updatedAt, completedAt, createdAt",
      cycles: "id, projectId, number, status, startDate, updatedAt",
      views: "id, projectId, updatedAt",
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
  "deletions",
  "embeddings",
  "codeLinks",
  "cycles",
  "views",
] as const;

/** Tables that take part in sync and backups (settings and tombstones are device-local). */
export const SYNCED_TABLES = [
  "projects",
  "milestones",
  "issues",
  "issueEvents",
  "decisions",
  "notes",
  "risks",
  "people",
  "updates",
  "cycles",
  "views",
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
