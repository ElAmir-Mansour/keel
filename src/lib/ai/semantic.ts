"use client";
import { useSyncExternalStore } from "react";
import { db } from "@/lib/db";
import { issueKey } from "@/lib/types";
import { chunkText, DEFAULT_EMBEDDING_MODEL, dot, embed, EMBEDDING_MODELS, loadEmbedder, type EmbeddingModelId, type Progress } from "./embeddings";

// The semantic index: one row per chunk of every note, issue and decision,
// kept in IndexedDB and refreshed incrementally by record version. Off by
// default; switching it on downloads the model once.

const KEY_ENABLED = "keel.semantic.enabled";
const KEY_MODEL = "keel.semantic.model";

export interface SemanticStatus {
  enabled: boolean;
  model: EmbeddingModelId;
  loading: boolean;
  loadProgress: number; // 0..1
  indexing: boolean;
  indexed: number;
  total: number;
  ready: boolean;
  error: string | null;
}

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

let state: SemanticStatus = { enabled: false, model: DEFAULT_EMBEDDING_MODEL, loading: false, loadProgress: 0, indexing: false, indexed: 0, total: 0, ready: false, error: null };
const SERVER: SemanticStatus = { ...state };
const listeners = new Set<() => void>();
function set(patch: Partial<SemanticStatus>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
export function useSemanticStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}
export function semanticReady() {
  return state.enabled && state.ready;
}

function isModel(v: unknown): v is EmbeddingModelId {
  return EMBEDDING_MODELS.some((m) => m.id === v);
}

export async function setSemanticEnabled(on: boolean) {
  localStorage.setItem(KEY_ENABLED, on ? "1" : "0");
  set({ enabled: on, ready: false, error: null });
  if (on) void indexPending();
}

export async function setSemanticModel(model: EmbeddingModelId) {
  localStorage.setItem(KEY_MODEL, model);
  set({ model, ready: false });
  await db.embeddings.clear();
  if (state.enabled) void indexPending();
}

interface Source {
  kind: "note" | "issue" | "decision";
  id: string;
  title: string;
  text: string;
  version: string;
}

async function sources(): Promise<Source[]> {
  const [notes, issues, decisions, projects] = await Promise.all([db.notes.toArray(), db.issues.toArray(), db.decisions.toArray(), db.projects.toArray()]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  return [
    ...notes.map((n) => ({ kind: "note" as const, id: n.id, title: n.title, text: `${n.title}\n${n.body}`, version: n.updatedAt })),
    ...issues.map((i) => {
      const p = byId.get(i.projectId);
      return { kind: "issue" as const, id: i.id, title: p ? `${issueKey(p, i)} ${i.title}` : i.title, text: `${i.title}\n${i.description}`, version: i.updatedAt };
    }),
    ...decisions.map((d) => ({ kind: "decision" as const, id: d.id, title: `ADR-${d.seq} ${d.title}`, text: `${d.title}\n${d.context}\n${d.decision}\n${d.consequences}`, version: d.updatedAt })),
  ];
}

let running = false;

/** Embed everything new or changed; remove rows for deleted records. */
export async function indexPending() {
  if (running || !state.enabled) return;
  running = true;
  set({ indexing: true, error: null });
  try {
    set({ loading: true });
    await loadEmbedder(state.model, (p: Progress) => {
      if (typeof p.progress === "number") set({ loadProgress: Math.min(1, p.progress / 100) });
    });
    set({ loading: false, loadProgress: 1 });
    const recs = await sources();
    const existing = await db.embeddings.toArray();
    const byRecord = new Map<string, string>();
    for (const e of existing) byRecord.set(e.recordId, e.version);
    const live = new Set(recs.map((r) => r.id));
    const stale = existing.filter((e) => !live.has(e.recordId)).map((e) => e.id);
    if (stale.length) await db.embeddings.bulkDelete(stale);
    const todo = recs.filter((r) => byRecord.get(r.id) !== r.version);
    set({ total: recs.length, indexed: recs.length - todo.length });
    for (const r of todo) {
      if (!state.enabled) break;
      const chunks = chunkText(r.text);
      const vectors = await embed(state.model, chunks);
      await db.transaction("rw", db.embeddings, async () => {
        await db.embeddings.where("recordId").equals(r.id).delete();
        await db.embeddings.bulkPut(
          chunks.map((text, i) => ({ id: `${r.kind}:${r.id}:${i}`, kind: r.kind, recordId: r.id, chunk: i, title: r.title, text, version: r.version, vector: vectors[i] })),
        );
      });
      set({ indexed: state.indexed + 1 });
    }
    set({ ready: true });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e), loading: false });
  } finally {
    running = false;
    set({ indexing: false });
  }
}

export interface SemanticHit {
  kind: "note" | "issue" | "decision";
  recordId: string;
  title: string;
  text: string;
  score: number;
}

export async function semanticSearch(query: string, k = 8): Promise<SemanticHit[]> {
  if (!semanticReady() || !query.trim()) return [];
  const [q] = await embed(state.model, [query.trim()]);
  const rows = await db.embeddings.toArray();
  const best = new Map<string, SemanticHit>();
  for (const r of rows) {
    const score = dot(q, r.vector);
    const cur = best.get(r.recordId);
    if (!cur || score > cur.score) best.set(r.recordId, { kind: r.kind, recordId: r.recordId, title: r.title, text: r.text, score });
  }
  return [...best.values()]
    .filter((h) => h.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let hooked = false;

export function bootSemantic() {
  const model = read(KEY_MODEL);
  set({ enabled: read(KEY_ENABLED) === "1", model: isModel(model) ? model : DEFAULT_EMBEDDING_MODEL });
  if (!hooked) {
    hooked = true;
    const schedule = () => {
      if (!state.enabled) return;
      clearTimeout(timer);
      timer = setTimeout(() => void indexPending(), 5000);
    };
    for (const t of [db.notes, db.issues, db.decisions]) {
      t.hook("creating", () => schedule());
      t.hook("updating", () => schedule());
      t.hook("deleting", () => schedule());
    }
  }
  if (state.enabled) setTimeout(() => void indexPending(), 3000);
}
