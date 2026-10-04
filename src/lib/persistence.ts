"use client";
import { useSyncExternalStore } from "react";
import { db, SYNCED_TABLES } from "@/lib/db";

// Persistent storage. Without it a browser may evict IndexedDB under storage
// pressure, so Keel asks once something worth keeping is written, and again
// from Settings when the person presses the button. Some browsers only agree
// after an install or regular visits, so a refusal is an expected answer.

export interface PersistenceStatus {
  /** False until the browser has been asked what it does. */
  checked: boolean;
  /** The browser offers navigator.storage.persist() here. */
  supported: boolean;
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

/** What Settings says about storage, given the other ways the data is kept. */
export interface StorageAssessment {
  state: "checking" | "unsupported" | "persisted" | "best-effort";
  /** The browser may clear the data and nothing else holds a copy. */
  atRisk: boolean;
  /** Asking the browser again could change the answer. */
  canAsk: boolean;
}

export function assessStorage(s: Pick<PersistenceStatus, "checked" | "supported" | "persisted">, copies: { backupFolder: boolean; syncSignedIn: boolean }): StorageAssessment {
  const unprotected = !copies.backupFolder && !copies.syncSignedIn;
  if (!s.checked) return { state: "checking", atRisk: false, canAsk: false };
  if (!s.supported) return { state: "unsupported", atRisk: unprotected, canAsk: false };
  if (s.persisted) return { state: "persisted", atRisk: false, canAsk: false };
  return { state: "best-effort", atRisk: unprotected, canAsk: true };
}

let status: PersistenceStatus = { checked: false, supported: false, persisted: false, usage: null, quota: null };
const SERVER: PersistenceStatus = { ...status };
const listeners = new Set<() => void>();
function set(patch: Partial<PersistenceStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export function usePersistence() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => SERVER,
  );
}

function manager(): StorageManager | null {
  // Absent outside a secure context, such as plain http on a LAN address.
  return typeof navigator !== "undefined" && navigator.storage ? navigator.storage : null;
}

/** Reads whether the data is persisted and how much space it uses. */
export async function refreshPersistence() {
  const sm = manager();
  const supported = !!sm && typeof sm.persist === "function" && typeof sm.persisted === "function";
  const [persisted, estimate] = await Promise.all([
    sm && supported ? sm.persisted().catch(() => false) : false,
    sm && typeof sm.estimate === "function" ? sm.estimate().catch(() => null) : null,
  ]);
  set({ checked: true, supported, persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null });
  return status;
}

/** Asks the browser to keep Keel's data. Resolves to whether it agreed; a refusal is not an error. */
export async function requestPersistence() {
  const sm = manager();
  if (!sm || typeof sm.persist !== "function") return false;
  let granted = false;
  try {
    granted = await sm.persist();
  } catch {
    granted = false;
  }
  await refreshPersistence();
  return granted || status.persisted;
}

const KEY_REFUSED = "keel.persistRefusedAt";
const BACK_OFF = 7 * 86400 * 1000;

/**
 * Whether a write should ask on its own. After a refusal the automatic ask
 * waits a week, so a browser that prompts (Firefox) does not prompt on every
 * visit; the Settings button always asks.
 */
export function shouldAskOnWrite(s: Pick<PersistenceStatus, "supported" | "persisted">, refusedAt: string | null, now = Date.now()) {
  if (!s.supported || s.persisted) return false;
  return !refusedAt || now - new Date(refusedAt).getTime() >= BACK_OFF;
}

function readRefusedAt() {
  try {
    return localStorage.getItem(KEY_REFUSED);
  } catch {
    return null;
  }
}

async function askOnWrite() {
  const s = status.checked ? status : await refreshPersistence();
  if (!shouldAskOnWrite(s, readRefusedAt())) return;
  const granted = await requestPersistence();
  try {
    if (granted) localStorage.removeItem(KEY_REFUSED);
    else localStorage.setItem(KEY_REFUSED, new Date().toISOString());
  } catch {
    /* private mode: ask again next time */
  }
}

let hooked = false;

/** Called once on app start: reads the state, then asks on the first write to the workspace. */
export function bootPersistence() {
  if (typeof window === "undefined") return;
  void refreshPersistence();
  if (hooked) return;
  hooked = true;
  const tables = SYNCED_TABLES.map((name) => db.table(name));
  let scheduled = false;
  const onWrite = () => {
    if (scheduled) return;
    scheduled = true;
    // Once per page load, outside the Dexie transaction, and right after the
    // click that caused the write, so a browser that asks the person asks then.
    setTimeout(() => {
      for (const tbl of tables) {
        tbl.hook.creating.unsubscribe(onWrite);
        tbl.hook.updating.unsubscribe(onWrite);
      }
      void askOnWrite();
    }, 0);
  };
  for (const tbl of tables) {
    tbl.hook("creating", onWrite);
    tbl.hook("updating", onWrite);
  }
}
