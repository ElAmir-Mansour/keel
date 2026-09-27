"use client";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { db, SYNCED_TABLES } from "@/lib/db";
import { pendingChanges, resetCursors, syncOnce } from "./engine";
import { SupabaseAdapter } from "./supabase-adapter";

// Browser-side orchestration: configuration, auth, scheduling and a status
// store the settings page subscribes to. Sync stays optional; without a URL
// and key nothing here runs.

const KEY_URL = "keel.sync.url";
const KEY_ANON = "keel.sync.anonKey";
const KEY_AUTO = "keel.sync.auto";
const KEY_LAST = "keel.sync.lastAt";

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  running: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { pushed: number; pulled: number; applied: number } | null;
  pending: number;
  auto: boolean;
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let status: SyncStatus = {
  configured: false,
  signedIn: false,
  email: null,
  running: false,
  lastSyncAt: null,
  lastError: null,
  lastResult: null,
  pending: 0,
  auto: true,
};
const listeners = new Set<() => void>();
function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const SERVER_STATUS: SyncStatus = { ...status };
export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => status, () => SERVER_STATUS);
}

export function getSyncConfig() {
  return { url: read(KEY_URL) ?? "", anonKey: read(KEY_ANON) ?? "" };
}

export function saveSyncConfig(url: string, anonKey: string) {
  localStorage.setItem(KEY_URL, url.trim());
  localStorage.setItem(KEY_ANON, anonKey.trim());
  client = null;
  set({ configured: Boolean(url.trim() && anonKey.trim()) });
  void boot();
}

export function clearSyncConfig() {
  localStorage.removeItem(KEY_URL);
  localStorage.removeItem(KEY_ANON);
  client = null;
  set({ configured: false, signedIn: false, email: null });
}

export function setAutoSync(on: boolean) {
  localStorage.setItem(KEY_AUTO, on ? "1" : "0");
  set({ auto: on });
}

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient | null {
  if (client) return client;
  const { url, anonKey } = getSyncConfig();
  if (!url || !anonKey) return null;
  client = createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } });
  client.auth.onAuthStateChange((_event, session) => {
    onSession(session);
  });
  return client;
}

let session: Session | null = null;
function onSession(s: Session | null) {
  session = s;
  set({ signedIn: Boolean(s), email: s?.user.email ?? null });
  if (s) scheduleSync(500);
}

export async function signInWithEmail(email: string) {
  const c = getClient();
  if (!c) throw new Error("Add the Supabase URL and anon key first");
  const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/settings` } });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  const c = getClient();
  if (c) await c.auth.signOut();
  onSession(null);
}

/** Forget what has been synced so the next sync does a full merge. */
export async function forgetCursors() {
  await resetCursors(db);
  await refreshPending();
}

export async function wipeRemote() {
  const c = getClient();
  if (!c || !session) throw new Error("Not signed in");
  await new SupabaseAdapter(c, session.user.id).wipe();
  await resetCursors(db);
  await refreshPending();
}

// ----- scheduling ----------------------------------------------------------

let applyingRemote = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let hooked = false;
let inFlight: Promise<void> | null = null;

function scheduleSync(delay = 4000) {
  if (!status.auto || !session) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

async function refreshPending() {
  try {
    set({ pending: await pendingChanges(db) });
  } catch {
    /* status only */
  }
}

export async function syncNow(): Promise<void> {
  if (inFlight) return inFlight;
  const c = getClient();
  if (!c || !session) return;
  const adapter = new SupabaseAdapter(c, session.user.id);
  set({ running: true, lastError: null });
  inFlight = (async () => {
    try {
      const result = await syncOnce(adapter, db, {
        applying: async (fn) => {
          applyingRemote = true;
          try {
            return await fn();
          } finally {
            applyingRemote = false;
          }
        },
      });
      localStorage.setItem(KEY_LAST, result.startedAt);
      set({ lastSyncAt: result.startedAt, lastResult: { pushed: result.pushed, pulled: result.pulled, applied: result.applied } });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
      inFlight = null;
      await refreshPending();
    }
  })();
  return inFlight;
}

function hookLocalChanges() {
  if (hooked) return;
  hooked = true;
  const mark = () => {
    if (applyingRemote) return;
    scheduleSync();
    void refreshPending();
  };
  for (const tbl of SYNCED_TABLES) {
    const t = db.table(tbl);
    t.hook("creating", () => mark());
    t.hook("updating", () => mark());
    t.hook("deleting", () => mark());
  }
}

/** Called once on app start. Safe to call again after the config changes. */
export async function boot() {
  const { url, anonKey } = getSyncConfig();
  set({ configured: Boolean(url && anonKey), auto: read(KEY_AUTO) !== "0", lastSyncAt: read(KEY_LAST) });
  hookLocalChanges();
  await refreshPending();
  const c = getClient();
  if (!c) return;
  const { data } = await c.auth.getSession();
  onSession(data.session);
  clearInterval(interval);
  interval = setInterval(() => scheduleSync(0), 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync(0);
  });
}
