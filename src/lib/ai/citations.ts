import type { Source } from "./context";

/** Turns [n] citations into wiki links the markdown renderer resolves. */
export function withCitations(text: string, sources: Source[]) {
  if (!sources.length) return text;
  const byN = new Map(sources.map((s) => [s.n, s]));
  return text.replace(/\[(\d{1,2})\](?!\()/g, (m, n: string) => {
    const s = byN.get(Number(n));
    return s ? `[${n}](wiki:${encodeURIComponent(s.link)})` : m;
  });
}
