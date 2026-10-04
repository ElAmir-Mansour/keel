import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessStorage, shouldAskOnWrite } from "../persistence";
import { fmtBytes, primeLang } from "../i18n";
import type { Note } from "../types";

// The browser's answer about persistent storage, and what Settings makes of
// it. navigator.storage is faked per test; each test that touches the store
// imports a fresh copy of the module so its page-load state starts clean.

const NO_COPIES = { backupFolder: false, syncSignedIn: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("assessStorage", () => {
  it("says nothing until the browser has answered", () => {
    expect(assessStorage({ checked: false, supported: false, persisted: false }, NO_COPIES)).toEqual({ state: "checking", atRisk: false, canAsk: false });
  });

  it("warns when the browser may clear the data and nothing else holds a copy", () => {
    expect(assessStorage({ checked: true, supported: true, persisted: false }, NO_COPIES)).toEqual({ state: "best-effort", atRisk: true, canAsk: true });
  });

  it("does not warn when a backup folder or sync holds a copy, but still offers to ask", () => {
    expect(assessStorage({ checked: true, supported: true, persisted: false }, { backupFolder: true, syncSignedIn: false })).toEqual({ state: "best-effort", atRisk: false, canAsk: true });
    expect(assessStorage({ checked: true, supported: true, persisted: false }, { backupFolder: false, syncSignedIn: true })).toEqual({ state: "best-effort", atRisk: false, canAsk: true });
  });

  it("never warns once the data is persisted", () => {
    expect(assessStorage({ checked: true, supported: true, persisted: true }, NO_COPIES)).toEqual({ state: "persisted", atRisk: false, canAsk: false });
  });

  it("warns with nothing to ask when the browser has no persistence API", () => {
    expect(assessStorage({ checked: true, supported: false, persisted: false }, NO_COPIES)).toEqual({ state: "unsupported", atRisk: true, canAsk: false });
    expect(assessStorage({ checked: true, supported: false, persisted: false }, { backupFolder: true, syncSignedIn: false }).atRisk).toBe(false);
  });
});

describe("shouldAskOnWrite", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const daysAgo = (d: number) => new Date(now - d * 86400 * 1000).toISOString();

  it("asks when the browser could still agree", () => {
    expect(shouldAskOnWrite({ supported: true, persisted: false }, null, now)).toBe(true);
  });

  it("never asks when the data is already persisted or the browser cannot", () => {
    expect(shouldAskOnWrite({ supported: true, persisted: true }, null, now)).toBe(false);
    expect(shouldAskOnWrite({ supported: false, persisted: false }, null, now)).toBe(false);
  });

  it("waits a week after a refusal before asking on its own again", () => {
    expect(shouldAskOnWrite({ supported: true, persisted: false }, daysAgo(1), now)).toBe(false);
    expect(shouldAskOnWrite({ supported: true, persisted: false }, daysAgo(6.9), now)).toBe(false);
    expect(shouldAskOnWrite({ supported: true, persisted: false }, daysAgo(7), now)).toBe(true);
  });
});

describe("fmtBytes", () => {
  afterEach(() => primeLang("en"));

  it("uses decimal units, as the OS reports disk space", () => {
    expect(fmtBytes(0)).toBe("0 kB");
    expect(fmtBytes(5_242_880)).toBe("5.2 MB");
    expect(fmtBytes(1_073_741_824)).toBe("1.1 GB");
    expect(fmtBytes(120e9)).toBe("120 GB");
  });

  it("keeps Western digits in Arabic", () => {
    primeLang("ar");
    const s = fmtBytes(5_242_880);
    expect(s).toContain("5.2");
    expect(s).not.toMatch(/MB|[٠-٩]/);
  });
});

/** A fake navigator.storage that records how often persist() was called. */
function fakeStorage(o: { persisted?: boolean; grant?: boolean | "throw"; estimate?: StorageEstimate }) {
  let persisted = o.persisted ?? false;
  const calls = { persist: 0 };
  const storage = {
    persisted: async () => persisted,
    persist: async () => {
      calls.persist += 1;
      if (o.grant === "throw") throw new DOMException("Not allowed", "NotAllowedError");
      if (o.grant) persisted = true;
      return persisted;
    },
    estimate: async () => o.estimate ?? { usage: 0, quota: 0 },
  };
  vi.stubGlobal("navigator", { storage });
  return calls;
}

describe("the persistence store", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the state and the space used", async () => {
    fakeStorage({ persisted: false, estimate: { usage: 4_200_000, quota: 1_000_000_000 } });
    const { refreshPersistence } = await import("../persistence");
    expect(await refreshPersistence()).toEqual({ checked: true, supported: true, persisted: false, usage: 4_200_000, quota: 1_000_000_000 });
  });

  it("reports a grant and updates the state", async () => {
    const calls = fakeStorage({ grant: true });
    const { requestPersistence, refreshPersistence } = await import("../persistence");
    expect(await requestPersistence()).toBe(true);
    expect(calls.persist).toBe(1);
    expect((await refreshPersistence()).persisted).toBe(true);
  });

  it("treats a refusal as an answer, not an error", async () => {
    fakeStorage({ grant: false });
    const { requestPersistence } = await import("../persistence");
    await expect(requestPersistence()).resolves.toBe(false);
  });

  it("treats a browser that throws as a refusal", async () => {
    fakeStorage({ grant: "throw" });
    const { requestPersistence } = await import("../persistence");
    await expect(requestPersistence()).resolves.toBe(false);
  });

  it("is unsupported where navigator.storage is missing", async () => {
    vi.stubGlobal("navigator", {});
    const { refreshPersistence, requestPersistence } = await import("../persistence");
    expect(await refreshPersistence()).toEqual({ checked: true, supported: false, persisted: false, usage: null, quota: null });
    expect(await requestPersistence()).toBe(false);
  });

  describe("on the first write", () => {
    let n = 0;
    function note(): Note {
      n += 1;
      const at = new Date().toISOString();
      return { id: `persist-${Date.now()}-${n}`, kind: "page", folder: "Pages", title: `Note ${n}`, date: "2026-10-04", body: "", tags: [], pinned: false, createdAt: at, updatedAt: at };
    }

    let stored: Map<string, string>;
    beforeEach(() => {
      stored = new Map();
      vi.stubGlobal("window", globalThis);
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
        removeItem: (k: string) => void stored.delete(k),
      });
    });

    /** A fresh page load: new module state, same browser storage. */
    async function load() {
      vi.resetModules();
      const { bootPersistence } = await import("../persistence");
      const { db } = await import("../db");
      bootPersistence();
      return db;
    }

    it("asks once, and only when the workspace itself is written", async () => {
      const calls = fakeStorage({ grant: false });
      const { bootPersistence } = await import("../persistence");
      const { db } = await import("../db");
      bootPersistence();
      await sleep(10);
      expect(calls.persist).toBe(0);

      await db.settings.put({ key: "persist.test", value: 1 });
      await sleep(10);
      expect(calls.persist).toBe(0);

      const first = note();
      await db.notes.put(first);
      await vi.waitFor(() => expect(calls.persist).toBe(1));

      await db.notes.bulkPut([note(), note()]);
      await db.notes.update(first.id, { title: "Renamed" });
      await sleep(10);
      expect(calls.persist).toBe(1);
    });

    it("after a refusal, the next page load does not ask again on its own", async () => {
      const calls = fakeStorage({ grant: false });
      let db = await load();
      await db.notes.put(note());
      await vi.waitFor(() => expect(calls.persist).toBe(1));
      await vi.waitFor(() => expect(stored.has("keel.persistRefusedAt")).toBe(true));

      db = await load();
      await db.notes.put(note());
      await sleep(20);
      expect(calls.persist).toBe(1);
    });

    it("a grant clears the back-off", async () => {
      stored.set("keel.persistRefusedAt", new Date(Date.now() - 8 * 86400 * 1000).toISOString());
      const calls = fakeStorage({ grant: true });
      const db = await load();
      await db.notes.put(note());
      await vi.waitFor(() => expect(calls.persist).toBe(1));
      await vi.waitFor(() => expect(stored.has("keel.persistRefusedAt")).toBe(false));
    });

    it("does not ask when the browser already keeps the data", async () => {
      const calls = fakeStorage({ persisted: true });
      const { bootPersistence } = await import("../persistence");
      const { db } = await import("../db");
      bootPersistence();
      await db.notes.put(note());
      await sleep(20);
      expect(calls.persist).toBe(0);
    });
  });
});
