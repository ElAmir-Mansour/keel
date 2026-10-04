import { describe, expect, it } from "vitest";
import { ALL_KINDS, buildWorkspaceGraph, induced, neighbourhood, shapeHash, shortestPath, type GraphSource } from "../graph/model";
import { betweenness, convexHull, degrees, louvain, modularity, truckFactor } from "../graph/metrics";
import { runLens } from "../graph/lenses";
import type { Decision, Issue, Milestone, Note, Person, Project, Risk } from "../types";

const T = "2026-09-01T09:00:00.000Z";
const project = (id: string, key: string, over: Partial<Project> = {}): Project => ({ id, key, name: `Project ${key}`, description: "", color: "#000", status: "active", createdAt: T, updatedAt: T, ...over });
const person = (id: string, name: string): Person => ({ id, name, role: "", color: "#000", createdAt: T, updatedAt: T });
const note = (id: string, title: string, body = "", over: Partial<Note> = {}): Note => ({ id, title, body, kind: "page", folder: "", date: "2026-09-01", tags: [], pinned: false, createdAt: T, updatedAt: T, ...over });
const issue = (id: string, projectId: string, seq: number, over: Partial<Issue> = {}): Issue => ({ id, projectId, seq, title: `Issue ${seq}`, description: "", status: "todo", priority: "none", labels: [], order: 0, createdAt: T, updatedAt: T, ...over });
const decision = (id: string, seq: number, over: Partial<Decision> = {}): Decision => ({ id, seq, title: `Decision ${seq}`, status: "accepted", date: "2026-09-01", context: "", decision: "", consequences: "", alternatives: "", tags: [], createdAt: T, updatedAt: T, ...over });
const risk = (id: string, projectId: string, seq: number, over: Partial<Risk> = {}): Risk => ({ id, projectId, seq, kind: "risk", title: `Risk ${seq}`, description: "", likelihood: 3, impact: 3, status: "open", mitigation: "", createdAt: T, updatedAt: T, ...over });
const milestone = (id: string, projectId: string): Milestone => ({ id, projectId, title: "M1", description: "", status: "active", order: 0, createdAt: T, updatedAt: T });

function source(): GraphSource {
  const plat = project("p1", "PLAT", { leadId: "me" });
  return {
    projects: [plat],
    people: [person("sara", "Sara"), person("me", "Me")],
    milestones: [milestone("m1", "p1")],
    issues: [
      issue("i1", "p1", 1, { assigneeId: "sara", milestoneId: "m1", estimate: 5 }),
      issue("i2", "p1", 2, { assigneeId: "sara", estimate: 3 }),
      issue("i3", "p1", 3, { assigneeId: "sara" }),
      issue("i4", "p1", 4, { assigneeId: "me" }),
      issue("i5", "p1", 5, { status: "done", assigneeId: "me" }),
    ],
    decisions: [decision("d1", 1), decision("d2", 2, { context: "Supersedes [[ADR-1]] because the gate moved." }), decision("d3", 3)],
    notes: [
      note("n1", "Platform sync", "Discussed [[PLAT-1]] and [[ADR-2]]. See [[Runbook]].", { personId: "sara" }),
      note("n2", "Runbook", "Steps."),
      note("n3", "Lonely", "No links here."),
    ],
    risks: [risk("r1", "p1", 1), risk("r2", "p1", 2, { ownerId: "sara", mitigation: "Tracked in [[PLAT-2]]" })],
    timelines: [],
  };
}

const all = { kinds: new Set(ALL_KINDS), structure: true, closed: true, orphans: true };

describe("buildWorkspaceGraph", () => {
  it("creates typed nodes and both knowledge and structural edges", () => {
    const g = buildWorkspaceGraph(source(), all);
    const kinds = (k: string) => g.edges.filter((e) => e.kind === k).length;
    expect(g.nodes.find((n) => n.id === "issue:i1")?.label).toBe("PLAT-1 Issue 1");
    expect(kinds("link")).toBe(4); // n1→PLAT-1, n1→ADR-2, n1→Runbook, r2→PLAT-2
    expect(kinds("supersedes")).toBe(1);
    expect(g.edges.some((e) => e.kind === "part_of" && e.source === "issue:i1" && e.target === "milestone:m1")).toBe(true);
    expect(g.edges.some((e) => e.kind === "part_of" && e.source === "issue:i2" && e.target === "project:p1")).toBe(true);
    expect(g.edges.some((e) => e.kind === "assigned" && e.target === "person:sara")).toBe(true);
    expect(g.edges.some((e) => e.kind === "owns" && e.source === "risk:r2")).toBe(true);
    expect(g.edges.some((e) => e.kind === "owns" && e.source === "project:p1" && e.target === "person:me")).toBe(true);
    expect(g.edges.some((e) => e.kind === "about" && e.source === "note:n1")).toBe(true);
  });
  it("filters by kind, closed work, structure and orphans", () => {
    const knowledge = buildWorkspaceGraph(source(), { kinds: new Set(["note", "decision", "issue"]), structure: false, closed: false, orphans: false });
    expect(knowledge.nodes.some((n) => n.kind === "person")).toBe(false);
    expect(knowledge.nodes.some((n) => n.id === "issue:i5")).toBe(false);
    expect(knowledge.nodes.some((n) => n.id === "note:n3")).toBe(false);
    expect(knowledge.edges.every((e) => e.kind === "link" || e.kind === "supersedes")).toBe(true);
  });
  it("routes work to its project when milestones are hidden", () => {
    const g = buildWorkspaceGraph(source(), { kinds: new Set(["issue", "project"]), structure: true, closed: false, orphans: false });
    expect(g.nodes.some((n) => n.id === "issue:i1")).toBe(true);
    expect(g.edges.some((e) => e.kind === "part_of" && e.source === "issue:i1" && e.target === "project:p1")).toBe(true);
  });
  it("finds a local neighbourhood by depth", () => {
    const g = buildWorkspaceGraph(source(), all);
    expect(neighbourhood(g, "note:n2", 1)).toEqual(new Set(["note:n2", "note:n1"]));
    const two = neighbourhood(g, "note:n2", 2);
    expect(two.has("issue:i1")).toBe(true);
    expect(two.has("person:sara")).toBe(true);
    expect(induced(g, two).edges.every((e) => two.has(e.source) && two.has(e.target))).toBe(true);
  });
});

describe("metrics", () => {
  it("ranks the node on every path highest by betweenness", () => {
    // a — b — c and b — d: b is the bridge.
    const g = { nodes: ["a", "b", "c", "d"].map((id) => ({ id })), edges: [["a", "b"], ["b", "c"], ["b", "d"]].map(([source, target]) => ({ id: source + target, source, target, kind: "link" })) } as never;
    const bc = betweenness(g);
    expect(bc.get("b")).toBeGreaterThan(bc.get("a")!);
    expect(bc.get("b")).toBeCloseTo(1);
    expect(degrees(g).get("b")).toBe(3);
  });
  it("splits two cliques joined by one edge into two communities, deterministically", () => {
    const ids = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];
    const pairs: [string, string][] = [];
    for (const group of [ids.slice(0, 4), ids.slice(4)]) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([group[i], group[j]]);
    pairs.push(["a1", "b1"]);
    const g = { nodes: ids.map((id) => ({ id })), edges: pairs.map(([source, target]) => ({ id: source + target, source, target, kind: "link" })) } as never;
    const c = louvain(g);
    expect(new Set(ids.slice(0, 4).map((id) => c.get(id))).size).toBe(1);
    expect(new Set(ids.slice(4).map((id) => c.get(id))).size).toBe(1);
    expect(c.get("a1")).not.toBe(c.get("b1"));
    expect(modularity(g, c)).toBeGreaterThan(0.3);
    expect(louvain(g)).toEqual(c);
  });
});

describe("lenses", () => {
  const src = source();
  const g = buildWorkspaceGraph(src, all);
  const linksOnly = { nodes: g.nodes, edges: g.edges.filter((e) => e.kind === "link" || e.kind === "supersedes") };
  const input = { graph: g, issues: src.issues, risks: src.risks, projects: src.projects, people: src.people, linkBetweenness: betweenness(linksOnly), community: louvain(g), now: new Date("2026-09-03T00:00:00.000Z") };
  it("finds orphan notes, decisions no note argues for, and broken links", () => {
    expect(runLens("orphans", input).hits.map((h) => h.nodeId)).toEqual(["note:n3"]);
    expect(runLens("decisions_without_notes", input).hits.map((h) => h.nodeId).sort()).toEqual(["decision:d3"]);
    const g2 = buildWorkspaceGraph({ ...src, notes: [...src.notes, note("n4", "Draft", "See [[Missing page]] and [[ADR-99]].")] }, all);
    const r = runLens("unresolved", { ...input, graph: g2 });
    expect(r.hits).toEqual([{ nodeId: "note:n4", detail: "[[Missing page]], [[ADR-99]]" }]);
  });
  it("flags superseded decisions still cited by notes, but not by their successor", () => {
    const s2 = { ...src, decisions: [decision("d1", 1, { status: "superseded" }), decision("d2", 2, { context: "Replaces [[ADR-1]]." })], notes: [note("n9", "Old plan", "Per [[ADR-1]] we will…")] };
    const g2 = buildWorkspaceGraph(s2, all);
    expect(g2.edges.some((e) => e.kind === "supersedes")).toBe(true);
    const r = runLens("superseded_cited", { ...input, graph: g2 });
    expect(r.hits).toEqual([{ nodeId: "decision:d1", detail: "cited by 1" }]);
    expect(r.highlight.has("note:n9")).toBe(true);
  });
  it("flags risks with no owner or no links", () => {
    expect(runLens("unowned_risks", input).hits).toEqual([{ nodeId: "risk:r1", detail: "no owner, nothing links to it · score 9" }]);
  });
  it("finds a project with a truck factor of one", () => {
    const r = runLens("bus_factor", input);
    expect(r.hits).toEqual([{ nodeId: "project:p1", detail: "rests on Sara" }]);
    expect(r.highlight).toEqual(new Set(["project:p1", "person:sara"]));
    expect(truckFactor(src.issues, "p1", new Date("2026-09-03")).factor).toBe(1);
    const shared = src.issues.map((i) => ({ ...i, credits: [{ personId: "sara", share: 0.5 }, { personId: "me", share: 0.5 }] }));
    expect(truckFactor(shared, "p1", new Date("2026-09-03")).factor).toBe(2);
    expect(truckFactor(src.issues.map((i) => ({ ...i, assigneeId: undefined })), "p1").factor).toBe(0);
  });
  it("lists urgent work without a plan and what changed this week", () => {
    const s2 = { ...src, issues: [...src.issues, issue("i9", "p1", 9, { priority: "urgent" })] };
    const g2 = buildWorkspaceGraph(s2, all);
    expect(runLens("unplanned_work", { ...input, graph: g2, issues: s2.issues }).hits).toEqual([{ nodeId: "issue:i9", detail: "no milestone, no assignee" }]);
    expect(runLens("recent", input).hits.length).toBe(g.nodes.length);
    expect(runLens("recent", { ...input, now: new Date("2026-12-01T00:00:00.000Z") }).hits).toEqual([]);
  });
});

describe("paths, hulls and the shape hash", () => {
  const g = buildWorkspaceGraph(source(), all);
  it("finds the shortest path between two nodes", () => {
    expect(shortestPath(g, "note:n2", "issue:i1")).toEqual(["note:n2", "note:n1", "issue:i1"]);
    expect(shortestPath(g, "note:n3", "note:n1")).toBeNull();
  });
  it("wraps points in a convex hull", () => {
    const h = convexHull([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 1 }]);
    expect(h).toHaveLength(4);
    expect(convexHull([{ x: 1, y: 1 }])).toHaveLength(1);
  });
  it("keeps its hash when nothing visible changed, and changes it when a link appears", () => {
    const src = source();
    const a = shapeHash(buildWorkspaceGraph(src, all));
    const edited = { ...src, notes: src.notes.map((n) => (n.id === "n2" ? { ...n, body: "Steps, now longer.", updatedAt: "2026-09-02T00:00:00.000Z" } : n)) };
    expect(shapeHash(buildWorkspaceGraph(edited, all))).toBe(a);
    const linked = { ...src, notes: src.notes.map((n) => (n.id === "n3" ? { ...n, body: "Now see [[Runbook]]." } : n)) };
    expect(shapeHash(buildWorkspaceGraph(linked, all))).not.toBe(a);
  });
  it("adds tag nodes when asked", () => {
    const src = source();
    const tagged = buildWorkspaceGraph({ ...src, notes: src.notes.map((n) => (n.id === "n3" ? { ...n, tags: ["ops"] } : n)) }, all);
    expect(tagged.edges.some((e) => e.kind === "tagged" && e.target === "tag:ops")).toBe(true);
  });
});
