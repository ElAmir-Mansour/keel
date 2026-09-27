"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Maximize, Search, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader } from "@/components/ui-bits";
import { useLinkIndex } from "@/hooks/use-data";
import { CHROME, SERIES } from "@/lib/chart-theme";
import { useUi } from "@/lib/ui-store";
import { extractLinks, resolveLink, type LinkIndex } from "@/lib/wikilinks";

type NodeKind = "note" | "issue" | "decision";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  href: string;
  degree: number;
  inbound: number;
}
interface GraphLink {
  source: string;
  target: string;
}
interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}
interface SimNode extends SimulationNodeDatum, GraphNode {
  r: number;
}
type SimLink = SimulationLinkDatum<SimNode>;

// Colour by kind, one categorical slot each, with a legend so colour is
// never the only cue.
const COLOR: Record<NodeKind, string> = { note: SERIES[0], issue: SERIES[1], decision: SERIES[2] };
const LEGEND: { kind: NodeKind; label: string }[] = [
  { kind: "note", label: "Note" },
  { kind: "issue", label: "Issue" },
  { kind: "decision", label: "Decision" },
];

function radius(n: GraphNode) {
  // Notes grow with how many notes cite them; issues and decisions stay small.
  return n.kind === "note" ? 5 + Math.min(12, Math.sqrt(n.inbound) * 3) : 4;
}

function truncate(s: string, max = 28) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function buildGraph(idx: LinkIndex, opts: { issues: boolean; decisions: boolean; orphans: boolean }): Graph {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  for (const n of idx.notes) nodes.set(`note:${n.id}`, { id: `note:${n.id}`, kind: "note", label: n.title, href: `/notes/${n.id}`, degree: 0, inbound: 0 });
  for (const n of idx.notes) {
    const source = `note:${n.id}`;
    for (const l of extractLinks(n.body)) {
      const r = resolveLink(l.target, idx);
      if (r.kind === "missing") continue;
      if (r.kind === "issue" && !opts.issues) continue;
      if (r.kind === "decision" && !opts.decisions) continue;
      const target = r.kind === "note" ? `note:${r.note.id}` : r.kind === "issue" ? `issue:${r.issue.id}` : `decision:${r.decision.id}`;
      if (target === source) continue;
      if (!nodes.has(target)) {
        nodes.set(target, { id: target, kind: r.kind, label: r.kind === "issue" ? `${r.label} ${r.issue.title}` : r.kind === "decision" ? `${r.label} ${r.decision.title}` : r.label, href: r.href, degree: 0, inbound: 0 });
      }
      const key = `${source}→${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source, target });
      nodes.get(source)!.degree += 1;
      const t = nodes.get(target)!;
      t.degree += 1;
      t.inbound += 1;
    }
  }
  return { nodes: [...nodes.values()].filter((n) => opts.orphans || n.degree > 0), links };
}

/** /graph — the vault as a force-directed graph, like Obsidian's. */
export function VaultGraph() {
  const { openQuickCreate } = useUi();
  const { notes, issues, decisions, projects } = useLinkIndex();
  const [showIssues, setShowIssues] = useState(true);
  const [showDecisions, setShowDecisions] = useState(true);
  const [orphans, setOrphans] = useState(false);
  const [q, setQ] = useState("");

  const graph = useMemo(
    () => buildGraph({ notes, issues, decisions, projects }, { issues: showIssues, decisions: showDecisions, orphans }),
    [notes, issues, decisions, projects, showIssues, showDecisions, orphans],
  );
  const query = q.trim().toLowerCase();
  const matches = useMemo(() => (query ? new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(query)).map((n) => n.id)) : null), [graph, query]);

  const controls = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-2">
        <Switch id="g-issues" size="sm" checked={showIssues} onCheckedChange={setShowIssues} />
        <Label htmlFor="g-issues" className="text-xs">
          Issues
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="g-decisions" size="sm" checked={showDecisions} onCheckedChange={setShowDecisions} />
        <Label htmlFor="g-decisions" className="text-xs">
          Decisions
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="g-orphans" size="sm" checked={orphans} onCheckedChange={setOrphans} />
        <Label htmlFor="g-orphans" className="text-xs">
          Orphans
        </Label>
      </div>
    </div>
  );

  if (notes.length === 0) {
    return (
      <>
        <PageHeader title="Graph" description="Every note is a node and every [[link]] an edge." />
        <EmptyState icon={<Waypoints />} title="Nothing to draw yet" description="The graph appears once there are notes that link to each other.">
          <Button size="sm" onClick={() => openQuickCreate("note")}>
            New note
          </Button>
        </EmptyState>
      </>
    );
  }

  if (graph.links.length === 0 && !orphans) {
    return (
      <>
        <PageHeader title="Graph" description="Every note is a node and every [[link]] an edge." actions={controls} />
        <EmptyState
          icon={<Waypoints />}
          title="No links yet"
          description="Type [[ inside a note to link another note, an issue such as PLAT-12 or a decision such as ADR-3. Each link becomes an edge here, and the more a note is cited the larger it grows."
        >
          <Button size="sm" variant="outline" onClick={() => setOrphans(true)}>
            Show unlinked notes anyway
          </Button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Graph" description="Every note is a node and every [[link]] an edge. Drag to move, scroll to zoom, click to open." actions={controls} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Highlight…" aria-label="Highlight nodes" dir="auto" className="h-8 ps-8" />
        </div>
        <ul className="flex flex-wrap items-center gap-3 text-xs" aria-label="Legend">
          {LEGEND.map((l) => (
            <li key={l.kind} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: COLOR[l.kind] }} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
        <span className="text-xs text-muted-foreground tabular">
          {graph.nodes.length} nodes · {graph.links.length} links
        </span>
      </div>
      <GraphCanvas graph={graph} matches={matches} />
    </>
  );
}

/**
 * The drawing: a d3-force simulation feeding node positions into React
 * state once per frame, with wheel zoom, background pan and node drag.
 * Mounted only when there is something to draw, so its mount-time effects
 * (resize observer, wheel listener) always find their elements.
 */
function GraphCanvas({ graph, matches }: { graph: Graph; matches: ReadonlySet<string> | null }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const [positions, setPositions] = useState<ReadonlyMap<string, { x: number; y: number }>>(() => new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 560 });

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
    for (const l of graph.links) {
      add(l.source, l.target);
      add(l.target, l.source);
    }
    return m;
  }, [graph]);

  // Fit the SVG to its box; the centre force follows.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One simulation per graph shape. Nodes keep their last position across
  // rebuilds so a live-query refresh nudges the layout instead of resetting it.
  useEffect(() => {
    // Wait for a real box: a simulation started at 0×0 settles around the
    // origin and the weak centre force never pulls it back into view.
    if (!size.w || !size.h) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: SimNode[] = graph.nodes.map((n, i) => {
      const p = prev.get(n.id);
      // New nodes start on a spiral around the centre instead of at (0, 0).
      const angle = i * 2.399963;
      const dist = 14 * Math.sqrt(i);
      return { ...n, r: radius(n), x: p?.x ?? size.w / 2 + dist * Math.cos(angle), y: p?.y ?? size.h / 2 + dist * Math.sin(angle) };
    });
    const links: SimLink[] = graph.links.map((l) => ({ source: l.source, target: l.target }));
    nodesRef.current = nodes;

    const sim = forceSimulation<SimNode>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(95).strength(0.5))
      .force("charge", forceManyBody<SimNode>().strength(-320))
      .force("center", forceCenter<SimNode>(size.w / 2, size.h / 2).strength(0.25))
      .force("collide", forceCollide<SimNode>((d) => d.r + 8));

    let raf = 0;
    sim.on("tick", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setPositions(new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
      });
    });
    simRef.current = sim;
    return () => {
      sim.stop();
      if (raf) cancelAnimationFrame(raf);
      simRef.current = null;
    };
  }, [graph, size.w, size.h]);

  // Wheel zoom around the pointer. Native listener so preventDefault works.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setTransform((t) => {
        const k = Math.min(4, Math.max(0.2, t.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - ((mx - t.x) * k) / t.k, y: my - ((my - t.y) * k) / t.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function toGraph(e: React.PointerEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: (e.clientX - left - transform.x) / transform.k, y: (e.clientY - top - transform.y) / transform.k };
  }

  function onBackgroundDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, tx: transform.x, ty: transform.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onBackgroundMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    setTransform((t) => ({ ...t, x: p.tx + dx, y: p.ty + dy }));
  }
  function onBackgroundUp() {
    panRef.current = null;
  }

  function onNodeDown(e: React.PointerEvent<SVGGElement>, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n) return;
    dragRef.current = { id, moved: false };
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  }
  function onNodeMove(e: React.PointerEvent<SVGGElement>) {
    const d = dragRef.current;
    if (!d) return;
    const n = nodesRef.current.find((x) => x.id === d.id);
    if (!n) return;
    const p = toGraph(e);
    n.fx = p.x;
    n.fy = p.y;
    d.moved = true;
  }
  /** Release a dragged node; returns whether this was a plain click. */
  function releaseNode(id: string) {
    const d = dragRef.current;
    dragRef.current = null;
    const n = nodesRef.current.find((x) => x.id === id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    simRef.current?.alphaTarget(0);
    return Boolean(d && !d.moved);
  }
  function onNodeUp(node: GraphNode) {
    if (releaseNode(node.id)) router.push(node.href);
  }

  const focus = hover ? new Set([hover, ...(neighbours.get(hover) ?? [])]) : null;
  const dimmed = (id: string) => (matches !== null && !matches.has(id)) || (focus !== null && !focus.has(id));
  const hovered = hover ? graph.nodes.find((n) => n.id === hover) : null;
  const identity = transform.x === 0 && transform.y === 0 && transform.k === 1;

  return (
    <div ref={wrapRef} className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-lg border bg-card">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="Graph of linked notes, issues and decisions"
        onPointerDown={onBackgroundDown}
        onPointerMove={onBackgroundMove}
        onPointerUp={onBackgroundUp}
        onPointerCancel={onBackgroundUp}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {graph.links.map((l) => {
            const a = positions.get(l.source);
            const b = positions.get(l.target);
            if (!a || !b) return null;
            const faded = dimmed(l.source) || dimmed(l.target);
            return <line key={`${l.source}→${l.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: faded ? CHROME.grid : CHROME.axis, strokeWidth: 1 / transform.k, opacity: faded ? 0.4 : 0.9 }} />;
          })}
          {graph.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const r = radius(n);
            const label = n.degree >= 1 || hover === n.id || matches?.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                style={{ opacity: dimmed(n.id) ? 0.2 : 1, cursor: "pointer" }}
                onPointerDown={(e) => onNodeDown(e, n.id)}
                onPointerMove={onNodeMove}
                onPointerUp={() => onNodeUp(n)}
                onPointerCancel={() => releaseNode(n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{n.label}</title>
                <circle r={r} style={{ fill: COLOR[n.kind], stroke: "var(--background)", strokeWidth: 1.5 }} />
                {label ? (
                  <text
                    y={r + 11}
                    textAnchor="middle"
                    style={{ fontSize: 11 / Math.sqrt(transform.k), fill: "var(--foreground)", paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3, strokeLinejoin: "round", unicodeBidi: "plaintext", pointerEvents: "none" }}
                  >
                    {truncate(n.label)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {hovered ? (
        <div className="pointer-events-none absolute start-3 top-3 max-w-xs rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm" dir="auto">
          <span className="me-1.5 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: COLOR[hovered.kind] }} aria-hidden />
          <span className="font-medium">{hovered.label}</span>
          <span className="ms-2 text-muted-foreground tabular">
            {hovered.degree} {hovered.degree === 1 ? "link" : "links"}
          </span>
        </div>
      ) : null}
      {!identity ? (
        <Button variant="outline" size="sm" className="absolute end-3 top-3" onClick={() => setTransform({ x: 0, y: 0, k: 1 })}>
          <Maximize /> Reset view
        </Button>
      ) : null}
    </div>
  );
}
