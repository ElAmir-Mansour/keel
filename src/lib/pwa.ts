"use client";
import { useSyncExternalStore } from "react";

// Service-worker registration and the install prompt, exposed as a small
// store so Settings can offer "Install Keel" when the browser allows it.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaStatus {
  canInstall: boolean;
  installed: boolean;
  offlineReady: boolean;
  updateReady: boolean;
}

let state: PwaStatus = { canInstall: false, installed: false, offlineReady: false, updateReady: false };
const SERVER: PwaStatus = { ...state };
const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;

function set(patch: Partial<PwaStatus>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function usePwaStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  set({ canInstall: false, installed: outcome === "accepted" });
  return outcome === "accepted";
}

export function applyUpdate() {
  waiting?.postMessage({ type: "SKIP_WAITING" });
  window.location.reload();
}

export function bootPwa() {
  if (typeof window === "undefined") return;
  set({ installed: window.matchMedia("(display-mode: standalone)").matches });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => set({ installed: true, canInstall: false }));
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      if (reg.active) set({ offlineReady: true });
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            waiting = sw;
            set({ updateReady: true });
          } else if (sw.state === "activated") set({ offlineReady: true });
        });
      });
    })
    .catch(() => undefined);
}
