import { extractLinks, linkBase, type LinkIndex } from "@/lib/wikilinks";
import { creditsOf, pointsOf } from "@/lib/points";
import { issueKey, riskScore, type Decision, type Issue, type Milestone, type Note, type Person, type Project, type Risk, type Timeline } from "@/lib/types";

// The workspace as one typed graph. Two families of edges:
//
//  - knowledge edges come from what people wrote: a [[wikilink]] in a note,
//    a decision, an issue, a risk or a timeline entry;
//  - structural edges come from the records themselves: an issue belongs to a
//    milestone and a project, is assigned to people, a risk has an owner, a
//    1:1 note is about a person, a decision supersedes another.
//
// Pure: everything the Graph tab shows, and every insight it computes, is
// derived here from plain arrays so it is unit-tested without a browser.

export type GNodeKind = "note" | "issue" | "decision" | "project" | "milestone" | "person" | "risk" | "timeline" | "tag";
export type GEdgeKind = "link" | "part_of" | "assigned" | "owns" | "about" | "supersedes" | "tagged";

export const NODE_GROUPS: { id: "knowledge" | "work" | "people"; label: string; kinds: GNodeKind[] }[] = [
  { id: "knowledge", label: "Knowledge", kinds: ["note", "decision", "timeline", "tag"] },
  { id: "work", label: "Work", kinds: ["project", "milestone", "issue", "risk"] },
  { id: "people", label: "People", kinds: ["person"] },
];

export const NODE_LABELS: Record<GNodeKind, string> = {
  note: "Note",
  issue: "Issue",
  decision: "Decision",
  project: "Project",
  milestone: "Milestone",
  person: "Person",
  risk: "Risk",
  timeline: "Timeline",
  tag: "Tag",
};

export const EDGE_LABELS: Record<GEdgeKind, string> = {
  link: "Links to",
  part_of: "Part of",
  assigned: "Assigned to",
  owns: "Owned by",
  about: "About",
  supersedes: "Supersedes",
  tagged: "Tagged",
};

export interface GNode {
  id: string; // "<kind>:<entity id>"
  kind: GNodeKind;
  entityId: string;
  label: string;
  href: string;
  projectId?: string;
  /** ISO time of the last change, for the "what changed" filter. */
  updatedAt: string;
  createdAt: string;
  /** Closed work (done or cancelled issues, closed risks, done milestones). */
  closed: boolean;
  /** Free-form facts for the details panel. */
  meta: Record<string, string | number>;
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  kind: GEdgeKind;
}

export interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
  /** [[links]] that resolve to nothing, by the node they were written in. */
  unresolved?: Map<string, string[]>;
}

export interface GraphSource extends LinkIndex {
  milestones: Milestone[];
  people: Person[];
  risks: Risk[];
  timelines: Timeline[];
}

export interface BuildOptions {
  kinds: ReadonlySet<GNodeKind>;
  /** Structural edges (part of, assigned, owns, about); knowledge links are always on. */
  structure: boolean;
  /** Include done or cancelled issues, closed risks and done milestones. */
  closed: boolean;
  /** Keep nodes with no edges. */
  orphans: boolean;
}

export const ALL_KINDS: GNodeKind[] = ["note", "decision", "timeline", "tag", "project", "milestone", "issue", "risk", "person"];

export const DEFAULT_BUILD: BuildOptions = {
  kinds: new Set<GNodeKind>(["note", "decision", "issue", "project", "person", "risk"]),
  structure: true,
  closed: false,
  orphans: false,
};

const nid = (kind: GNodeKind, id: string) => `${kind}:${id}`;

function nodeFor(kind: GNodeKind, e: Note | Issue | Decision | Project | Milestone | Person | Risk | Timeline, idx: GraphSource): GNode {
  switch (kind) {
    case "note": {
      const n = e as Note;
      return { id: nid(kind, n.id), kind, entityId: n.id, label: n.title, href: `/notes/${n.id}`, projectId: n.projectId, updatedAt: n.updatedAt, createdAt: n.createdAt, closed: false, meta: { folder: n.folder, kind: n.kind } };
    }
    case "issue": {
      const i = e as Issue;
      const p = idx.projects.find((x) => x.id === i.projectId);
      const key = p ? issueKey(p, i) : `#${i.seq}`;
      return {
        id: nid(kind, i.id),
        kind,
        entityId: i.id,
        label: `${key} ${i.title}`,
        href: p ? `/projects/${p.id}/issues/${i.seq}` : "/inbox",
        projectId: i.projectId,
        updatedAt: i.updatedAt,
        createdAt: i.createdAt,
        closed: i.status === "done" || i.status === "cancelled",
        meta: { status: i.status, priority: i.priority, ...(pointsOf(i) ? { points: pointsOf(i) } : {}), ...(i.dueDate ? { due: i.dueDate } : {}) },
      };
    }
    case "decision": {
      const d = e as Decision;
      return { id: nid(kind, d.id), kind, entityId: d.id, label: `ADR-${d.seq} ${d.title}`, href: `/decisions/${d.id}`, projectId: d.projectId, updatedAt: d.updatedAt, createdAt: d.createdAt, closed: d.status === "superseded" || d.status === "deprecated", meta: { status: d.status, date: d.date } };
    }
    case "project": {
      const p = e as Project;
      return { id: nid(kind, p.id), kind, entityId: p.id, label: p.name, href: `/projects/${p.id}`, projectId: p.id, updatedAt: p.updatedAt, createdAt: p.createdAt, closed: p.status === "done" || p.status === "archived", meta: { key: p.key, status: p.status } };
    }
    case "milestone": {
      const m = e as Milestone;
      return { id: nid(kind, m.id), kind, entityId: m.id, label: m.title, href: `/projects/${m.projectId}/roadmap`, projectId: m.projectId, updatedAt: m.updatedAt, createdAt: m.createdAt, closed: m.status === "done", meta: { status: m.status, ...(m.dueDate ? { due: m.dueDate } : {}) } };
    }
    case "person": {
      const p = e as Person;
      return { id: nid(kind, p.id), kind, entityId: p.id, label: p.name, href: `/team/${p.id}`, updatedAt: p.updatedAt, createdAt: p.createdAt, closed: false, meta: { role: p.role } };
    }
    case "risk": {
      const r = e as Risk;
      const p = idx.projects.find((x) => x.id === r.projectId);
      return {
        id: nid(kind, r.id),
        kind,
        entityId: r.id,
        label: `${p ? `${p.key}-R${r.seq}` : `R${r.seq}`} ${r.title}`,
        href: p ? `/projects/${p.id}/risks` : "/risks",
        projectId: r.projectId,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
        closed: r.status === "closed",
        meta: { status: r.status, score: riskScore(r), kind: r.kind },
      };
    }
    case "timeline": {
      const tl = e as Timeline;
      return { id: nid(kind, tl.id), kind, entityId: tl.id, label: tl.title, href: `/timelines/${tl.id}`, projectId: tl.projectId, updatedAt: tl.updatedAt, createdAt: tl.createdAt, closed: false, meta: { entries: tl.entries.length } };
    }
    case "tag":
      throw new Error("Tag nodes are created from the items that carry them");
  }
}

/** Lookup maps so resolving thousands of links stays linear. Same rules as resolveLink. */
function makeResolver(idx: LinkIndex) {
  const noteByTitle = new Map<string, Note>();
  for (const n of idx.notes) if (!noteByTitle.has(n.title.toLowerCase())) noteByTitle.set(n.title.toLowerCase(), n);
  const projectByKey = new Map(idx.projects.map((p) => [p.key, p]));
  const issueByKey = new Map<string, Issue>();
  for (const i of idx.issues) {
    const p = idx.projects.find((x) => x.id === i.projectId);
    if (p) issueByKey.set(`${p.key}-${i.seq}`, i);
  }
  const decisionBySeq = new Map(idx.decisions.map((d) => [d.seq, d]));
  return (raw: string): { id: string; decision?: Decision } | null => {
    const t = linkBase(raw);
    const im = t.match(/^([A-Z][A-Z0-9]{1,5})-(\d+)$/);
    if (im && projectByKey.has(im[1])) {
      const i = issueByKey.get(t);
      if (i) return { id: nid("issue", i.id) };
    }
    const am = t.match(/^ADR-(\d+)$/i);
    if (am) {
      const d = decisionBySeq.get(Number(am[1]));
      if (d) return { id: nid("decision", d.id), decision: d };
    }
    const n = noteByTitle.get(t.toLowerCase());
    return n ? { id: nid("note", n.id) } : null;
  };
}

/** Every [[link]] in a piece of text, resolved to graph node ids; misses are reported. */
function linkTargets(text: string, from: Decision | null, resolve: ReturnType<typeof makeResolver>, missing: string[]): { id: string; supersedes: boolean }[] {
  const out: { id: string; supersedes: boolean }[] = [];
  for (const l of extractLinks(text)) {
    const r = resolve(l.target);
    if (!r) {
      missing.push(linkBase(l.target));
      continue;
    }
    // A decision pointing at an older, superseded decision supersedes it; the
    // wording ("Supersedes [[ADR-3]]") also counts, in any language's template.
    const before = text.slice(Math.max(0, text.indexOf(l.raw) - 24), text.indexOf(l.raw)).toLowerCase();
    const supersedes = Boolean(from && r.decision && r.decision.id !== from.id && (r.decision.status === "superseded" || /supersede|يحل محل|يلغي/.test(before)) && r.decision.seq < from.seq);
    out.push({ id: r.id, supersedes });
  }
  return out;
}

/** Build the full typed graph, then keep what the options ask for. */
export function buildWorkspaceGraph(idx: GraphSource, opts: BuildOptions = DEFAULT_BUILD): GraphData {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const seen = new Set<string>();

  const add = (kind: GNodeKind, e: Parameters<typeof nodeFor>[1]) => {
    const n = nodeFor(kind, e, idx);
    nodes.set(n.id, n);
    return n;
  };
  for (const n of idx.notes) add("note", n);
  for (const i of idx.issues) add("issue", i);
  for (const d of idx.decisions) add("decision", d);
  for (const p of idx.projects) add("project", p);
  for (const m of idx.milestones) add("milestone", m);
  for (const p of idx.people) add("person", p);
  for (const r of idx.risks) add("risk", r);
  for (const tl of idx.timelines) add("timeline", tl);

  const edge = (source: string, target: string, kind: GEdgeKind) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    // One edge per pair and kind; a link in both directions counts once.
    const [a, b] = source < target ? [source, target] : [target, source];
    const key = `${a}|${b}|${kind === "supersedes" ? "supersedes" : kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: key, source, target, kind });
  };
  const resolve = makeResolver(idx);
  const unresolved = new Map<string, string[]>();
  const links = (from: string, text: string, decision: Decision | null = null) => {
    const missing: string[] = [];
    for (const l of linkTargets(text, decision, resolve, missing)) edge(from, l.id, l.supersedes ? "supersedes" : "link");
    if (missing.length) unresolved.set(from, [...new Set([...(unresolved.get(from) ?? []), ...missing])]);
  };
  const tags = (from: string, list: string[]) => {
    for (const raw of list) {
      const tag = raw.replace(/^#/, "").trim().toLowerCase();
      if (!tag) continue;
      const id = nid("tag", tag);
      if (!nodes.has(id)) nodes.set(id, { id, kind: "tag", entityId: tag, label: `#${tag}`, href: `/notes?tag=${encodeURIComponent(tag)}`, updatedAt: "", createdAt: "", closed: false, meta: {} });
      edge(from, id, "tagged");
    }
  };

  for (const n of idx.notes) {
    const id = nid("note", n.id);
    links(id, n.body);
    tags(id, n.tags);
    if (n.personId) edge(id, nid("person", n.personId), "about");
    if (n.projectId) edge(id, nid("project", n.projectId), "part_of");
  }
  for (const d of idx.decisions) {
    const id = nid("decision", d.id);
    links(id, [d.context, d.decision, d.consequences, d.alternatives].join("\n"), d);
    tags(id, d.tags);
    if (d.projectId) edge(id, nid("project", d.projectId), "part_of");
  }
  for (const i of idx.issues) {
    const id = nid("issue", i.id);
    links(id, i.description);
    tags(id, i.labels);
    edge(id, i.milestoneId ? nid("milestone", i.milestoneId) : nid("project", i.projectId), "part_of");
    for (const c of creditsOf(i)) edge(id, nid("person", c.personId), "assigned");
  }
  for (const m of idx.milestones) edge(nid("milestone", m.id), nid("project", m.projectId), "part_of");
  for (const r of idx.risks) {
    const id = nid("risk", r.id);
    links(id, `${r.description}\n${r.mitigation}`);
    edge(id, nid("project", r.projectId), "part_of");
    if (r.ownerId) edge(id, nid("person", r.ownerId), "owns");
  }
  for (const p of idx.projects) if (p.leadId) edge(nid("project", p.id), nid("person", p.leadId), "owns");
  for (const tl of idx.timelines) {
    const id = nid("timeline", tl.id);
    if (tl.projectId) edge(id, nid("project", tl.projectId), "part_of");
    for (const e of tl.entries) {
      if (e.link) links(id, `[[${e.link}]]`);
      if (e.note) links(id, e.note);
    }
  }

  // Tags carry the date of the newest thing tagged with them.
  for (const e of edges) {
    if (e.kind !== "tagged") continue;
    const tag = nodes.get(e.target)!;
    const item = nodes.get(e.source)!;
    if (item.updatedAt > tag.updatedAt) tag.updatedAt = item.updatedAt;
    if (!tag.createdAt || item.createdAt < tag.createdAt) tag.createdAt = item.createdAt;
  }

  // Filter: kinds, closed work, structure. Edges survive only between kept nodes.
  const keep = new Set([...nodes.values()].filter((n) => opts.kinds.has(n.kind) && (opts.closed || !n.closed)).map((n) => n.id));
  // With milestones hidden, work that belongs to one still belongs to its project.
  const milestoneProject = new Map(idx.milestones.map((m) => [nid("milestone", m.id), nid("project", m.projectId)]));
  const rerouted = edges.map((e) => {
    if (e.kind !== "part_of" || keep.has(e.target) || !milestoneProject.has(e.target)) return e;
    const target = milestoneProject.get(e.target)!;
    return { ...e, target, id: `${e.source < target ? e.source : target}|${e.source < target ? target : e.source}|part_of` };
  });
  const keptIds = new Set<string>();
  const kept = rerouted.filter((e) => {
    if (!keep.has(e.source) || !keep.has(e.target)) return false;
    if (!(opts.structure || e.kind === "link" || e.kind === "supersedes" || e.kind === "tagged")) return false;
    if (keptIds.has(e.id)) return false;
    keptIds.add(e.id);
    return true;
  });
  const touched = new Set(kept.flatMap((e) => [e.source, e.target]));
  const outNodes = [...nodes.values()].filter((n) => keep.has(n.id) && (opts.orphans || touched.has(n.id)));
  return { nodes: outNodes, edges: kept, unresolved };
}

/**
 * A short fingerprint of the graph's shape (node ids and edge keys), so the
 * page can keep its layout when a live query refreshes with nothing new to draw.
 */
export function shapeHash(g: GraphData) {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const n of [...g.nodes].sort((a, b) => a.id.localeCompare(b.id))) feed(n.id + (n.closed ? "!" : ""));
  for (const e of [...g.edges].sort((a, b) => a.id.localeCompare(b.id))) feed(e.id);
  return (h >>> 0).toString(36);
}

/** Shortest path between two nodes (breadth-first), or null when unconnected. */
export function shortestPath(g: GraphData, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const adj = adjacency(g);
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (const w of adj.get(v) ?? []) {
      if (prev.has(w)) continue;
      prev.set(w, v);
      if (w === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev.get(cur)!;
          path.push(cur);
        }
        return path.reverse();
      }
      queue.push(w);
    }
  }
  return null;
}

/** Neighbour lists, undirected. */
export function adjacency(g: GraphData) {
  const m = new Map<string, Set<string>>();
  for (const n of g.nodes) m.set(n.id, new Set());
  for (const e of g.edges) {
    m.get(e.source)?.add(e.target);
    m.get(e.target)?.add(e.source);
  }
  return m;
}

/** The nodes within `depth` hops of `start`, for the local graph. */
export function neighbourhood(g: GraphData, start: string, depth: number): Set<string> {
  const adj = adjacency(g);
  const seen = new Set([start]);
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) {
      seen.add(nb);
      next.push(nb);
    }
    frontier = next;
  }
  return seen;
}

/** The sub-graph induced by a set of node ids. */
export function induced(g: GraphData, ids: ReadonlySet<string>): GraphData {
  return { nodes: g.nodes.filter((n) => ids.has(n.id)), edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}
