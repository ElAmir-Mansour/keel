"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, Filter, Lightbulb, List, Maximize, Route, Search, Share2, Waypoints, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/ui-bits";
import { useGraphSource } from "@/hooks/use-graph-source";
import { useMounted } from "@/hooks/use-mounted";
import { ago } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { betweenness, clusterNames, degrees, louvain } from "@/lib/graph/metrics";
import { LENSES, runLens, type LensId } from "@/lib/graph/lenses";
import { ALL_KINDS, DEFAULT_BUILD, EDGE_LABELS, NODE_GROUPS, NODE_LABELS, buildWorkspaceGraph, induced, neighbourhood, shapeHash, shortestPath, type GNode, type GNodeKind, type GraphData } from "@/lib/graph/model";
import { downloadBlob } from "@/lib/timeline/export";
import { useUi } from "@/lib/ui-store";
import { GraphCanvas, KIND_SLOT, shapeOf, type GraphCanvasApi } from "./graph-canvas";

// The Graph tab: the whole workspace as one typed graph, with lenses that
// answer one question each, a local graph around any node, the shortest path
// between two, clusters found by community detection, and a list view that
// carries the same information for keyboards and screen readers.

const SETTINGS_KEY = "keel.graph.v1";

interface Settings {
  kinds: GNodeKind[];
  structure: boolean;
  closed: boolean;
  orphans: boolean;
  colorBy: "kind" | "cluster";
  view: "graph" | "list";
  changed: 0 | 7 | 30;
}

const DEFAULTS: Settings = { kinds: [...DEFAULT_BUILD.kinds], structure: true, closed: false, orphans: false, colorBy: "cluster", view: "graph", changed: 0 };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
      s.kinds = s.kinds.filter((k) => (ALL_KINDS as string[]).includes(k));
      return s;
    }
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

function readUrl() {
  if (typeof window === "undefined") return { focus: null as string | null, depth: 0, lens: null as LensId | null };
  const sp = new URLSearchParams(window.location.search);
  const lens = sp.get("lens");
  return { focus: sp.get("focus"), depth: Math.max(0, Math.min(3, Number(sp.get("depth")) || 0)), lens: LENSES.some((l) => l.id === lens) ? (lens as LensId) : null };
}

function writeUrl(state: { focus: string | null; depth: number; lens: LensId | null }) {
  const sp = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(state)) {
    if (v && v !== 0) sp.set(k, String(v));
    else sp.delete(k);
  }
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

/** The edges that define clusters: what people wrote and how work is grouped, not who or which project. */
function clusterGraph(g: GraphData): GraphData {
  return { nodes: g.nodes, edges: g.edges.filter((e) => e.kind === "link" || e.kind === "supersedes" || (e.kind === "part_of" && !e.target.startsWith("project:"))) };
}

/** Small shape-and-colour swatch matching the canvas. */
export function KindSwatch({ kind, className }: { kind: GNodeKind; className?: string }) {
  const shape = shapeOf(kind);
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0", shape === "circle" ? "rounded-full" : shape === "square" ? "rounded-[2px]" : "rotate-45 rounded-[1px]", kind === "tag" && "border-[1.5px] bg-transparent", className)}
      style={kind === "tag" ? { borderColor: `var(${KIND_SLOT[kind]})` } : { backgroundColor: `var(${KIND_SLOT[kind]})` }}
    />
  );
}

/**
 * The graph lives in the browser only: its settings and selection come from
 * localStorage and the URL, so it mounts after hydration instead of rendering
 * a server version that would then disagree.
 */
export function WorkspaceGraph() {
  const mounted = useMounted();
  if (!mounted) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-[68vh] min-h-[420px] animate-pulse rounded-lg bg-muted/60" />
      </div>
    );
  }
  return <GraphPage />;
}

function GraphPage() {
  const t = useT();
  const router = useRouter();
  const { openQuickCreate } = useUi();
  const { source, ready } = useGraphSource();
  const canvas = useRef<GraphCanvasApi>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [url, setUrl] = useState(readUrl);
  const [pathEnd, setPathEnd] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [announce, setAnnounce] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);
  useEffect(() => {
    writeUrl(url);
  }, [url]);
  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));

  // The full graph feeds the lenses; the displayed one follows the filters.
  const full = useMemo(() => buildWorkspaceGraph(source, { kinds: new Set(ALL_KINDS), structure: true, closed: true, orphans: true }), [source]);
  const filtered = useMemo(
    () => buildWorkspaceGraph(source, { kinds: new Set(settings.kinds), structure: settings.structure, closed: settings.closed, orphans: settings.orphans }),
    [source, settings.kinds, settings.structure, settings.closed, settings.orphans],
  );
  const focusVisible = url.focus && filtered.nodes.some((n) => n.id === url.focus) ? url.focus : null;
  const displayed = useMemo(() => (focusVisible && url.depth > 0 ? induced(filtered, neighbourhood(filtered, focusVisible, url.depth)) : filtered), [filtered, focusVisible, url.depth]);
  // The canvas relays out only when this changes, so an edit elsewhere that
  // adds no node or link leaves the picture still.
  const hash = useMemo(() => shapeHash(displayed), [displayed]);

  const degree = useMemo(() => degrees(displayed), [displayed]);
  // Clusters come from the whole workspace, where milestones group the work and
  // links group the thinking, so hiding a type does not reshuffle them. People,
  // tags and "part of project" edges are left out: each touches everything.
  const fullCommunity = useMemo(() => louvain(clusterGraph(full)), [full]);
  const fullDegree = useMemo(() => degrees(full), [full]);
  const names = useMemo(() => clusterNames(full, fullCommunity, fullDegree), [full, fullCommunity, fullDegree]);
  const community = useMemo(() => {
    // Only clusters with at least two visible members colour anything.
    const size = new Map<number, number>();
    for (const n of displayed.nodes) {
      const c = fullCommunity.get(n.id);
      if (c !== undefined) size.set(c, (size.get(c) ?? 0) + 1);
    }
    const out = new Map<string, number>();
    for (const n of displayed.nodes) {
      const c = fullCommunity.get(n.id);
      if (c !== undefined && (size.get(c) ?? 0) >= 2) out.set(n.id, c);
    }
    return out;
  }, [displayed, fullCommunity]);
  const clusterCount = useMemo(() => new Set(community.values()).size, [community]);
  const linkBetweenness = useMemo(() => betweenness({ nodes: full.nodes, edges: full.edges.filter((e) => e.kind === "link" || e.kind === "supersedes") }), [full]);
  const lensInput = useMemo(
    () => ({ graph: full, issues: source.issues, risks: source.risks, projects: source.projects, people: source.people, linkBetweenness, community: fullCommunity }),
    [full, source, linkBetweenness, fullCommunity],
  );
  const lensResults = useMemo(() => new Map(LENSES.map((l) => [l.id, runLens(l.id, lensInput)])), [lensInput]);
  const activeLens = url.lens ? lensResults.get(url.lens) ?? null : null;

  const byId = useMemo(() => new Map(full.nodes.map((n) => [n.id, n])), [full]);
  const shownIds = useMemo(() => new Set(displayed.nodes.map((n) => n.id)), [displayed]);
  const query = q.trim().toLowerCase();
  const changedSince = settings.changed ? now - settings.changed * 86_400_000 : 0;
  const highlight = useMemo(() => {
    if (activeLens) return activeLens.highlight;
    if (query) return new Set(displayed.nodes.filter((n) => n.label.toLowerCase().includes(query)).map((n) => n.id));
    if (changedSince) return new Set(displayed.nodes.filter((n) => n.updatedAt && new Date(n.updatedAt).getTime() >= changedSince).map((n) => n.id));
    return null;
  }, [activeLens, query, changedSince, displayed]);

  const selected = url.focus && byId.has(url.focus) ? url.focus : null;
  const path = useMemo(() => (selected && pathEnd ? shortestPath(filtered, selected, pathEnd) : null), [filtered, selected, pathEnd]);

  const select = useCallback(
    (id: string | null, additive = false) => {
      if (additive && id && url.focus && id !== url.focus) {
        setPathEnd(id);
        return;
      }
      setPathEnd(null);
      setUrl((u) => ({ ...u, focus: id, depth: id ? u.depth : 0 }));
      if (id) setAnnounce(byId.get(id)?.label ?? "");
    },
    [url.focus, byId],
  );
  const open = useCallback((id: string) => {
    const n = byId.get(id);
    if (n) router.push(n.href);
  }, [byId, router]);

  // Page keys: "f" find, "[" and "]" depth.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // "/" is the app-wide command palette, so the graph finds with "f".
      if (e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "]" && url.focus) setUrl((u) => ({ ...u, depth: Math.min(3, u.depth + 1) }));
      else if (e.key === "[" && url.focus) setUrl((u) => ({ ...u, depth: Math.max(0, u.depth - 1) }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url.focus]);

  async function exportPng() {
    try {
      const blob = await canvas.current?.exportPng();
      if (blob) downloadBlob(blob, `keel-graph-${new Date().toISOString().slice(0, 10)}.png`);
      toast.success(t("PNG saved"));
    } catch (e) {
      toast.error(t("Export failed"), { description: e instanceof Error ? e.message : String(e) });
    }
  }

  if (ready && source.notes.length + source.issues.length + source.decisions.length === 0) {
    return (
      <>
        <PageHeader title={t("Graph")} description={t("How notes, decisions, work and people connect.")} />
        <EmptyState icon={<Waypoints />} title={t("Nothing to draw yet")} description={t("The graph appears once there are notes, issues or decisions. Link them with [[ ]] and they connect here.")}>
          <Button size="sm" onClick={() => openQuickCreate("note")}>
            {t("New note")}
          </Button>
        </EmptyState>
      </>
    );
  }

  const kindCount = (k: GNodeKind) => full.nodes.filter((n) => n.kind === k && (settings.closed || !n.closed)).length;
  const hiddenByFilter = selected && !shownIds.has(selected);

  return (
    <>
      <PageHeader
        title={t("Graph")}
        description={t("How notes, decisions, work and people connect, and what that says. Click to select, double-click to open, shift-click a second node for the path between them.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={settings.view} onValueChange={(v) => patch({ view: v as Settings["view"] })}>
              <TabsList className="h-8">
                <TabsTrigger value="graph" className="text-xs">
                  <Share2 /> {t("Graph")}
                </TabsTrigger>
                <TabsTrigger value="list" className="text-xs">
                  <List /> {t("List")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {settings.view === "graph" ? (
              <>
                <Button variant="outline" size="sm" onClick={() => canvas.current?.fit()} aria-label={t("Fit to view")}>
                  <Maximize /> <span className="max-sm:hidden">{t("Fit")}</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => void exportPng()} aria-label={t("Export PNG")}>
                  <Download /> <span className="max-sm:hidden">PNG</span>
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const hit = displayed.nodes.find((n) => n.label.toLowerCase().includes(query));
                if (hit) {
                  select(hit.id);
                  canvas.current?.center(hit.id);
                }
              } else if (e.key === "Escape") setQ("");
            }}
            placeholder={t("Find… (F)")}
            aria-label={t("Find a node")}
            dir="auto"
            className="h-8 ps-8"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <Filter /> {t("Show")}
              <Badge variant="secondary" className="ms-1 h-4 px-1 text-[10px] tabular-nums">
                {settings.kinds.length}/{ALL_KINDS.length}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3">
            <div className="grid gap-3">
              {NODE_GROUPS.map((g) => (
                <fieldset key={g.id} className="grid gap-1.5">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(g.label)}</legend>
                  {g.kinds.map((k) => (
                    <Label key={k} className="flex items-center gap-2 text-sm font-normal">
                      <Checkbox
                        checked={settings.kinds.includes(k)}
                        onCheckedChange={(v) => patch({ kinds: v ? [...settings.kinds, k] : settings.kinds.filter((x) => x !== k) })}
                      />
                      <KindSwatch kind={k} />
                      <span className="flex-1">{t(NODE_LABELS[k])}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{kindCount(k)}</span>
                    </Label>
                  ))}
                </fieldset>
              ))}
              <div className="grid gap-2 border-t pt-3 text-sm">
                <Label className="flex items-center justify-between gap-2 font-normal">
                  {t("Structure (part of, assigned, owns)")}
                  <Switch size="sm" checked={settings.structure} onCheckedChange={(v) => patch({ structure: v })} />
                </Label>
                <Label className="flex items-center justify-between gap-2 font-normal">
                  {t("Closed work")}
                  <Switch size="sm" checked={settings.closed} onCheckedChange={(v) => patch({ closed: v })} />
                </Label>
                <Label className="flex items-center justify-between gap-2 font-normal">
                  {t("Unconnected items")}
                  <Switch size="sm" checked={settings.orphans} onCheckedChange={(v) => patch({ orphans: v })} />
                </Label>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Select value={settings.colorBy} onValueChange={(v) => patch({ colorBy: v as Settings["colorBy"] })}>
          <SelectTrigger size="sm" className="h-8 w-auto text-xs" aria-label={t("Colour by")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cluster">{t("Colour by cluster")}</SelectItem>
            <SelectItem value="kind">{t("Colour by type")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(settings.changed)} onValueChange={(v) => patch({ changed: Number(v) as Settings["changed"] })}>
          <SelectTrigger size="sm" className="h-8 w-auto text-xs" aria-label={t("Highlight recent changes")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t("Any time")}</SelectItem>
            <SelectItem value="7">{t("Changed in 7 days")}</SelectItem>
            <SelectItem value="30">{t("Changed in 30 days")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tabular-nums">{t("{nodes} nodes · {links} links", { nodes: displayed.nodes.length, links: displayed.edges.length })}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {settings.view === "graph" ? (
            <div className="relative h-[68vh] min-h-[420px] overflow-hidden rounded-lg border bg-card">
              {displayed.nodes.length ? (
                <GraphCanvas
                  ref={canvas}
                  graph={displayed}
                  hash={hash}
                  colorBy={settings.colorBy}
                  community={community}
                  clusterNames={names}
                  degree={degree}
                  highlight={highlight}
                  selected={selected}
                  path={path}
                  dimOthers={!(url.depth > 0 && focusVisible)}
                  onSelect={select}
                  onOpen={open}
                  label={t("Workspace graph: {nodes} nodes and {links} links. Use the list view for the same information as a table.", { nodes: displayed.nodes.length, links: displayed.edges.length })}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{t("Nothing matches these filters. Turn on more types under Show.")}</div>
              )}
              <Legend kinds={settings.kinds} colorBy={settings.colorBy} clusters={clusterCount} />
              {url.depth > 0 && focusVisible ? (
                <div className="absolute start-3 top-3 flex items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm">
                  {t("Local graph · depth {d}", { d: url.depth })}
                  <Button variant="ghost" size="icon-xs" aria-label={t("Show the whole graph")} onClick={() => setUrl((u) => ({ ...u, depth: 0 }))}>
                    <X />
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <GraphList graph={displayed} degree={degree} community={community} names={names} highlight={highlight} selected={selected} onSelect={select} />
          )}
          <div className="sr-only" aria-live="polite">
            {announce ? t("Selected {name}", { name: announce }) : ""}
          </div>
        </div>

        <aside className="min-w-0 space-y-3" aria-label={t("Graph details")}>
          {selected ? (
            <NodePanel
              node={byId.get(selected)!}
              full={full}
              hidden={Boolean(hiddenByFilter)}
              depth={url.depth}
              setDepth={(d) => setUrl((u) => ({ ...u, depth: d }))}
              path={path}
              pathEnd={pathEnd ? byId.get(pathEnd) : undefined}
              clearPath={() => setPathEnd(null)}
              onSelect={(id) => {
                select(id);
                canvas.current?.center(id);
              }}
              onClose={() => select(null)}
              showAll={() => patch({ kinds: [...ALL_KINDS], closed: true, orphans: true })}
            />
          ) : null}
          <LensPanel
            results={lensResults}
            active={url.lens}
            setActive={(id) => setUrl((u) => ({ ...u, lens: u.lens === id ? null : id }))}
            byId={byId}
            shown={shownIds}
            onPick={(id) => {
              select(id);
              canvas.current?.center(id);
            }}
          />
        </aside>
      </div>
    </>
  );
}

function Legend({ kinds, colorBy, clusters }: { kinds: GNodeKind[]; colorBy: Settings["colorBy"]; clusters: number }) {
  const t = useT();
  return (
    <div className="pointer-events-none absolute bottom-2 start-2 end-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {colorBy === "kind"
        ? kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded bg-background/70 px-1">
              <KindSwatch kind={k} /> {t(NODE_LABELS[k])}
            </span>
          ))
        : (
            <span className="rounded bg-background/70 px-1">
              {t("{n} clusters · shape shows the type: round knowledge, square work, diamond people", { n: clusters })}
            </span>
          )}
    </div>
  );
}

function LensPanel({ results, active, setActive, byId, shown, onPick }: { results: Map<LensId, ReturnType<typeof runLens>>; active: LensId | null; setActive: (id: LensId) => void; byId: Map<string, GNode>; shown: Set<string>; onPick: (id: string) => void }) {
  const t = useT();
  const groups = ["Knowledge", "Work", "Structure"] as const;
  const activeResult = active ? results.get(active) : null;
  return (
    <section className="rounded-lg border bg-card p-3" aria-label={t("Insights")}>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Lightbulb className="size-4 text-[var(--viz-warning)]" aria-hidden /> {t("Insights")}
      </h2>
      <div className="grid gap-3">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(g)}</h3>
            <ul className="grid gap-0.5">
              {LENSES.filter((l) => l.group === g).map((l) => {
                const n = results.get(l.id)?.hits.length ?? 0;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      aria-pressed={active === l.id}
                      onClick={() => setActive(l.id)}
                      title={t(l.question)}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-sm hover:bg-muted", active === l.id && "bg-primary text-primary-foreground hover:bg-primary/90")}
                    >
                      <span className="min-w-0 flex-1 truncate">{t(l.title)}</span>
                      <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active === l.id ? "bg-primary-foreground/20" : n ? "bg-muted" : "text-muted-foreground")}>{n}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {activeResult ? (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">{t(LENSES.find((l) => l.id === active)!.question)}</p>
          {activeResult.hits.length ? (
            <ul className="grid max-h-72 gap-0.5 overflow-auto" aria-label={t("Lens results")}>
              {activeResult.hits.map((h) => {
                const n = byId.get(h.nodeId);
                if (!n) return null;
                return (
                  <li key={h.nodeId}>
                    <button type="button" onClick={() => onPick(h.nodeId)} className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-start text-sm hover:bg-muted">
                      <KindSwatch kind={n.kind} className="mt-1.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" dir="auto">
                          {n.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground" dir="auto">
                          {h.detail}
                          {!shown.has(h.nodeId) ? ` · ${t("hidden by filters")}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Nothing found. That is good news.")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function NodePanel({
  node,
  full,
  hidden,
  depth,
  setDepth,
  path,
  pathEnd,
  clearPath,
  onSelect,
  onClose,
  showAll,
}: {
  node: GNode;
  full: GraphData;
  hidden: boolean;
  depth: number;
  setDepth: (d: number) => void;
  path: string[] | null;
  pathEnd?: GNode;
  clearPath: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  showAll: () => void;
}) {
  const t = useT();
  const groups = useMemo(() => {
    const byId = new Map(full.nodes.map((n) => [n.id, n]));
    const m = new Map<string, GNode[]>();
    for (const e of full.edges) {
      if (e.source !== node.id && e.target !== node.id) continue;
      const other = byId.get(e.source === node.id ? e.target : e.source);
      if (!other) continue;
      const dir = e.kind === "link" ? (e.source === node.id ? "Links to" : "Linked from") : e.kind === "supersedes" ? (e.source === node.id ? "Supersedes" : "Superseded by") : EDGE_LABELS[e.kind];
      (m.get(dir) ?? m.set(dir, []).get(dir)!).push(other);
    }
    return [...m.entries()].map(([k, v]) => [k, v.sort((a, b) => a.label.localeCompare(b.label))] as const);
  }, [full, node.id]);
  const byId = useMemo(() => new Map(full.nodes.map((n) => [n.id, n])), [full]);
  const unresolved = full.unresolved?.get(node.id) ?? [];

  return (
    <section className="rounded-lg border bg-card p-3" aria-label={t("Selected node")}>
      <div className="flex items-start gap-2">
        <KindSwatch kind={node.kind} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold" dir="auto">
            {node.label}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(NODE_LABELS[node.kind])}
            {node.updatedAt ? ` · ${t("updated {when}", { when: ago(node.updatedAt) })}` : ""}
            {node.closed ? ` · ${t("closed")}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label={t("Close")} onClick={onClose}>
          <X />
        </Button>
      </div>
      {Object.keys(node.meta).length ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {Object.entries(node.meta).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{t(k)}</dt>
              <dd className="truncate" dir="auto">
                {String(v)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {node.kind !== "tag" || node.href ? (
          <Button size="sm" asChild>
            <Link href={node.href}>
              <ExternalLink /> {t("Open")}
            </Link>
          </Button>
        ) : null}
        <div className="flex items-center gap-1 text-xs" role="group" aria-label={t("Local graph depth")}>
          <span className="text-muted-foreground">{t("Local graph")}</span>
          {[0, 1, 2, 3].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={depth === d}
              onClick={() => setDepth(d)}
              className={cn("h-6 min-w-6 rounded-md border px-1.5 tabular-nums", depth === d ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {d === 0 ? t("off") : d}
            </button>
          ))}
        </div>
      </div>
      {hidden ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("Hidden by the current filters.")}{" "}
          <button type="button" className="underline" onClick={showAll}>
            {t("Show everything")}
          </button>
        </p>
      ) : null}
      {path ? (
        <div className="mt-3 rounded-md bg-muted/60 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Route className="size-3.5" aria-hidden /> {t("Path to {name} · {n} steps", { name: pathEnd?.label ?? "", n: path.length - 1 })}
            <Button variant="ghost" size="icon-xs" className="ms-auto" aria-label={t("Clear path")} onClick={clearPath}>
              <X />
            </Button>
          </div>
          <ol className="grid gap-0.5">
            {path.map((id) => (
              <li key={id}>
                <button type="button" className="truncate text-start hover:underline" onClick={() => onSelect(id)} dir="auto">
                  {byId.get(id)?.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : pathEnd ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("No path to {name} with these filters.", { name: pathEnd.label })}</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t("Shift-click another node to see how they connect.")}</p>
      )}
      <div className="mt-3 grid max-h-80 gap-2 overflow-auto border-t pt-2">
        {groups.length ? (
          groups.map(([label, list]) => (
            <div key={label}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(label)} · {list.length}
              </h3>
              <ul className="mt-0.5 grid gap-0.5">
                {list.slice(0, 30).map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => onSelect(o.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start text-sm hover:bg-muted">
                      <KindSwatch kind={o.kind} />
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {o.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{t("No connections.")}</p>
        )}
        {unresolved.length ? (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Broken links")}</h3>
            <ul className="mt-0.5 grid gap-0.5 text-sm">
              {unresolved.map((u) => (
                <li key={u}>
                  <Link href={`/notes/new?title=${encodeURIComponent(u)}`} className="font-mono text-xs text-muted-foreground hover:underline">
                    [[{u}]]
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GraphList({ graph, degree, community, names, highlight, selected, onSelect }: { graph: GraphData; degree: Map<string, number>; community: Map<string, number>; names: Map<number, string>; highlight: Set<string> | null; selected: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  const [sort, setSort] = useState<"links" | "name" | "updated">("links");
  const rows = useMemo(() => {
    const list = graph.nodes.filter((n) => !highlight || highlight.has(n.id));
    return list.sort((a, b) =>
      sort === "name" ? a.label.localeCompare(b.label) : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label),
    );
  }, [graph, highlight, sort, degree]);
  const sortButton = (key: typeof sort, label: string) => (
    <button type="button" onClick={() => setSort(key)} aria-pressed={sort === key} className={cn("font-medium", sort === key ? "text-foreground underline" : "")}>
      {label}
    </button>
  );
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className="text-sm" aria-label={t("Graph as a table")}>
        <TableHeader>
          <TableRow>
            <TableHead>{sortButton("name", t("Name"))}</TableHead>
            <TableHead>{t("Type")}</TableHead>
            <TableHead>{t("Cluster")}</TableHead>
            <TableHead className="text-end">{sortButton("links", t("Connections"))}</TableHead>
            <TableHead className="text-end">{sortButton("updated", t("Updated"))}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((n) => (
            <TableRow key={n.id} data-state={selected === n.id ? "selected" : undefined} className="cursor-pointer" onClick={() => onSelect(n.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(n.id)} tabIndex={0}>
              <TableCell className="max-w-72">
                <span className="flex items-center gap-2">
                  <KindSwatch kind={n.kind} />
                  <span className={cn("truncate", n.closed && "text-muted-foreground line-through")} dir="auto">
                    {n.label}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{t(NODE_LABELS[n.kind])}</TableCell>
              <TableCell className="max-w-40 truncate text-muted-foreground" dir="auto">
                {names.get(community.get(n.id) ?? -1) ?? ""}
              </TableCell>
              <TableCell className="text-end tabular-nums">{degree.get(n.id) ?? 0}</TableCell>
              <TableCell className="text-end text-xs text-muted-foreground">{n.updatedAt ? ago(n.updatedAt) : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length ? <p className="p-4 text-sm text-muted-foreground">{t("Nothing matches.")}</p> : null}
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("{n} rows. Select a row to see its connections in the panel.", { n: rows.length })}</p>
    </div>
  );
}

