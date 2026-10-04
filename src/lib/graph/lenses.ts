import type { Issue, Person, Project, Risk } from "@/lib/types";
import { truckFactor } from "./metrics";
import type { GNode, GraphData } from "./model";

// Lenses: one question each, answered with the nodes to highlight and a line
// of explanation. They read the full graph (orphans and closed work included)
// and the raw records, so a lens finds things even when filters hide them.

export type LensId =
  | "decisions_without_notes"
  | "superseded_cited"
  | "orphans"
  | "unresolved"
  | "unowned_risks"
  | "bus_factor"
  | "unplanned_work"
  | "brokers"
  | "bridges"
  | "recent";

export interface LensHit {
  nodeId: string;
  detail: string;
}

export interface LensResult {
  id: LensId;
  hits: LensHit[];
  /** Nodes to light up together (a project and the person it depends on, for instance). */
  highlight: Set<string>;
}

export const LENSES: { id: LensId; title: string; question: string; group: "Knowledge" | "Work" | "Structure" }[] = [
  { id: "decisions_without_notes", title: "Decisions no note argues for", question: "Which decisions does no note link to?", group: "Knowledge" },
  { id: "superseded_cited", title: "Superseded but still cited", question: "Which superseded decisions do notes or open issues still point at?", group: "Knowledge" },
  { id: "orphans", title: "Orphan notes", question: "Which notes link to nothing and nothing links to?", group: "Knowledge" },
  { id: "unresolved", title: "Broken links", question: "Which [[links]] point at a note, issue or decision that does not exist?", group: "Knowledge" },
  { id: "unowned_risks", title: "Unowned risks", question: "Which open risks have no owner, or nothing linked to them?", group: "Work" },
  { id: "bus_factor", title: "Bus factor of one", question: "Which projects would stall if one person left?", group: "Work" },
  { id: "unplanned_work", title: "Urgent work without a plan", question: "Which urgent or high-priority open issues have no milestone or no assignee?", group: "Work" },
  { id: "brokers", title: "Brokers", question: "Which notes, issues and decisions sit on the most paths between others?", group: "Structure" },
  { id: "bridges", title: "Bridges between clusters", question: "What connects otherwise separate areas?", group: "Structure" },
  { id: "recent", title: "Changed this week", question: "What was created or edited in the last seven days?", group: "Structure" },
];

export interface LensInput {
  graph: GraphData; // the full graph
  issues: Issue[];
  risks: Risk[];
  projects: Project[];
  people: Person[];
  /** Betweenness over explicit links only, so structural hubs do not drown everything. */
  linkBetweenness: Map<string, number>;
  community: Map<string, number>;
  now?: Date;
}

const top = <T,>(arr: T[], n: number) => arr.slice(0, n);
const isLink = (k: string) => k === "link" || k === "supersedes";

export function runLens(id: LensId, x: LensInput): LensResult {
  const byId = new Map(x.graph.nodes.map((n) => [n.id, n]));
  const result = (hits: LensHit[], highlight?: Set<string>): LensResult => ({ id, hits, highlight: highlight ?? new Set(hits.map((h) => h.nodeId)) });
  const linkDegree = new Map<string, number>();
  const linkedFrom = new Map<string, Set<string>>();
  for (const e of x.graph.edges) {
    if (!isLink(e.kind)) continue;
    linkDegree.set(e.source, (linkDegree.get(e.source) ?? 0) + 1);
    linkDegree.set(e.target, (linkDegree.get(e.target) ?? 0) + 1);
    (linkedFrom.get(e.target) ?? linkedFrom.set(e.target, new Set()).get(e.target)!).add(e.source);
    (linkedFrom.get(e.source) ?? linkedFrom.set(e.source, new Set()).get(e.source)!).add(e.target);
  }
  const kindOf = (nid: string) => nid.slice(0, nid.indexOf(":"));

  switch (id) {
    case "decisions_without_notes": {
      // A decision another decision supersedes is history, not a gap.
      const replaced = new Set(x.graph.edges.filter((e) => e.kind === "supersedes").map((e) => e.target));
      const hits = x.graph.nodes
        .filter((n) => n.kind === "decision" && !n.closed && !replaced.has(n.id) && ![...(linkedFrom.get(n.id) ?? [])].some((o) => kindOf(o) === "note"))
        .map((n) => ({ nodeId: n.id, detail: String(n.meta.status ?? "") }));
      return result(hits);
    }
    case "superseded_cited": {
      const hits: LensHit[] = [];
      const highlight = new Set<string>();
      for (const n of x.graph.nodes) {
        if (n.kind !== "decision" || n.meta.status !== "superseded") continue;
        const citers = [...(linkedFrom.get(n.id) ?? [])].filter((o) => {
          const on = byId.get(o);
          // The decision that superseded it is expected to cite it.
          const supersededBy = x.graph.edges.some((e) => e.kind === "supersedes" && ((e.source === o && e.target === n.id) || (e.target === o && e.source === n.id)));
          return on && !supersededBy && (on.kind === "note" || (on.kind === "issue" && !on.closed) || (on.kind === "decision" && !on.closed));
        });
        if (!citers.length) continue;
        hits.push({ nodeId: n.id, detail: `cited by ${citers.length}` });
        highlight.add(n.id);
        for (const c of citers) highlight.add(c);
      }
      return result(hits, highlight);
    }
    case "orphans": {
      const hits = x.graph.nodes.filter((n) => n.kind === "note" && !(linkDegree.get(n.id) ?? 0)).map((n) => ({ nodeId: n.id, detail: (n.meta.folder as string) || "" }));
      return result(hits);
    }
    case "unresolved": {
      const hits = [...(x.graph.unresolved ?? new Map())].filter(([nodeId]) => byId.has(nodeId)).map(([nodeId, targets]) => ({ nodeId, detail: targets.map((t: string) => `[[${t}]]`).join(", ") }));
      return result(hits);
    }
    case "unowned_risks": {
      const hits: LensHit[] = [];
      for (const r of x.risks) {
        if (r.status === "closed" || r.status === "accepted") continue;
        const nid = `risk:${r.id}`;
        const reasons = [!r.ownerId ? "no owner" : null, !(linkDegree.get(nid) ?? 0) ? "nothing links to it" : null].filter(Boolean);
        if (reasons.length && byId.has(nid)) hits.push({ nodeId: nid, detail: `${reasons.join(", ")} · score ${r.likelihood * r.impact}` });
      }
      return result(hits.sort((a, b) => Number(b.detail.match(/score (\d+)/)?.[1] ?? 0) - Number(a.detail.match(/score (\d+)/)?.[1] ?? 0)));
    }
    case "bus_factor": {
      const hits: LensHit[] = [];
      const highlight = new Set<string>();
      for (const p of x.projects) {
        if (p.status === "done" || p.status === "archived") continue;
        const tf = truckFactor(x.issues, p.id, x.now);
        if (tf.items < 4 || tf.factor > 1) continue;
        const names = tf.people.map((pid) => x.people.find((pp) => pp.id === pid)?.name ?? "someone");
        hits.push({ nodeId: `project:${p.id}`, detail: tf.factor === 0 ? "nobody is assigned to its work" : `rests on ${names.join(", ")}` });
        highlight.add(`project:${p.id}`);
        for (const pid of tf.people) highlight.add(`person:${pid}`);
      }
      return result(hits, highlight);
    }
    case "unplanned_work": {
      const hits = x.issues
        .filter((i) => (i.priority === "urgent" || i.priority === "high") && i.status !== "done" && i.status !== "cancelled" && (!i.milestoneId || !i.assigneeId) && byId.has(`issue:${i.id}`))
        .map((i) => ({ nodeId: `issue:${i.id}`, detail: [!i.milestoneId ? "no milestone" : null, !i.assigneeId ? "no assignee" : null].filter(Boolean).join(", ") }));
      return result(hits);
    }
    case "brokers": {
      const ranked = x.graph.nodes
        .filter((n) => (x.linkBetweenness.get(n.id) ?? 0) > 0)
        .sort((a, b) => (x.linkBetweenness.get(b.id) ?? 0) - (x.linkBetweenness.get(a.id) ?? 0));
      return result(top(ranked, 10).map((n) => ({ nodeId: n.id, detail: `${linkDegree.get(n.id) ?? 0} links` })));
    }
    case "bridges": {
      const adjComms = new Map<string, Set<number>>();
      for (const e of x.graph.edges) {
        const ca = x.community.get(e.source);
        const cb = x.community.get(e.target);
        if (ca === undefined || cb === undefined || ca === cb) continue;
        (adjComms.get(e.source) ?? adjComms.set(e.source, new Set([ca])).get(e.source)!).add(cb);
        (adjComms.get(e.target) ?? adjComms.set(e.target, new Set([cb])).get(e.target)!).add(ca);
      }
      const ranked = [...adjComms.entries()].filter(([, cs]) => cs.size >= 2).sort((a, b) => b[1].size - a[1].size);
      return result(top(ranked, 10).map(([nodeId, cs]) => ({ nodeId, detail: `touches ${cs.size} clusters` })));
    }
    case "recent": {
      const since = (x.now ?? new Date()).getTime() - 7 * 86_400_000;
      const hits = x.graph.nodes
        .filter((n) => n.updatedAt && new Date(n.updatedAt).getTime() >= since && n.kind !== "tag")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((n) => ({ nodeId: n.id, detail: new Date(n.createdAt).getTime() >= since ? "new" : "edited" }));
      return result(hits);
    }
  }
}

export function nodeTitle(n: GNode | undefined) {
  return n?.label ?? "";
}
