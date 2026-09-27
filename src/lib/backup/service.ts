"use client";
import { useSyncExternalStore } from "react";
import { db } from "@/lib/db";
import { exportAll } from "@/lib/export";

// Automatic backups into a folder the person picks once. Uses the File
// System Access API where it exists (Chromium); elsewhere the settings page
// falls back to a reminder and the manual export.

type Perm = "granted" | "denied" | "prompt";
interface DirHandle {
  name: string;
  queryPermission(o: { mode: "readwrite" }): Promise<Perm>;
  requestPermission(o: { mode: "readwrite" }): Promise<Perm>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}
type PickerWindow = Window & { showDirectoryPicker?: (o: { mode: "readwrite"; id?: string }) => Promise<DirHandle> };

const KEY_HANDLE = "backup.handle";
const KEY_INTERVAL = "backup.intervalHours";
const KEY_KEEP = "backup.keep";
const KEY_LAST = "backup.lastAt";
const PREFIX = "keel-backup-";

export interface BackupStatus {
  supported: boolean;
  folder: string | null;
  permission: Perm | null;
  intervalHours: number;
  keep: number;
  lastAt: string | null;
  lastError: string | null;
  running: boolean;
}

let status: BackupStatus = { supported: false, folder: null, permission: null, intervalHours: 24, keep: 7, lastAt: null, lastError: null, running: false };
const SERVER: BackupStatus = { ...status };
const listeners = new Set<() => void>();
function set(patch: Partial<BackupStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}
export function useBackupStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => SERVER,
  );
}

export function isSupported() {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

async function getHandle(): Promise<DirHandle | null> {
  const s = await db.settings.get(KEY_HANDLE);
  return (s?.value as DirHandle | undefined) ?? null;
}

async function refresh() {
  const h = await getHandle();
  const [i, k, l] = await Promise.all([db.settings.get(KEY_INTERVAL), db.settings.get(KEY_KEEP), db.settings.get(KEY_LAST)]);
  let permission: Perm | null = null;
  if (h) {
    try {
      permission = await h.queryPermission({ mode: "readwrite" });
    } catch {
      permission = "denied";
    }
  }
  set({
    supported: isSupported(),
    folder: h?.name ?? null,
    permission,
    intervalHours: (i?.value as number | undefined) ?? 24,
    keep: (k?.value as number | undefined) ?? 7,
    lastAt: (l?.value as string | undefined) ?? null,
  });
}

export async function chooseFolder() {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("This browser cannot write to a folder");
  const h = await picker({ mode: "readwrite", id: "keel-backups" });
  await db.settings.put({ key: KEY_HANDLE, value: h });
  await refresh();
  await backupNow();
}

export async function forgetFolder() {
  await db.settings.delete(KEY_HANDLE);
  await refresh();
}

export async function requestPermission() {
  const h = await getHandle();
  if (!h) return;
  await h.requestPermission({ mode: "readwrite" });
  await refresh();
}

export async function setSchedule(intervalHours: number, keep: number) {
  await db.settings.bulkPut([
    { key: KEY_INTERVAL, value: intervalHours },
    { key: KEY_KEEP, value: keep },
  ]);
  await refresh();
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function backupNow(): Promise<string | null> {
  const h = await getHandle();
  if (!h) return null;
  set({ running: true, lastError: null });
  try {
    if ((await h.queryPermission({ mode: "readwrite" })) !== "granted") throw new Error("Folder access was revoked; grant it again in Settings");
    const data = await exportAll();
    const name = `${PREFIX}${stamp()}.json`;
    const file = await h.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(JSON.stringify(data));
    await w.close();
    // Keep the newest N.
    const names: string[] = [];
    for await (const k of h.keys()) if (k.startsWith(PREFIX) && k.endsWith(".json")) names.push(k);
    names.sort().reverse();
    for (const old of names.slice(status.keep)) await h.removeEntry(old).catch(() => {});
    const at = new Date().toISOString();
    await db.settings.put({ key: KEY_LAST, value: at });
    set({ lastAt: at });
    return name;
  } catch (e) {
    set({ lastError: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    set({ running: false });
    await refresh();
  }
}

let interval: ReturnType<typeof setInterval> | undefined;

async function tick() {
  const h = await getHandle();
  if (!h) return;
  const last = status.lastAt ? new Date(status.lastAt).getTime() : 0;
  if (Date.now() - last < status.intervalHours * 3600 * 1000) return;
  try {
    if ((await h.queryPermission({ mode: "readwrite" })) !== "granted") {
      set({ lastError: "Folder access needs to be granted again" });
      return;
    }
  } catch {
    return;
  }
  await backupNow();
}

/** Called once on app start. */
export async function boot() {
  await refresh();
  clearInterval(interval);
  interval = setInterval(() => void tick(), 15 * 60 * 1000);
  setTimeout(() => void tick(), 8000);
}

/** True when neither backups nor sync protect the data and it is worth a nudge. */
export function shouldNudge(syncSignedIn: boolean) {
  if (syncSignedIn || status.folder) return false;
  try {
    const last = localStorage.getItem("keel.safetyNagAt");
    if (last && Date.now() - new Date(last).getTime() < 7 * 86400 * 1000) return false;
    localStorage.setItem("keel.safetyNagAt", new Date().toISOString());
  } catch {
    return false;
  }
  return true;
}
