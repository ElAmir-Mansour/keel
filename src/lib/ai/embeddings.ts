"use client";
// Sentence embeddings computed in the browser with transformers.js, loaded
// from a CDN only when semantic search is switched on, so the app bundle
// carries none of it. Vectors are L2-normalised, so cosine is a dot product.

export const EMBEDDING_MODELS = [
  { id: "Xenova/all-MiniLM-L6-v2", label: "English (23 MB)", dims: 384 },
  { id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", label: "Multilingual, includes Arabic (120 MB)", dims: 384 },
] as const;
export type EmbeddingModelId = (typeof EMBEDDING_MODELS)[number]["id"];
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelId = "Xenova/all-MiniLM-L6-v2";

const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

interface Tensor {
  data: Float32Array;
  dims: number[];
}
type Pipe = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<Tensor>;
interface TransformersModule {
  env: { allowLocalModels: boolean };
  pipeline: (task: "feature-extraction", model: string, opts: { dtype: string; progress_callback?: (p: unknown) => void }) => Promise<Pipe>;
}

export type Progress = { status: string; file?: string; progress?: number };

const pipes = new Map<string, Promise<Pipe>>();

export function loadEmbedder(model: EmbeddingModelId, onProgress?: (p: Progress) => void): Promise<Pipe> {
  let p = pipes.get(model);
  if (!p) {
    p = (async () => {
      // A runtime import keeps the bundler out of it entirely.
      const importer = new Function("u", "return import(u)") as (u: string) => Promise<TransformersModule>;
      const mod = await importer(CDN);
      mod.env.allowLocalModels = false;
      return mod.pipeline("feature-extraction", model, { dtype: "q8", progress_callback: (x) => onProgress?.(x as Progress) });
    })();
    pipes.set(model, p);
    p.catch(() => pipes.delete(model));
  }
  return p;
}

export async function embed(model: EmbeddingModelId, texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const pipe = await loadEmbedder(model);
  const out = await pipe(texts, { pooling: "mean", normalize: true });
  const [n, d] = out.dims;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < n; i += 1) vectors.push(out.data.slice(i * d, (i + 1) * d));
  return vectors;
}

export function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

/** Split long text into overlapping windows; short text is one chunk. */
export function chunkText(text: string, size = 900, overlap = 120, max = 8): string[] {
  const t = text.replace(/\s+\n/g, "\n").trim();
  if (t.length <= size) return t ? [t] : [];
  const out: string[] = [];
  let i = 0;
  while (i < t.length && out.length < max) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) {
      const brk = t.lastIndexOf("\n", end);
      if (brk > i + size / 2) end = brk;
    }
    out.push(t.slice(i, end).trim());
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out.filter(Boolean);
}
