"use client";
import { useCallback, useSyncExternalStore } from "react";

export type EditorMode = "edit" | "preview" | "split";

const KEY = "keel.editorMode";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function stored(): EditorMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "edit" || v === "preview" || v === "split" ? v : null;
  } catch {
    return null;
  }
}

// Nothing stored: side-by-side on a wide screen, plain editor on a narrow one.
const getSnapshot = (): EditorMode => stored() ?? (window.innerWidth >= 1024 ? "split" : "edit");
const getServerSnapshot = (): EditorMode => "edit";

/** The note editor's edit/split/preview mode, remembered per browser. */
export function useEditorMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setMode = useCallback((m: EditorMode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      // Private mode or blocked storage: the mode still applies for this page.
    }
    listeners.forEach((l) => l());
  }, []);
  return [mode, setMode] as const;
}
