import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KeelDB } from "../db";
import { pendingChanges, sameContent, syncOnce } from "../sync/engine";
import { MemoryAdapter } from "../sync/memory-adapter";
import type { Note, Person } from "../types";

// Two devices, one remote. Each test builds fresh databases so the
// fake IndexedDB never leaks state between cases.

let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A fresh wall-clock stamp, strictly after any earlier call. */
async function now() {
  await sleep(3);
  return new Date().toISOString();
}
function device() {
  n += 1;
  return new KeelDB(`keel-test-${Date.now()}-${n}`);
}

function note(id: string, title: string, updatedAt: string): Note {
  return { id, kind: "page", folder: "Pages", title, date: "2026-09-27", body: "", tags: [], pinned: false, createdAt: updatedAt, updatedAt };
}

async function addNote(d: KeelDB, nt: Note) {
  await d.notes.put(nt);
}

async function tombstone(d: KeelDB, id: string, deletedAt: string) {
  await d.deletions.put({ id, tbl: "notes", deletedAt });
}

function person(id: string, name: string, role: string, updatedAt: string): Person {
  return { id, name, role, color: "#888", createdAt: "2026-09-01T00:00:00.000Z", updatedAt };
}

/** Edit a note's text the way the editor does: same record, new stamp. */
async function editNote(d: KeelDB, id: string, patch: Partial<Note>) {
  await d.notes.update(id, { ...patch, updatedAt: await now() });
}

async function conflictVersions(d: KeelDB, noteId: string) {
  return (await d.noteVersions.where({ noteId }).toArray()).filter((v) => v.label === "sync-conflict");
}

describe("syncOnce", () => {
  let remote: MemoryAdapter;
  beforeEach(() => {
    remote = new MemoryAdapter();
  });

  it("pushes local records and pulls them on another device", async () => {
    const a = device();
    const b = device();
    await addNote(a, note("n1", "From A", await now()));
    const r1 = await syncOnce(remote, a);
    expect(r1.pushed).toBe(1);
    const r2 = await syncOnce(remote, b);
    expect(r2.applied).toBe(1);
    expect((await b.notes.get("n1"))?.title).toBe("From A");
    // Nothing left to push on either side.
    expect(await pendingChanges(a)).toBe(0);
    expect(await pendingChanges(b)).toBe(0);
  });

  it("last write wins on conflicting edits", async () => {
    const a = device();
    const b = device();
    await addNote(a, note("n1", "v1", await now()));
    await syncOnce(remote, a);
    await syncOnce(remote, b);
    await addNote(a, note("n1", "older edit", await now()));
    await addNote(b, note("n1", "newer edit", await now()));
    await syncOnce(remote, a);
    await syncOnce(remote, b);
    await syncOnce(remote, a);
    expect((await a.notes.get("n1"))?.title).toBe("newer edit");
    expect((await b.notes.get("n1"))?.title).toBe("newer edit");
  });

  it("propagates deletes through tombstones and prunes them", async () => {
    const a = device();
    const b = device();
    await addNote(a, note("n1", "doomed", await now()));
    await syncOnce(remote, a);
    await syncOnce(remote, b);
    await a.notes.delete("n1");
    await tombstone(a, "n1", await now());
    await syncOnce(remote, a);
    expect(await a.deletions.count()).toBe(0);
    await syncOnce(remote, b);
    expect(await b.notes.get("n1")).toBeUndefined();
  });

  it("keeps a newer local edit over an older remote delete", async () => {
    const a = device();
    const b = device();
    await addNote(a, note("n1", "keep me", await now()));
    await syncOnce(remote, a);
    await syncOnce(remote, b);
    await b.notes.delete("n1");
    await tombstone(b, "n1", await now());
    await syncOnce(remote, b);
    await addNote(a, note("n1", "edited later", await now()));
    await syncOnce(remote, a);
    await syncOnce(remote, b);
    expect((await b.notes.get("n1"))?.title).toBe("edited later");
  });

  it("a push that fails is retried in full on the next sync", async () => {
    const a = device();
    const b = device();
    await addNote(a, note("n1", "First", await now()));
    await syncOnce(remote, a);
    await editNote(a, "n1", { title: "Edited offline" });
    const realPush = remote.push.bind(remote);
    remote.push = async () => {
      throw new Error("network down");
    };
    await expect(syncOnce(remote, a)).rejects.toThrow("network down");
    // The edit never reached the remote, so it is still waiting to go.
    expect(await pendingChanges(a)).toBe(1);
    remote.push = realPush;
    const r = await syncOnce(remote, a);
    expect(r.pushed).toBe(1);
    await syncOnce(remote, b);
    expect((await b.notes.get("n1"))?.title).toBe("Edited offline");
  });

  it("a crash after the push but before the cursors are saved makes no false conflict", async () => {
    const a = device();
    await addNote(a, note("n1", "First", await now()));
    await syncOnce(remote, a);
    await editNote(a, "n1", { title: "Second" });
    const realBulkPut = a.settings.bulkPut.bind(a.settings);
    a.settings.bulkPut = (async () => {
      throw new Error("tab closed");
    }) as unknown as typeof a.settings.bulkPut;
    await expect(syncOnce(remote, a)).rejects.toThrow("tab closed");
    a.settings.bulkPut = realBulkPut;
    // The next pull brings our own pushed copy back; it is not a conflict.
    const r = await syncOnce(remote, a);
    expect(r.conflicts).toBe(0);
    expect(await a.syncConflicts.count()).toBe(0);
    expect(await conflictVersions(a, "n1")).toHaveLength(0);
    expect((await a.notes.get("n1"))?.title).toBe("Second");
  });

  it("is idempotent when nothing changed", async () => {
    const a = device();
    await addNote(a, note("n1", "x", await now()));
    await syncOnce(remote, a);
    await sleep(3);
    const r = await syncOnce(remote, a);
    expect(r.pushed).toBe(0);
    expect(r.applied).toBe(0);
  });
});

describe("sync conflicts", () => {
  let remote: MemoryAdapter;
  let a: KeelDB;
  let b: KeelDB;
  /** Both devices hold the same note n1, fully synced. */
  beforeEach(async () => {
    remote = new MemoryAdapter();
    a = device();
    b = device();
    await addNote(a, { ...note("n1", "Plan", await now()), body: "first draft" });
    await syncOnce(remote, a);
    await syncOnce(remote, b);
  });

  it("a one-sided change gives no conflict", async () => {
    await editNote(a, "n1", { body: "edited on A" });
    expect((await syncOnce(remote, a)).conflicts).toBe(0);
    // A edits again after its own push: the echo of that push is not a remote change.
    await editNote(a, "n1", { body: "edited on A again" });
    expect((await syncOnce(remote, a)).conflicts).toBe(0);
    expect((await syncOnce(remote, b)).conflicts).toBe(0);
    expect((await syncOnce(remote, a)).conflicts).toBe(0);
    expect((await b.notes.get("n1"))?.body).toBe("edited on A again");
    expect(await a.syncConflicts.count()).toBe(0);
    expect(await b.syncConflicts.count()).toBe(0);
    expect(await conflictVersions(b, "n1")).toHaveLength(0);
  });

  it("a two-sided change keeps the losing remote copy in note history", async () => {
    await editNote(a, "n1", { body: "older edit on A" });
    await editNote(b, "n1", { body: "newer edit on B" });
    expect((await syncOnce(remote, a)).conflicts).toBe(0);
    // B's own edit is newer and wins; A's text would have been overwritten.
    const r = await syncOnce(remote, b);
    expect(r.conflicts).toBe(1);
    expect((await b.notes.get("n1"))?.body).toBe("newer edit on B");
    const [kept] = await conflictVersions(b, "n1");
    expect(kept.body).toBe("older edit on A");
    const [conflict] = await b.syncConflicts.toArray();
    expect(conflict).toMatchObject({ tbl: "notes", recordId: "n1", title: "Plan", versionId: kept.id });
    expect(conflict.data).toBeUndefined();
    // The kept copy travels with the same sync, so it is not left waiting.
    expect(await pendingChanges(b)).toBe(0);
    // A takes B's edit without a second conflict, and receives the kept copy.
    expect((await syncOnce(remote, a)).conflicts).toBe(0);
    expect((await a.notes.get("n1"))?.body).toBe("newer edit on B");
    expect((await conflictVersions(a, "n1")).map((v) => v.body)).toEqual(["older edit on A"]);
    expect(await a.syncConflicts.count()).toBe(1);
  });

  it("a two-sided change keeps the losing local copy when the remote is newer", async () => {
    await editNote(b, "n1", { body: "older edit on B" });
    await editNote(a, "n1", { body: "newer edit on A" });
    await syncOnce(remote, a);
    const r = await syncOnce(remote, b);
    expect(r.conflicts).toBe(1);
    expect((await b.notes.get("n1"))?.body).toBe("newer edit on A");
    expect((await conflictVersions(b, "n1")).map((v) => v.body)).toEqual(["older edit on B"]);
  });

  it("a two-sided change to any other record keeps the loser as a conflict record", async () => {
    await a.people.put(person("p1", "Sara", "Engineer", await now()));
    await syncOnce(remote, a);
    await syncOnce(remote, b);
    await a.people.put(person("p1", "Sara", "Tech lead", await now()));
    await b.people.put(person("p1", "Sara", "Staff engineer", await now()));
    await syncOnce(remote, a);
    expect((await syncOnce(remote, b)).conflicts).toBe(1);
    expect((await b.people.get("p1"))?.role).toBe("Staff engineer");
    const [conflict] = await b.syncConflicts.toArray();
    expect(conflict).toMatchObject({ tbl: "people", recordId: "p1", title: "Sara" });
    expect((conflict.data as unknown as Person).role).toBe("Tech lead");
  });

  it("an edit that loses to a newer delete is kept", async () => {
    await editNote(a, "n1", { body: "edited on A" });
    await b.notes.delete("n1");
    await tombstone(b, "n1", await now());
    await syncOnce(remote, b);
    expect((await syncOnce(remote, a)).conflicts).toBe(1);
    expect(await a.notes.get("n1")).toBeUndefined();
    const [conflict] = await a.syncConflicts.toArray();
    expect(conflict.winnerDeleted).toBe(true);
    expect((conflict.data as unknown as Note).body).toBe("edited on A");
  });

  it("identical content on both sides gives no conflict", async () => {
    await editNote(a, "n1", { body: "same words" });
    await editNote(b, "n1", { body: "same words" });
    await syncOnce(remote, a);
    expect((await syncOnce(remote, b)).conflicts).toBe(0);
    expect((await syncOnce(remote, a)).conflicts).toBe(0);
    expect(await a.syncConflicts.count()).toBe(0);
    expect(await b.syncConflicts.count()).toBe(0);
    expect(await conflictVersions(b, "n1")).toHaveLength(0);
  });
});

describe("sameContent", () => {
  it("ignores the version stamp, key order and undefined fields", () => {
    expect(sameContent({ id: "x", title: "T", tags: ["a"], updatedAt: "1" }, { tags: ["a"], updatedAt: "2", title: "T", id: "x", status: undefined })).toBe(true);
    expect(sameContent({ id: "x", title: "T" }, { id: "x", title: "U" })).toBe(false);
    expect(sameContent({ id: "x", tags: ["a", "b"] }, { id: "x", tags: ["b", "a"] })).toBe(false);
  });

  it("treats a missing copy as a delete", () => {
    expect(sameContent(null, null)).toBe(true);
    expect(sameContent({ id: "x" }, null)).toBe(false);
  });
});
