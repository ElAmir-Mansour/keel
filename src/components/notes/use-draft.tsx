"use client";
import { useState } from "react";
import { useDebouncedSave } from "@/hooks/use-debounced-save";

/**
 * A locally edited copy of a persisted string field. Keystrokes update the
 * draft immediately; the store is written after `delay` ms of quiet and on
 * unmount, so navigating away never loses input.
 *
 * When the stored value changes underneath us (the AI panel rewrote the note,
 * another tab saved) the draft adopts it, but only if there are no local edits
 * in flight: the person typing always wins.
 */
export function useDraft(remote: string, save: (v: string) => void | Promise<void>, delay = 400) {
  const [value, setValue] = useState(remote);
  // The last remote value this draft has seen. While value === seen the draft
  // is clean, so a remote change can be adopted; otherwise it is left alone
  // and the next debounced save carries the local edit.
  const [seen, setSeen] = useState(remote);
  if (remote !== seen) {
    setSeen(remote);
    if (value === seen) setValue(remote);
  }
  useDebouncedSave(value, save, delay, true, remote);
  return [value, setValue] as const;
}
