import { adjacency, type GNode, type GraphData } from "./model";

// What the graph can tell a tech lead, computed from the typed graph:
// centrality (who or what holds things together), communities (which parts
// of the workspace form clusters) and lenses that answer one question each.

/** Undirected degree per node. */
export function degrees(g: GraphData) {
  const d = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1);
    d.set(e.target, (d.get(e.target) ?? 0) + 1);
  }
  return d;
}

/**
 * Brandes' betweenness centrality, unweighted and undirected, normalised to
 * 0..1. Exact up to `maxSources` nodes; above that it samples evenly spaced
 * sources, which ranks hubs well at a fraction of the cost.
 */
export function betweenness(g: GraphData, maxSources = 600) {
  const ids = g.nodes.map((n) => n.id);
  const adj = adjacency(g);
  const cb = new Map<string, number>(ids.map((id) => [id, 0]));
  const step = Math.max(1, Math.ceil(ids.length / maxSources));
  const sources = ids.filter((_, i) => i % step === 0);
  for (const s of sources) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>([[s, 1]]);
    const dist = new Map<string, number>([[s, 0]]);
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      stack.push(v);
      for (const w of adj.get(v) ?? []) {
        if (!dist.has(w)) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + sigma.get(v)!);
          (pred.get(w) ?? pred.set(w, []).get(w)!).push(v);
        }
      }
    }
    const delta = new Map<string, number>();
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w) ?? []) {
        const c = (sigma.get(v)! / sigma.get(w)!) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + c);
      }
      if (w !== s) cb.set(w, cb.get(w)! + (delta.get(w) ?? 0));
    }
  }
  const n = ids.length;
  const norm = n > 2 ? ((n - 1) * (n - 2)) / 2 : 1;
  const scale = step; // sampled sources stand for `step` sources each
  for (const [k, v] of cb) cb.set(k, Math.min(1, (v * scale) / 2 / norm));
  return cb;
}

/**
 * Louvain community detection (one or more passes of local moving and
 * aggregation) on the undirected, unweighted graph. Deterministic: nodes are
 * visited in a fixed order, so the same workspace always gets the same
 * clusters and colours. Returns community index per node, largest first.
 */
export function louvain(g: GraphData, maxPasses = 6): Map<string, number> {
  // Work on integer ids with weighted adjacency so aggregation is cheap.
  let ids = g.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  let adj: Map<number, Map<number, number>> = new Map(ids.map((_, i) => [i, new Map()]));
  let m2 = 0; // twice the total edge weight
  for (const e of g.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + 1);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + 1);
    m2 += 2;
  }
  // membership[original node] = current community
  let membership = ids.map((_, i) => i);
  if (!m2) return new Map(ids.map((id, i) => [id, i]));

  for (let pass = 0; pass < maxPasses; pass++) {
    const n = adj.size;
    const k = new Array<number>(n).fill(0); // node strength
    for (const [i, nb] of adj) for (const w of nb.values()) k[i] += w;
    const comm = Array.from({ length: n }, (_, i) => i);
    const tot = k.slice(); // total strength per community
    let moved = true;
    let improved = false;
    for (let sweep = 0; moved && sweep < 20; sweep++) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i];
        // weights from i to each neighbouring community
        const wTo = new Map<number, number>();
        for (const [j, w] of adj.get(i)!) if (j !== i) wTo.set(comm[j], (wTo.get(comm[j]) ?? 0) + w);
        tot[ci] -= k[i];
        let best = ci;
        let bestGain = (wTo.get(ci) ?? 0) - (tot[ci] * k[i]) / m2;
        for (const [c, w] of wTo) {
          const gain = w - (tot[c] * k[i]) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        tot[best] += k[i];
        if (best !== ci) {
          comm[i] = best;
          moved = true;
          improved = true;
        }
      }
    }
    if (!improved) break;
    // Renumber communities and aggregate.
    const renum = new Map<number, number>();
    for (const c of comm) if (!renum.has(c)) renum.set(c, renum.size);
    membership = membership.map((c) => renum.get(comm[c])!);
    const next: Map<number, Map<number, number>> = new Map([...renum.values()].map((c) => [c, new Map()]));
    for (const [i, nb] of adj) {
      const a = renum.get(comm[i])!;
      for (const [j, w] of nb) {
        const b = renum.get(comm[j])!;
        next.get(a)!.set(b, (next.get(a)!.get(b) ?? 0) + w);
      }
    }
    // Internal edges become self-loops; they count toward the community's
    // strength but never toward moving it, which is what the gain expects.
    adj = next;
    if (adj.size === n) break;
  }
  // Order communities by size, largest first.
  const sizes = new Map<number, number>();
  for (const c of membership) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
  const rank = new Map(order.map((c, i) => [c, i]));
  ids = g.nodes.map((n) => n.id);
  return new Map(ids.map((id, i) => [id, rank.get(membership[i])!]));
}

/** Modularity of a partition, to judge whether the clusters mean anything. */
export function modularity(g: GraphData, comm: Map<string, number>) {
  const deg = degrees(g);
  const m = g.edges.length;
  if (!m) return 0;
  let q = 0;
  for (const e of g.edges) if (comm.get(e.source) === comm.get(e.target)) q += 1;
  const totals = new Map<number, number>();
  for (const [id, d] of deg) totals.set(comm.get(id)!, (totals.get(comm.get(id)!) ?? 0) + d);
  let expected = 0;
  for (const t of totals.values()) expected += (t / (2 * m)) ** 2;
  return q / m - expected;
}

/** A short name for a cluster: its best-connected node, or its project. */
export function clusterNames(g: GraphData, comm: Map<string, number>, deg: Map<string, number>) {
  const best = new Map<number, GNode>();
  const pick = (n: GNode) => (n.kind === "project" ? 1000 : n.kind === "milestone" ? 100 : 0) + (deg.get(n.id) ?? 0);
  for (const n of g.nodes) {
    const c = comm.get(n.id)!;
    const cur = best.get(c);
    if (!cur || pick(n) > pick(cur)) best.set(c, n);
  }
  return new Map([...best.entries()].map(([c, n]) => [c, n.kind === "issue" || n.kind === "decision" || n.kind === "risk" ? n.label.split(" ").slice(1).join(" ") || n.label : n.label]));
}

/**
 * Truck factor per project, after Avelino et al. with issues standing in for
 * files: the smallest set of people whose departure leaves more than half the
 * project's recent work (open, or done in the last 90 days, weighted by
 * points) with nobody on it. A factor of 1 means one person carries it.
 */
export function truckFactor(issues: import("@/lib/types").Issue[], projectId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const items = issues.filter((i) => i.projectId === projectId && i.status !== "cancelled" && i.status !== "triage" && (i.status !== "done" || (i.completedAt ?? "") >= cutoff));
  const owners = (i: import("@/lib/types").Issue) => {
    const list = i.credits?.length ? i.credits.filter((c) => c.share >= 0.25).map((c) => c.personId) : i.assigneeId ? [i.assigneeId] : [];
    return new Set(list);
  };
  const weight = (i: import("@/lib/types").Issue) => i.lockedPoints ?? i.estimate ?? 1;
  const total = items.reduce((n, i) => n + weight(i), 0);
  const owned = items.filter((i) => owners(i).size > 0);
  if (!owned.length || !total) return { factor: 0, people: [] as string[], total, items: items.length };
  const removed: string[] = [];
  const covered = () => owned.filter((i) => [...owners(i)].some((p) => !removed.includes(p))).reduce((n, i) => n + weight(i), 0);
  while (covered() > total / 2) {
    const load = new Map<string, number>();
    for (const i of owned) {
      const left = [...owners(i)].filter((p) => !removed.includes(p));
      if (!left.length) continue;
      for (const p of left) load.set(p, (load.get(p) ?? 0) + weight(i));
    }
    const next = [...load.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!next) break;
    removed.push(next[0]);
  }
  return { factor: removed.length, people: removed, total, items: items.length };
}

/** Convex hull (monotone chain) of points, for cluster backgrounds. */
export function convexHull(points: { x: number; y: number }[]) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (ps: { x: number; y: number }[]) => {
    const h: { x: number; y: number }[] = [];
    for (const p of ps) {
      while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half(pts.slice().reverse())];
}
