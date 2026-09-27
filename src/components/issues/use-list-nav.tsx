"use client";
import { useEffect, useRef, useState } from "react";
import { inOverlay, isEditableTarget } from "./issue-utils";

// j/k (or arrows) move a selection over a flat list; Enter opens it. Extra
// single-key actions are delegated to onKey, which returns true to claim the
// event. Arrow keys are only claimed when focus is on the body or inside a
// [data-list-nav] container, so selects and menus keep theirs.

export function useListNav(
  count: number,
  handlers: {
    onOpen?: (index: number) => void;
    onKey?: (key: string, index: number, e: KeyboardEvent) => boolean | void;
    enabled?: boolean;
  },
) {
  const [raw, setRaw] = useState(-1);
  const index = Math.min(raw, count - 1);
  const state = useRef({ index, handlers });
  useEffect(() => {
    state.current = { index, handlers };
  });

  const enabled = handlers.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isEditableTarget(e.target) || inOverlay(e.target)) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const inList = !t || t === document.body || Boolean(t.closest("[data-list-nav]"));
      const { index: cur, handlers: h } = state.current;
      const k = e.key;
      if (k === "j" || (k === "ArrowDown" && inList)) {
        e.preventDefault();
        setRaw((i) => Math.min(count - 1, Math.max(0, i + 1)));
      } else if (k === "k" || (k === "ArrowUp" && inList)) {
        e.preventDefault();
        setRaw((i) => Math.max(0, Math.min(count - 1, i) - 1));
      } else if (k === "Enter") {
        if (!inList || (t && (t.tagName === "BUTTON" || t.tagName === "A"))) return;
        if (cur >= 0) {
          e.preventDefault();
          h.onOpen?.(cur);
        }
      } else if (h.onKey && cur >= 0 && k.length === 1) {
        if (h.onKey(k, cur, e)) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, enabled]);

  return { index, setIndex: setRaw };
}
