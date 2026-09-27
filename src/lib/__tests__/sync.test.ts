import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KeelDB } from "../db";
import { pendingChanges, syncOnce } from "../sync/engine";
import { MemoryAdapter } from "../sync/memory-adapter";
import type { Note } from "../types";

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
