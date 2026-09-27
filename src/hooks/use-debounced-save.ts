"use client";
import { useEffect, useRef } from "react";

/**
 * Calls save(value) after `delay` ms of no changes, and flushes on unmount.
 * Nothing is written while the value equals the last value known to be
 * persisted (initially the mount value, or `baseline` when given), so mounting,
 * strict-mode double effects and adopting a remote change never cause writes.
 */
export function useDebouncedSave<T>(
  value: T,
  save: (v: T) => void | Promise<void>,
  delay = 500,
  enabled = true,
  baseline?: T,
) {
  const latest = useRef(value);
  const dirty = useRef(false);
  const saveRef = useRef(save);
  const persisted = useRef(value);

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (baseline !== undefined) persisted.current = baseline;
  }, [baseline]);

  useEffect(() => {
    if (!enabled) return;
    latest.current = value;
    if (Object.is(value, persisted.current)) {
      dirty.current = false;
      return;
    }
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      persisted.current = latest.current;
      void saveRef.current(latest.current);
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay, enabled]);

  useEffect(() => {
    return () => {
      if (dirty.current) {
        dirty.current = false;
        void saveRef.current(latest.current);
      }
    };
  }, []);
}
