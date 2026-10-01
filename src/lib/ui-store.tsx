"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Cross-cutting UI state: the command palette, the quick-create dialogs and
// the AI panel are mounted once in the shell and opened from anywhere.

export type QuickCreateKind = "issue" | "note" | "decision" | "risk" | "project" | "person" | "timeline";

export interface AiRequest {
  /** Free-text prompt to prefill. */
  prompt?: string;
  /** A note to attach as context. */
  noteId?: string;
  /** A project to scope activity-based drafts to. */
  projectId?: string;
  /** Named action the panel knows how to run. */
  action?: "summarize" | "weekly" | "tasks" | "improve" | "ask";
}

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  quickCreate: { kind: QuickCreateKind; projectId?: string } | null;
  openQuickCreate: (kind: QuickCreateKind, projectId?: string) => void;
  closeQuickCreate: () => void;
  ai: { open: boolean; request: AiRequest | null };
  openAI: (req?: AiRequest) => void;
  closeAI: () => void;
}

const Ctx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickCreate, setQuickCreate] = useState<UiState["quickCreate"]>(null);
  const [ai, setAi] = useState<UiState["ai"]>({ open: false, request: null });

  const openQuickCreate = useCallback((kind: QuickCreateKind, projectId?: string) => {
    setQuickCreate({ kind, projectId });
  }, []);
  const closeQuickCreate = useCallback(() => setQuickCreate(null), []);
  const openAI = useCallback((request?: AiRequest) => setAi({ open: true, request: request ?? null }), []);
  const closeAI = useCallback(() => setAi((s) => ({ ...s, open: false })), []);

  const value = useMemo(
    () => ({ paletteOpen, setPaletteOpen, quickCreate, openQuickCreate, closeQuickCreate, ai, openAI, closeAI }),
    [paletteOpen, quickCreate, openQuickCreate, closeQuickCreate, ai, openAI, closeAI],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi outside UiProvider");
  return v;
}
