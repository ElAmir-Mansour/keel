import type { Decision, Issue, Note, Project } from "./types";

// [[Title]], [[Title|alias]], [[KEY-12]] (issue), [[ADR-3]] (decision).
// Resolution is by title for notes (case-insensitive), by key for issues and
// by ADR number for decisions. Unresolved links render as "missing" so a
// click can create the note, like Obsidian.

const LINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;
const ISSUE_RE = /^([A-Z][A-Z0-9]{1,5})-(\d+)$/;
const ADR_RE = /^ADR-(\d+)$/i;

export interface WikiLink {
  raw: string;
  target: string;
  alias?: string;
}

export function extractLinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    out.push({ raw: m[0], target: m[1].trim(), alias: m[2]?.trim() });
  }
  return out;
}

/** Rewrite [[links]] into markdown links with a wiki: scheme for the renderer. */
export function rewriteWikiLinks(body: string) {
  return body.replace(LINK_RE, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).trim();
    return `[${label.replace(/\]/g, "\\]")}](wiki:${encodeURIComponent(target.trim())})`;
  });
}

export interface LinkIndex {
  notes: Note[];
  issues: Issue[];
  decisions: Decision[];
  projects: Project[];
}

export type Resolved =
  | { kind: "note"; href: string; label: string; note: Note }
  | { kind: "issue"; href: string; label: string; issue: Issue; project: Project }
  | { kind: "decision"; href: string; label: string; decision: Decision }
  | { kind: "missing"; href: string; label: string; target: string };

export function resolveLink(target: string, idx: LinkIndex): Resolved {
  const t = target.trim();
  const im = t.match(ISSUE_RE);
  if (im) {
    const project = idx.projects.find((p) => p.key === im[1]);
    const issue = project
      ? idx.issues.find((i) => i.projectId === project.id && i.seq === Number(im[2]))
      : undefined;
    if (project && issue) {
      return { kind: "issue", href: `/projects/${project.id}/issues/${issue.seq}`, label: t, issue, project };
    }
  }
  const am = t.match(ADR_RE);
  if (am) {
    const decision = idx.decisions.find((d) => d.seq === Number(am[1]));
    if (decision) return { kind: "decision", href: `/decisions/${decision.id}`, label: t, decision };
  }
  const lower = t.toLowerCase();
  const note = idx.notes.find((n) => n.title.toLowerCase() === lower);
  if (note) return { kind: "note", href: `/notes/${note.id}`, label: note.title, note };
  return { kind: "missing", href: `/notes/new?title=${encodeURIComponent(t)}`, label: t, target: t };
}

/** Notes whose body links to the given target (a note title, issue key or ADR-n). */
export function backlinksTo(targets: string[], notes: Note[]) {
  const wanted = new Set(targets.map((t) => t.toLowerCase()));
  return notes.filter((n) => extractLinks(n.body).some((l) => wanted.has(l.target.toLowerCase())));
}

export function noteLinkTargets(note: Note) {
  return [note.title];
}

/** Titles matching a prefix, for the [[ autocomplete. */
export function suggestTargets(query: string, idx: LinkIndex, limit = 8) {
  const q = query.toLowerCase();
  const out: { label: string; hint: string }[] = [];
  for (const n of idx.notes) {
    if (!q || n.title.toLowerCase().includes(q)) out.push({ label: n.title, hint: n.folder });
    if (out.length >= limit) return out;
  }
  for (const i of idx.issues) {
    const p = idx.projects.find((pp) => pp.id === i.projectId);
    if (!p) continue;
    const key = `${p.key}-${i.seq}`;
    if (!q || key.toLowerCase().startsWith(q) || i.title.toLowerCase().includes(q)) {
      out.push({ label: key, hint: i.title });
    }
    if (out.length >= limit) return out;
  }
  for (const d of idx.decisions) {
    const key = `ADR-${d.seq}`;
    if (!q || key.toLowerCase().startsWith(q) || d.title.toLowerCase().includes(q)) {
      out.push({ label: key, hint: d.title });
    }
    if (out.length >= limit) return out;
  }
  return out;
}
