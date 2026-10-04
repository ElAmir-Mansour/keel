"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { convexHull } from "@/lib/graph/metrics";
import type { GEdge, GEdgeKind, GNode, GNodeKind, GraphData } from "@/lib/graph/model";

// The graph drawn on a canvas, so it stays smooth well past a thousand nodes.
// d3-force lays it out; positions live in refs, never in React state, and the
// frame is redrawn only when something changed. Clusters are tinted regions,
// labels are placed greedily by priority so they never pile up, and shape
// carries the group (knowledge round, work square, people diamond) so colour
// is never the only cue.

export interface GraphCanvasApi {
  fit: () => void;
  center: (id: string) => void;
  exportPng: () => Promise<Blob>;
}

interface Props {
  graph: GraphData;
  hash: string;
  colorBy: "kind" | "cluster";
  community: Map<string, number>;
  clusterNames: Map<number, string>;
  degree: Map<string, number>;
  highlight: Set<string> | null;
  selected: string | null;
  path: string[] | null;
  /** Dim everything but the selection's neighbours (off in the local graph, which is already the neighbourhood). */
  dimOthers?: boolean;
  onSelect: (id: string | null, additive: boolean) => void;
  onOpen: (id: string) => void;
  onKey?: (e: React.KeyboardEvent) => void;
  label: string;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: GNode;
  r: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: GEdgeKind;
}

export const KIND_SLOT: Record<GNodeKind, string> = {
  note: "--viz-series-1",
  issue: "--viz-series-2",
  decision: "--viz-series-3",
  milestone: "--viz-series-4",
  timeline: "--viz-series-5",
  project: "--viz-series-6",
  person: "--viz-series-7",
  risk: "--viz-series-8",
  tag: "--viz-muted",
};
const CLUSTER_SLOTS = ["--viz-series-1", "--viz-series-2", "--viz-series-3", "--viz-series-4", "--viz-series-5", "--viz-series-6", "--viz-series-7", "--viz-series-8"];

export type Shape = "circle" | "square" | "diamond";
export function shapeOf(kind: GNodeKind): Shape {
  if (kind === "person") return "diamond";
  if (kind === "project" || kind === "milestone" || kind === "issue" || kind === "risk") return "square";
  return "circle";
}

const LINK_DISTANCE: Record<GEdgeKind, number> = { part_of: 60, tagged: 60, link: 80, supersedes: 70, assigned: 130, owns: 130, about: 120 };

// Positions survive navigation inside the session, and a reload via storage.
const POS_KEY = "keel.graph.positions.v3";
const memory = new Map<string, { x: number; y: number }>();
function loadPositions() {
  if (memory.size) return memory;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) for (const [id, x, y] of JSON.parse(raw) as [string, number, number][]) memory.set(id, { x, y });
  } catch {
    /* storage unavailable */
  }
  return memory;
}
function savePositions(nodes: SimNode[]) {
  for (const n of nodes) memory.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  try {
    const list = [...memory.entries()].slice(-4000).map(([id, p]) => [id, Math.round(p.x), Math.round(p.y)]);
    localStorage.setItem(POS_KEY, JSON.stringify(list));
  } catch {
    /* quota or private mode */
  }
}

export function nodeRadius(n: GNode, degree: number) {
  const base = 4 + 2.5 * Math.sqrt(degree);
  const min = n.kind === "project" ? 10 : n.kind === "person" ? 7 : n.kind === "tag" ? 3 : 4;
  return Math.max(min, Math.min(16, base));
}

/** Grapheme-safe truncation, so Arabic marks and emoji are never split. */
function clip(s: string, max = 30) {
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((x) => x.segment) : [...s];
  return seg.length > max ? `${seg.slice(0, max - 1).join("")}…` : s;
}
const RTL = /[֐-ࣿ]/;

function readVar(name: string, el: Element) {
  return getComputedStyle(el).getPropertyValue(name).trim() || "#888";
}
/** A colour with alpha, from whatever CSS colour string the theme defines. */
function withAlpha(color: string, a: number, ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  const c = ctx.fillStyle; // normalised to #rrggbb or rgba()
  if (c.startsWith("#") && c.length === 7) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

export const GraphCanvas = forwardRef<GraphCanvasApi, Props>(function GraphCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const byIdRef = useRef(new Map<string, SimNode>());
  const view = useRef({ x: 0, y: 0, k: 1, w: 800, h: 560, dpr: 1 });
  const hoverRef = useRef<string | null>(null);
  const propsRef = useRef(props);
  const colors = useRef<Record<string, string>>({});
  const frame = useRef(0); // one-off redraws
  const loopFrame = useRef(0); // the layout loop while the simulation runs
  const loopRef = useRef<(() => void) | null>(null);
  const fitted = useRef(false);
  const touched = useRef(false); // the person panned, zoomed or dragged: stop auto-fitting

  useEffect(() => {
    propsRef.current = props;
  });

  const resolveColors = useCallback(() => {
    const el = wrapRef.current ?? document.documentElement;
    const names = new Set([...Object.values(KIND_SLOT), ...CLUSTER_SLOTS, "--viz-axis", "--viz-grid", "--viz-ink", "--viz-surface", "--viz-muted", "--viz-series-2"]);
    const out: Record<string, string> = {};
    for (const n of names) out[n] = readVar(n, el);
    colors.current = out;
  }, []);

  // ----- drawing ------------------------------------------------------------------

  const draw = useCallback((target?: { ctx: CanvasRenderingContext2D; w: number; h: number; scale: number; transform: { x: number; y: number; k: number } }) => {
    const canvas = canvasRef.current;
    const p = propsRef.current;
    const v = view.current;
    const ctx = target?.ctx ?? canvas?.getContext("2d");
    if (!ctx) return;
    const W = target?.w ?? v.w;
    const H = target?.h ?? v.h;
    const s = target?.scale ?? v.dpr;
    const tr = target?.transform ?? v;
    const c = colors.current;
    const nodes = nodesRef.current;
    const hl = p.highlight;
    const sel = p.selected;
    const pathSet = p.path ? new Set(p.path) : null;
    const pathEdges = new Set<string>();
    if (p.path) for (let i = 1; i < p.path.length; i++) pathEdges.add([p.path[i - 1], p.path[i]].sort().join("|"));
    const focus = hl ?? (sel && p.dimOthers !== false ? new Set([sel, ...neighboursOf(sel)]) : null);
    const lit = (id: string) => !focus || focus.has(id) || pathSet?.has(id);

    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = c["--viz-surface"];
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(s * tr.k, 0, 0, s * tr.k, s * tr.x, s * tr.y);

    const colorOf = (n: SimNode) => {
      if (p.colorBy === "cluster") {
        const ci = p.community.get(n.id);
        return ci === undefined ? c["--viz-muted"] : c[CLUSTER_SLOTS[ci % CLUSTER_SLOTS.length]];
      }
      return c[KIND_SLOT[n.node.kind]];
    };

    // Cluster regions.
    const clusterLabels: { x: number; y: number; text: string }[] = [];
    if (p.colorBy === "cluster") {
      const groups = new Map<number, SimNode[]>();
      for (const n of nodes) {
        const ci = p.community.get(n.id);
        if (ci === undefined) continue;
        (groups.get(ci) ?? groups.set(ci, []).get(ci)!).push(n);
      }
      for (const [ci, members] of groups) {
        if (members.length < 3) continue;
        const hull = convexHull(members.map((m) => ({ x: m.x ?? 0, y: m.y ?? 0 })));
        const col = c[CLUSTER_SLOTS[ci % CLUSTER_SLOTS.length]];
        const dim = focus && !members.some((m) => focus.has(m.id));
        ctx.beginPath();
        hull.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.closePath();
        // withAlpha borrows fillStyle to normalise the colour, so compute it once.
        const tint = withAlpha(col, dim ? 0.03 : 0.09, ctx);
        ctx.fillStyle = tint;
        ctx.strokeStyle = tint;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = 28;
        ctx.fill();
        ctx.stroke();
        const top = hull.reduce((a, b) => (b.y < a.y ? b : a), hull[0]);
        const cx = hull.reduce((n, pt) => n + pt.x, 0) / hull.length;
        clusterLabels.push({ x: cx, y: top.y - 26, text: p.clusterNames.get(ci) ?? "" });
      }
    }

    // Edges, batched by style.
    for (const l of linksRef.current) {
      const a = l.source as SimNode;
      const b = l.target as SimNode;
      if (a.x === undefined || b.x === undefined) continue;
      const onPath = pathEdges.has([a.id, b.id].sort().join("|"));
      const on = onPath || (lit(a.id) && lit(b.id));
      const structural = l.kind !== "link" && l.kind !== "supersedes" && l.kind !== "tagged";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y!);
      ctx.lineTo(b.x, b.y!);
      ctx.setLineDash(l.kind === "supersedes" ? [4 / tr.k, 3 / tr.k] : []);
      ctx.lineWidth = (onPath ? 3 : structural ? 0.8 : 1.2) / tr.k;
      const edgeColor = onPath ? c["--viz-series-2"] : withAlpha(structural ? c["--viz-axis"] : c["--viz-muted"], on ? (structural ? 0.55 : 0.85) : 0.08, ctx);
      ctx.strokeStyle = edgeColor;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes.
    for (const n of nodes) {
      if (n.x === undefined) continue;
      const on = lit(n.id);
      const col = colorOf(n);
      const r = n.r;
      ctx.globalAlpha = on ? (n.node.closed ? 0.45 : 1) : 0.15;
      ctx.beginPath();
      const shape = shapeOf(n.node.kind);
      if (shape === "circle") ctx.arc(n.x, n.y!, r, 0, Math.PI * 2);
      else if (shape === "square") ctx.roundRect(n.x - r, n.y! - r, r * 2, r * 2, Math.min(3, r / 3));
      else {
        ctx.moveTo(n.x, n.y! - r * 1.2);
        ctx.lineTo(n.x + r * 1.2, n.y!);
        ctx.lineTo(n.x, n.y! + r * 1.2);
        ctx.lineTo(n.x - r * 1.2, n.y!);
        ctx.closePath();
      }
      if (n.node.kind === "tag") {
        ctx.fillStyle = c["--viz-surface"];
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5 / tr.k;
        ctx.stroke();
      } else {
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = c["--viz-surface"];
        ctx.lineWidth = 1.5 / tr.k;
        ctx.setLineDash(n.node.kind === "decision" && n.node.meta.status === "superseded" ? [2 / tr.k, 2 / tr.k] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.id === sel || n.id === hoverRef.current) {
        ctx.beginPath();
        ctx.arc(n.x, n.y!, r + 4 / tr.k + 2, 0, Math.PI * 2);
        ctx.strokeStyle = c["--viz-ink"];
        ctx.lineWidth = (n.id === sel ? 2 : 1) / tr.k;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Labels in screen space: 11px whatever the zoom, placed by priority.
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.font = `500 11px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textBaseline = "top";
    const cell = 12;
    const used = new Set<string>();
    const fits = (x0: number, y0: number, w: number, h: number) => {
      const keys: string[] = [];
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor((x0 + w) / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor((y0 + h) / cell); gy++) keys.push(`${gx},${gy}`);
      if (keys.some((k) => used.has(k))) return false;
      for (const k of keys) used.add(k);
      return true;
    };
    const k = tr.k;
    const pri = (n: SimNode) =>
      (n.id === sel ? 1e6 : 0) + (n.id === hoverRef.current ? 5e5 : 0) + (pathSet?.has(n.id) ? 2e5 : 0) + (hl?.has(n.id) ? 1e5 : 0) + (p.degree.get(n.id) ?? 0) * 10 + (n.node.kind === "project" ? 50 : 0);
    const order = nodes.slice().sort((a, b) => pri(b) - pri(a));
    const always = (n: SimNode) => n.id === sel || n.id === hoverRef.current || pathSet?.has(n.id);
    for (const n of order) {
      if (n.x === undefined) continue;
      if (k < 0.5 && !always(n)) continue;
      if (focus && !focus.has(n.id) && !pathSet?.has(n.id)) continue;
      const sx = tr.x + n.x * k;
      const sy = tr.y + (n.y! + n.r) * k + 3;
      if (sx < -100 || sx > W + 100 || sy < -20 || sy > H + 20) continue;
      const text = clip(n.node.label);
      const w = ctx.measureText(text).width;
      if (!always(n) && k <= 1.5 && !fits(sx - w / 2, sy, w, 13)) continue;
      ctx.direction = RTL.test(text) ? "rtl" : "ltr";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = c["--viz-surface"];
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = c["--viz-ink"];
      ctx.globalAlpha = n.node.closed ? 0.6 : 1;
      ctx.fillText(text, sx, sy);
      ctx.globalAlpha = 1;
    }
    // Cluster names when zoomed out.
    if (p.colorBy === "cluster" && k < 1.5) {
      ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
      for (const cl of clusterLabels) {
        if (!cl.text) continue;
        const text = clip(cl.text, 26);
        const sx = tr.x + cl.x * k;
        const sy = tr.y + cl.y * k;
        ctx.direction = RTL.test(text) ? "rtl" : "ltr";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = c["--viz-surface"];
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = c["--viz-muted"];
        ctx.fillText(text, sx, sy);
      }
    }
  }, []);

  function neighboursOf(id: string) {
    const out: string[] = [];
    for (const l of linksRef.current) {
      const a = (l.source as SimNode).id;
      const b = (l.target as SimNode).id;
      if (a === id) out.push(b);
      else if (b === id) out.push(a);
    }
    return out;
  }

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  // ----- view helpers ---------------------------------------------------------------

  const fit = useCallback(() => {
    const nodes = nodesRef.current.filter((n) => n.x !== undefined);
    const v = view.current;
    if (!nodes.length) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x! - n.r);
      y0 = Math.min(y0, n.y! - n.r);
      x1 = Math.max(x1, n.x! + n.r);
      y1 = Math.max(y1, n.y! + n.r + 16);
    }
    const pad = 40;
    const k = Math.min(2.5, Math.max(0.15, Math.min((v.w - pad * 2) / Math.max(1, x1 - x0), (v.h - pad * 2) / Math.max(1, y1 - y0))));
    v.k = k;
    v.x = v.w / 2 - ((x0 + x1) / 2) * k;
    v.y = v.h / 2 - ((y0 + y1) / 2) * k;
    schedule();
  }, [schedule]);

  const center = useCallback(
    (id: string) => {
      const n = byIdRef.current.get(id);
      const v = view.current;
      if (!n || n.x === undefined) return;
      v.x = v.w / 2 - n.x * v.k;
      v.y = v.h / 2 - n.y! * v.k;
      schedule();
    },
    [schedule],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      center,
      exportPng: async () => {
        const v = view.current;
        const scale = 2;
        const off = document.createElement("canvas");
        off.width = v.w * scale;
        off.height = v.h * scale;
        const ctx = off.getContext("2d")!;
        draw({ ctx, w: v.w, h: v.h, scale, transform: { x: v.x, y: v.y, k: v.k } });
        return new Promise<Blob>((ok, fail) => off.toBlob((b) => (b ? ok(b) : fail(new Error("Could not encode PNG"))), "image/png"));
      },
    }),
    [fit, center, draw],
  );

  // ----- size, theme ----------------------------------------------------------------

  useEffect(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    resolveColors();
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const v = view.current;
      v.w = width;
      v.h = height;
      v.dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * v.dpr);
      canvas.height = Math.round(height * v.dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      schedule();
    });
    ro.observe(el);
    // Theme switches redefine the colour roles.
    const mo = new MutationObserver(() => {
      resolveColors();
      schedule();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [resolveColors, schedule]);

  // Redraw when anything visual changes without a new layout.
  useEffect(() => {
    schedule();
  }, [props.highlight, props.selected, props.path, props.colorBy, props.community, props.clusterNames, props.dimOthers, schedule]);

  // ----- simulation: rebuilt only when the graph's shape changes ---------------------

  useEffect(() => {
    const g = propsRef.current.graph;
    const cache = loadPositions();
    const prev = byIdRef.current;
    let warm = 0;
    const nodes: SimNode[] = g.nodes.map((node, i) => {
      const old = prev.get(node.id);
      const cached = old ? { x: old.x ?? 0, y: old.y ?? 0 } : cache.get(node.id);
      if (cached) warm += 1;
      const angle = i * 2.399963;
      const dist = 16 * Math.sqrt(i);
      return { id: node.id, node, r: nodeRadius(node, propsRef.current.degree.get(node.id) ?? 0), x: cached?.x ?? dist * Math.cos(angle), y: cached?.y ?? dist * Math.sin(angle) };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = g.edges.filter((e: GEdge) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
    nodesRef.current = nodes;
    linksRef.current = links;
    byIdRef.current = byId;
    const warmStart = nodes.length > 0 && warm / nodes.length > 0.8;
    // A new shape (filters, local graph) is a new picture: follow it until touched.
    touched.current = false;

    const big = nodes.length > 1000;
    // Each cluster gets an anchor on a ring and its members drift toward it, so
    // clusters read as separate regions instead of one overlapping wash. Items in
    // no cluster (people, projects, loose tags) stay in the middle, between them.
    const comm = propsRef.current.community;
    const clusterIds = [...new Set(nodes.map((n) => comm.get(n.id)).filter((c): c is number => c !== undefined))].sort((a, b) => a - b);
    const ring = clusterIds.length > 1 ? 40 + 24 * Math.sqrt(nodes.length) : 0;
    const anchor = new Map(clusterIds.map((c, i) => {
      const a = (i / clusterIds.length) * 2 * Math.PI - Math.PI / 2;
      return [c, { x: ring * Math.cos(a), y: ring * Math.sin(a) }];
    }));
    const anchorOf = (d: SimNode) => anchor.get(comm.get(d.id) ?? -1);
    const pull = (d: SimNode) => (anchorOf(d) ? 0.1 : 0.06);
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          // A project touches everything in it; as a strong spring it would pull the
          // whole workspace into a star. Links and milestones shape the layout instead.
          .distance((l) => (l.kind === "part_of" && (l.target as SimNode).node?.kind === "project" ? 150 : LINK_DISTANCE[l.kind]))
          .strength((l) => (l.kind === "part_of" ? ((l.target as SimNode).node?.kind === "project" ? 0.04 : 0.4) : l.kind === "link" || l.kind === "supersedes" ? 0.5 : 0.15)),
      )
      .force("charge", forceManyBody<SimNode>().strength(big ? -140 : -300).theta(big ? 1.2 : 0.9).distanceMax(500))
      .force("x", forceX<SimNode>((d) => anchorOf(d)?.x ?? 0).strength(pull))
      .force("y", forceY<SimNode>((d) => anchorOf(d)?.y ?? 0).strength(pull))
      .alphaDecay(warmStart ? 0.05 : 0.0228)
      .alpha(warmStart ? 0.3 : 1);
    if (nodes.length <= 1500) sim.force("collide", forceCollide<SimNode>((d) => d.r + 5));
    sim.stop();
    // Settle a little before the first paint so it does not explode on screen.
    const budget = performance.now() + 60;
    while (sim.alpha() > 0.08 && performance.now() < budget) sim.tick();
    if (!fitted.current || !warmStart) {
      fitted.current = true;
      fit();
    }
    let running = true;
    const loop = () => {
      loopFrame.current = 0;
      if (!running) return;
      const t0 = performance.now();
      while (sim.alpha() > sim.alphaMin() && performance.now() - t0 < 8) sim.tick();
      if (!touched.current) fit();
      draw();
      if (sim.alpha() > sim.alphaMin()) loopFrame.current = requestAnimationFrame(loop);
      else savePositions(nodes);
    };
    simRef.current = sim;
    loopRef.current = () => {
      if (!loopFrame.current) loopFrame.current = requestAnimationFrame(loop);
    };
    loopRef.current();
    return () => {
      running = false;
      sim.stop();
      if (loopFrame.current) cancelAnimationFrame(loopFrame.current);
      loopFrame.current = 0;
      loopRef.current = null;
      savePositions(nodes);
    };
    // The hash stands for the graph's shape; node fields update below without a relayout.
  }, [props.hash, draw, fit]);

  // Same shape, new fields (a renamed note, a closed issue): update in place.
  useEffect(() => {
    for (const node of props.graph.nodes) {
      const sn = byIdRef.current.get(node.id);
      if (sn) {
        sn.node = node;
        sn.r = nodeRadius(node, props.degree.get(node.id) ?? 0);
      }
    }
    schedule();
  }, [props.graph, props.degree, schedule]);

  // ----- input ----------------------------------------------------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "drag" | "pinch" | null; id?: string; sx: number; sy: number; tx: number; ty: number; moved: boolean; dist?: number; k?: number; mx?: number; my?: number }>({ kind: null, sx: 0, sy: 0, tx: 0, ty: 0, moved: false });

  const toGraph = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };
  const hit = (clientX: number, clientY: number) => {
    const p = toGraph(clientX, clientY);
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (n.x === undefined) continue;
      const d = Math.hypot(n.x - p.x, n.y! - p.y);
      const reach = n.r + 6 / view.current.k;
      if (d <= reach && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = view.current;
      const k = Math.min(6, Math.max(0.1, v.k * Math.exp(-e.deltaY * 0.0015)));
      v.x = mx - ((mx - v.x) * k) / v.k;
      v.y = my - ((my - v.y) * k) / v.k;
      v.k = k;
      schedule();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [schedule]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = view.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      gesture.current = { kind: "pinch", sx: 0, sy: 0, tx: v.x, ty: v.y, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top };
      return;
    }
    const n = hit(e.clientX, e.clientY);
    gesture.current = n ? { kind: "drag", id: n.id, sx: e.clientX, sy: e.clientY, tx: 0, ty: 0, moved: false } : { kind: "pan", sx: e.clientX, sy: e.clientY, tx: v.x, ty: v.y, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    const v = view.current;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.kind === "pinch" && pointers.current.size === 2) {
      touched.current = true;
      const [a, b] = [...pointers.current.values()];
      const k = Math.min(6, Math.max(0.1, g.k! * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist!)));
      v.x = g.mx! - ((g.mx! - g.tx) * k) / g.k!;
      v.y = g.my! - ((g.my! - g.ty) * k) / g.k!;
      v.k = k;
      schedule();
      return;
    }
    if (!g.kind) {
      const n = hit(e.clientX, e.clientY);
      const id = n?.id ?? null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        e.currentTarget.style.cursor = id ? "pointer" : "grab";
        e.currentTarget.title = n ? n.node.label : "";
        schedule();
      }
      return;
    }
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    touched.current = true;
    if (g.kind === "pan") {
      v.x = g.tx + dx;
      v.y = g.ty + dy;
      schedule();
    } else if (g.kind === "drag" && g.id) {
      const n = byIdRef.current.get(g.id);
      const sim = simRef.current;
      if (!n || !sim) return;
      const p = toGraph(e.clientX, e.clientY);
      n.fx = p.x;
      n.fy = p.y;
      if (sim.alpha() < 0.1) {
        sim.alphaTarget(0.25);
        sim.alpha(0.3);
      }
      loopRef.current?.();
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === "drag" && g.id) {
      const n = byIdRef.current.get(g.id);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      simRef.current?.alphaTarget(0);
      if (!g.moved) propsRef.current.onSelect(g.id, e.shiftKey);
    } else if (g.kind === "pan" && !g.moved) {
      propsRef.current.onSelect(null, false);
    }
    if (pointers.current.size === 0) gesture.current = { kind: null, sx: 0, sy: 0, tx: 0, ty: 0, moved: false };
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const n = hit(e.clientX, e.clientY);
    if (n) propsRef.current.onOpen(n.id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const p = propsRef.current;
    if (e.key === "0") {
      e.preventDefault();
      fit();
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      touched.current = true;
      const v = view.current;
      const k = Math.min(6, Math.max(0.1, v.k * (e.key === "-" ? 0.8 : 1.25)));
      v.x = v.w / 2 - ((v.w / 2 - v.x) * k) / v.k;
      v.y = v.h / 2 - ((v.h / 2 - v.y) * k) / v.k;
      v.k = k;
      schedule();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const cur = p.selected ? byIdRef.current.get(p.selected) : null;
      if (!cur) {
        const first = nodesRef.current.slice().sort((a, b) => (p.degree.get(b.id) ?? 0) - (p.degree.get(a.id) ?? 0))[0];
        if (first) {
          p.onSelect(first.id, false);
          center(first.id);
        }
        return;
      }
      // Nearest neighbour in the arrow's direction.
      const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as "ArrowRight"] ?? [1, 0];
      const cand = neighboursOf(cur.id)
        .map((id) => byIdRef.current.get(id)!)
        .filter(Boolean)
        .map((n) => {
          const dx = n.x! - cur.x!;
          const dy = n.y! - cur.y!;
          const along = dx * dir[0] + dy * dir[1];
          return { n, score: along > 0 ? Math.hypot(dx, dy) - along * 0.5 : Infinity };
        })
        .filter((c) => Number.isFinite(c.score))
        .sort((a, b) => a.score - b.score)[0];
      if (cand) {
        p.onSelect(cand.n.id, false);
        center(cand.n.id);
      }
      return;
    }
    if (e.key === "Enter" && p.selected) {
      e.preventDefault();
      p.onOpen(p.selected);
      return;
    }
    if (e.key === "Escape") {
      p.onSelect(null, false);
      return;
    }
    p.onKey?.(e);
  }

  return (
    <div ref={wrapRef} className="ltr-island relative h-full w-full">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={props.label}
        className="block h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (hoverRef.current) {
            hoverRef.current = null;
            schedule();
          }
        }}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        data-testid="graph-canvas"
      />
    </div>
  );
});
