import { nanoid } from "nanoid";
import { db } from "./db";
import { nowISO, todayYMD } from "./dates";
import { noteFolder } from "./types";
import type {
  Cycle,
  Decision,
  Health,
  Issue,
  IssueStatus,
  Milestone,
  Note,
  Person,
  Project,
  Risk,
  SavedView,
  Timeline,
  TimelineEntry,
  Update,
} from "./types";

// Every write goes through here so the rules live in one place: per-project
// issue numbers, status transitions that record events and timestamps,
// updatedAt maintenance. Pages never touch db.* for writes.

const id = () => nanoid(12);

/** Record a tombstone so a delete reaches other devices on the next sync. */
async function tombstone(tbl: string, ids: string[]) {
  if (!ids.length) return;
  const deletedAt = nowISO();
  await db.deletions.bulkPut(ids.map((rid) => ({ id: rid, tbl, deletedAt })));
}

// ----- projects ------------------------------------------------------------

export async function createProject(
  input: Pick<Project, "name" | "key" | "color"> &
    Partial<Pick<Project, "description" | "targetDate" | "leadId" | "status">>,
) {
  const now = nowISO();
  const project: Project = {
    id: id(),
    name: input.name.trim(),
    key: normalizeKey(input.key),
    description: input.description ?? "",
    color: input.color,
    status: input.status ?? "active",
    targetDate: input.targetDate,
    leadId: input.leadId,
    createdAt: now,
    updatedAt: now,
  };
  await db.projects.add(project);
  return project;
}

export function normalizeKey(key: string) {
  return key
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export async function updateProject(pid: string, patch: Partial<Project>) {
  await db.projects.update(pid, { ...patch, updatedAt: nowISO() });
}

export async function deleteProject(pid: string) {
  await db.transaction(
    "rw",
    [
      db.projects,
      db.milestones,
      db.issues,
      db.issueEvents,
      db.decisions,
      db.notes,
      db.risks,
      db.updates,
      db.deletions,
      db.codeLinks,
      db.timelines,
    ],
    async () => {
      await db.codeLinks.where({ projectId: pid }).delete();
      for (const tbl of ["milestones", "issues", "issueEvents", "risks", "updates"] as const) {
        const ids = await db[tbl].where({ projectId: pid }).primaryKeys();
        await tombstone(tbl, ids as string[]);
        await db[tbl].where({ projectId: pid }).delete();
      }
      // Decisions and notes survive with the project link removed.
      await db.decisions
        .where({ projectId: pid })
        .modify({ projectId: undefined });
      await db.notes.where({ projectId: pid }).modify({ projectId: undefined });
      await db.timelines.where({ projectId: pid }).modify({ projectId: undefined, updatedAt: nowISO() });
      await tombstone("projects", [pid]);
      await db.projects.delete(pid);
    },
  );
}

// ----- milestones ----------------------------------------------------------

export async function createMilestone(
  input: Pick<Milestone, "projectId" | "title"> &
    Partial<Pick<Milestone, "description" | "startDate" | "dueDate" | "status">>,
) {
  const now = nowISO();
  const count = await db.milestones.where({ projectId: input.projectId }).count();
  const m: Milestone = {
    id: id(),
    projectId: input.projectId,
    title: input.title.trim(),
    description: input.description ?? "",
    startDate: input.startDate,
    dueDate: input.dueDate,
    status: input.status ?? "planned",
    order: count,
    createdAt: now,
    updatedAt: now,
  };
  await db.milestones.add(m);
  return m;
}

export async function updateMilestone(mid: string, patch: Partial<Milestone>) {
  await db.milestones.update(mid, { ...patch, updatedAt: nowISO() });
}

export async function deleteMilestone(mid: string) {
  await db.transaction("rw", [db.milestones, db.issues, db.deletions], async () => {
    await db.issues.where({ milestoneId: mid }).modify({ milestoneId: undefined, updatedAt: nowISO() });
    await tombstone("milestones", [mid]);
    await db.milestones.delete(mid);
  });
}

// ----- issues --------------------------------------------------------------

export async function createIssue(
  input: Pick<Issue, "projectId" | "title"> &
    Partial<
      Pick<
        Issue,
        | "description"
        | "status"
        | "priority"
        | "milestoneId"
        | "assigneeId"
        | "dueDate"
        | "estimate"
        | "labels"
      >
    > & { createdAt?: string },
) {
  return db.transaction("rw", [db.issues, db.issueEvents], async () => {
    const now = input.createdAt ?? nowISO();
    const last = await db.issues
      .where("[projectId+seq]")
      .between([input.projectId, 0], [input.projectId, Infinity])
      .last();
    const seq = (last?.seq ?? 0) + 1;
    const status = input.status ?? "triage";
    const count = await db.issues
      .where({ projectId: input.projectId, status })
      .count()
      .catch(() => 0);
    const issue: Issue = {
      id: id(),
      projectId: input.projectId,
      seq,
      milestoneId: input.milestoneId,
      title: input.title.trim(),
      description: input.description ?? "",
      status,
      priority: input.priority ?? "none",
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      estimate: input.estimate,
      labels: input.labels ?? [],
      order: count,
      startedAt: status === "in_progress" || status === "in_review" ? now : undefined,
      completedAt: status === "done" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await db.issues.add(issue);
    await db.issueEvents.add({
      id: id(),
      issueId: issue.id,
      projectId: issue.projectId,
      at: now,
      from: null,
      to: status,
    });
    return issue;
  });
}

export async function updateIssue(iid: string, patch: Partial<Issue>) {
  await db.issues.update(iid, { ...patch, updatedAt: nowISO() });
}

/** Move an issue to a new status, recording the transition and timestamps. */
export async function transitionIssue(
  iid: string,
  to: IssueStatus,
  opts: { at?: string; order?: number } = {},
) {
  await db.transaction("rw", [db.issues, db.issueEvents], async () => {
    const issue = await db.issues.get(iid);
    if (!issue) return;
    const at = opts.at ?? nowISO();
    const patch: Partial<Issue> = { status: to, updatedAt: at };
    if (opts.order !== undefined) patch.order = opts.order;
    if ((to === "in_progress" || to === "in_review") && !issue.startedAt) {
      patch.startedAt = at;
    }
    if (to === "done") patch.completedAt = at;
    if (issue.status === "done" && to !== "done") patch.completedAt = undefined;
    if (to !== "triage") patch.snoozedUntil = undefined;
    if (issue.status !== to) {
      await db.issueEvents.add({
        id: id(),
        issueId: iid,
        projectId: issue.projectId,
        at,
        from: issue.status,
        to,
      });
    }
    await db.issues.update(iid, patch);
  });
}

export async function deleteIssue(iid: string) {
  await db.transaction("rw", [db.issues, db.issueEvents, db.deletions, db.codeLinks], async () => {
    await db.codeLinks.where({ issueId: iid }).delete();
    const eventIds = (await db.issueEvents.where({ issueId: iid }).primaryKeys()) as string[];
    await tombstone("issueEvents", eventIds);
    await db.issueEvents.where({ issueId: iid }).delete();
    await tombstone("issues", [iid]);
    await db.issues.delete(iid);
  });
}

export async function snoozeIssue(iid: string, until: Date) {
  await db.issues.update(iid, {
    snoozedUntil: until.toISOString(),
    updatedAt: nowISO(),
  });
}

/** Create one issue per non-empty line; "- " and "* " prefixes are stripped. */
export async function createIssuesFromLines(projectId: string, text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const created: Issue[] = [];
  for (const line of lines) created.push(await createIssue({ projectId, title: line }));
  return created;
}

// ----- decisions -----------------------------------------------------------

export async function createDecision(
  input: Pick<Decision, "title"> &
    Partial<
      Pick<
        Decision,
        | "projectId"
        | "status"
        | "date"
        | "context"
        | "decision"
        | "consequences"
        | "alternatives"
        | "tags"
      >
    >,
) {
  return db.transaction("rw", db.decisions, async () => {
    const now = nowISO();
    const last = await db.decisions.orderBy("seq").last();
    const d: Decision = {
      id: id(),
      projectId: input.projectId,
      seq: (last?.seq ?? 0) + 1,
      title: input.title.trim() || "Untitled decision",
      status: input.status ?? "proposed",
      date: input.date ?? todayYMD(),
      context: input.context ?? "",
      decision: input.decision ?? "",
      consequences: input.consequences ?? "",
      alternatives: input.alternatives ?? "",
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await db.decisions.add(d);
    return d;
  });
}

export async function updateDecision(did: string, patch: Partial<Decision>) {
  await db.decisions.update(did, { ...patch, updatedAt: nowISO() });
}

export async function deleteDecision(did: string) {
  await db.transaction("rw", [db.decisions, db.deletions], async () => {
    await tombstone("decisions", [did]);
    await db.decisions.delete(did);
  });
}

// ----- notes ---------------------------------------------------------------

export async function createNote(
  input: Partial<
    Pick<
      Note,
      | "projectId"
      | "personId"
      | "kind"
      | "folder"
      | "title"
      | "date"
      | "status"
      | "body"
      | "tags"
      | "pinned"
    >
  >,
) {
  const now = nowISO();
  const kind = input.kind ?? "page";
  const n: Note = {
    id: id(),
    projectId: input.projectId,
    personId: input.personId,
    kind,
    folder: input.folder ?? noteFolder(kind),
    title: (input.title ?? "").trim() || "Untitled",
    date: input.date ?? todayYMD(),
    status: input.status,
    body: input.body ?? "",
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(n);
  return n;
}

/** Keep a version when the text changes, at most one per five minutes, fifty per note. */
const VERSION_GAP_MS = 5 * 60 * 1000;
const VERSIONS_KEPT = 50;

export async function updateNote(nid: string, patch: Partial<Note>) {
  await db.transaction("rw", [db.notes, db.noteVersions, db.deletions], async () => {
    const before = await db.notes.get(nid);
    const now = nowISO();
    if (before && ((patch.body !== undefined && patch.body !== before.body) || (patch.title !== undefined && patch.title !== before.title))) {
      const last = await db.noteVersions.where({ noteId: nid }).reverse().sortBy("savedAt");
      const recent = last[0];
      if (!recent || Date.parse(now) - Date.parse(recent.savedAt) > VERSION_GAP_MS) {
        await db.noteVersions.add({ id: id(), noteId: nid, title: before.title, body: before.body, savedAt: now, updatedAt: now });
        const extra = last.slice(VERSIONS_KEPT - 1);
        if (extra.length) {
          await tombstone("noteVersions", extra.map((v) => v.id));
          await db.noteVersions.bulkDelete(extra.map((v) => v.id));
        }
      }
    }
    await db.notes.update(nid, { ...patch, updatedAt: now });
  });
}

/** Put an old version back; the current text is kept as a version first. */
export async function restoreNoteVersion(vid: string) {
  const v = await db.noteVersions.get(vid);
  if (!v) return;
  await db.transaction("rw", [db.notes, db.noteVersions, db.deletions], async () => {
    const cur = await db.notes.get(v.noteId);
    if (!cur) return;
    const now = nowISO();
    await db.noteVersions.add({ id: id(), noteId: v.noteId, title: cur.title, body: cur.body, savedAt: now, updatedAt: now });
    await db.notes.update(v.noteId, { title: v.title, body: v.body, updatedAt: now });
  });
}

export async function deleteNote(nid: string) {
  await db.transaction("rw", [db.notes, db.noteVersions, db.deletions], async () => {
    const versions = (await db.noteVersions.where({ noteId: nid }).primaryKeys()) as string[];
    await tombstone("noteVersions", versions);
    await db.noteVersions.where({ noteId: nid }).delete();
    await tombstone("notes", [nid]);
    await db.notes.delete(nid);
  });
}

/** Return today's daily note, creating it if missing. */
export async function getOrCreateDailyNote(date = todayYMD()) {
  const existing = await db.notes.where({ kind: "daily", date }).first();
  if (existing) return existing;
  return createNote({ kind: "daily", date, title: date, body: "" });
}

// ----- risks ---------------------------------------------------------------

export async function createRisk(
  input: Pick<Risk, "projectId" | "title"> &
    Partial<
      Pick<
        Risk,
        | "kind"
        | "description"
        | "likelihood"
        | "impact"
        | "status"
        | "ownerId"
        | "mitigation"
        | "dueDate"
      >
    >,
) {
  return db.transaction("rw", db.risks, async () => {
    const now = nowISO();
    const all = await db.risks.where({ projectId: input.projectId }).toArray();
    const seq = all.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
    const r: Risk = {
      id: id(),
      projectId: input.projectId,
      seq,
      kind: input.kind ?? "risk",
      title: input.title.trim(),
      description: input.description ?? "",
      likelihood: input.likelihood ?? 3,
      impact: input.impact ?? 3,
      status: input.status ?? "open",
      ownerId: input.ownerId,
      mitigation: input.mitigation ?? "",
      dueDate: input.dueDate,
      createdAt: now,
      updatedAt: now,
    };
    await db.risks.add(r);
    return r;
  });
}

export async function updateRisk(rid: string, patch: Partial<Risk>) {
  await db.risks.update(rid, { ...patch, updatedAt: nowISO() });
}

export async function deleteRisk(rid: string) {
  await db.transaction("rw", [db.risks, db.deletions], async () => {
    await tombstone("risks", [rid]);
    await db.risks.delete(rid);
  });
}

// ----- people --------------------------------------------------------------

export async function createPerson(
  input: Pick<Person, "name"> & Partial<Pick<Person, "role" | "email" | "color">>,
) {
  const now = nowISO();
  const p: Person = {
    id: id(),
    name: input.name.trim(),
    role: input.role ?? "",
    email: input.email,
    color: input.color ?? "#2a78d6",
    createdAt: now,
    updatedAt: now,
  };
  await db.people.add(p);
  return p;
}

export async function updatePerson(pid: string, patch: Partial<Person>) {
  await db.people.update(pid, { ...patch, updatedAt: nowISO() });
}

export async function deletePerson(pid: string) {
  await db.transaction("rw", [db.people, db.issues, db.risks, db.projects, db.deletions], async () => {
    const now = nowISO();
    await db.issues.where({ assigneeId: pid }).modify({ assigneeId: undefined, updatedAt: now });
    await db.risks.where({ ownerId: pid }).modify({ ownerId: undefined, updatedAt: now });
    await db.projects.where({ leadId: pid }).modify({ leadId: undefined, updatedAt: now });
    await tombstone("people", [pid]);
    await db.people.delete(pid);
  });
}

// ----- updates (weekly health) --------------------------------------------

export async function postUpdate(input: {
  projectId: string;
  health: Health;
  summary: string;
  date?: string;
}) {
  const u: Update = {
    id: id(),
    projectId: input.projectId,
    date: input.date ?? todayYMD(),
    health: input.health,
    summary: input.summary,
    createdAt: nowISO(),
  };
  await db.updates.add(u);
  return u;
}

export async function deleteUpdate(uid: string) {
  await db.transaction("rw", [db.updates, db.deletions], async () => {
    await tombstone("updates", [uid]);
    await db.updates.delete(uid);
  });
}

// ----- settings ------------------------------------------------------------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

// ----- cycles --------------------------------------------------------------

export async function createCycle(input: Pick<Cycle, "projectId" | "startDate" | "endDate"> & Partial<Pick<Cycle, "status" | "number">>) {
  return db.transaction("rw", db.cycles, async () => {
    const now = nowISO();
    const last = await db.cycles.where({ projectId: input.projectId }).toArray();
    const number = input.number ?? last.reduce((m, c) => Math.max(m, c.number), 0) + 1;
    const c: Cycle = { id: id(), projectId: input.projectId, number, startDate: input.startDate, endDate: input.endDate, status: input.status ?? "upcoming", createdAt: now, updatedAt: now };
    await db.cycles.add(c);
    return c;
  });
}

export async function updateCycle(cid: string, patch: Partial<Cycle>) {
  await db.cycles.update(cid, { ...patch, updatedAt: nowISO() });
}

export async function deleteCycle(cid: string) {
  await db.transaction("rw", [db.cycles, db.issues, db.deletions], async () => {
    await db.issues.where({ cycleId: cid }).modify({ cycleId: undefined, updatedAt: nowISO() });
    await tombstone("cycles", [cid]);
    await db.cycles.delete(cid);
  });
}

// ----- saved views ----------------------------------------------------------

export async function saveView(input: Pick<SavedView, "name" | "params"> & { projectId?: string }) {
  const now = nowISO();
  const v: SavedView = { id: id(), projectId: input.projectId, name: input.name.trim() || "Untitled view", params: input.params, createdAt: now, updatedAt: now };
  await db.views.add(v);
  return v;
}

export async function deleteView(vid: string) {
  await db.transaction("rw", [db.views, db.deletions], async () => {
    await tombstone("views", [vid]);
    await db.views.delete(vid);
  });
}

// ----- timelines ------------------------------------------------------------

/** Entries with ids and trimmed titles, in date order; invalid dates are dropped. */
export function normalizeEntries(entries: Partial<TimelineEntry>[]): TimelineEntry[] {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const out: TimelineEntry[] = [];
  for (const e of entries) {
    const title = (e.title ?? "").trim();
    const start = (e.start ?? "").trim();
    if (!title || !ymd.test(start)) continue;
    let end = (e.end ?? "").trim() || undefined;
    if (end && (!ymd.test(end) || end < start)) end = undefined;
    const entry: TimelineEntry = { id: e.id || id(), title, start };
    if (end) entry.end = end;
    const group = (e.group ?? "").trim();
    if (group) entry.group = group;
    if (e.kind === "milestone") entry.kind = "milestone";
    if (e.status === "done" || e.status === "active" || e.status === "planned") entry.status = e.status;
    const note = (e.note ?? "").trim();
    if (note) entry.note = note;
    const link = (e.link ?? "").trim();
    if (link) entry.link = link;
    out.push(entry);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

export async function createTimeline(input: Pick<Timeline, "title"> & Partial<Pick<Timeline, "projectId" | "description" | "from" | "to">> & { entries?: Partial<TimelineEntry>[] }) {
  const now = nowISO();
  const tl: Timeline = {
    id: id(),
    projectId: input.projectId,
    title: input.title.trim() || "Untitled timeline",
    description: input.description ?? "",
    entries: normalizeEntries(input.entries ?? []),
    from: input.from,
    to: input.to,
    createdAt: now,
    updatedAt: now,
  };
  await db.timelines.add(tl);
  return tl;
}

export async function updateTimeline(tid: string, patch: Partial<Timeline>) {
  const next = { ...patch, updatedAt: nowISO() };
  if (patch.entries) next.entries = normalizeEntries(patch.entries);
  await db.timelines.update(tid, next);
}

/** Append entries; an entry with the same title and start as an existing one updates it instead. */
export async function addTimelineEntries(tid: string, entries: Partial<TimelineEntry>[]) {
  return db.transaction("rw", db.timelines, async () => {
    const tl = await db.timelines.get(tid);
    if (!tl) throw new Error("Timeline not found");
    const merged = [...tl.entries];
    let added = 0;
    for (const e of normalizeEntries(entries)) {
      const idx = merged.findIndex((x) => x.title.toLowerCase() === e.title.toLowerCase() && x.start === e.start);
      if (idx >= 0) merged[idx] = { ...merged[idx], ...e, id: merged[idx].id };
      else {
        merged.push(e);
        added += 1;
      }
    }
    await db.timelines.update(tid, { entries: normalizeEntries(merged), updatedAt: nowISO() });
    return { added, updated: entries.length - added };
  });
}

export async function deleteTimeline(tid: string) {
  await db.transaction("rw", [db.timelines, db.deletions], async () => {
    await tombstone("timelines", [tid]);
    await db.timelines.delete(tid);
  });
}
