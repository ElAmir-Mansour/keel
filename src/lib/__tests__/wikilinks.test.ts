import { describe, expect, it } from "vitest";
import { backlinksTo, extractLinks, resolveLink, rewriteWikiLinks, suggestTargets } from "../wikilinks";
import type { Decision, Issue, Note, Project } from "../types";

const note = (title: string, body = ""): Note => ({
  id: title, kind: "page", folder: "Pages", title, date: "2026-09-27", body, tags: [], pinned: false, createdAt: "", updatedAt: "",
});
const project: Project = { id: "p1", key: "PLAT", name: "Platform", description: "", color: "#000", status: "active", createdAt: "", updatedAt: "" };
const issue: Issue = { id: "i1", projectId: "p1", seq: 12, title: "Bind tenant", description: "", status: "todo", priority: "none", labels: [], order: 0, createdAt: "", updatedAt: "" };
const decision: Decision = { id: "d1", seq: 3, title: "Postgres only", status: "accepted", date: "", context: "", decision: "", consequences: "", alternatives: "", tags: [], createdAt: "", updatedAt: "" };
const idx = { notes: [note("Platform sync"), note("Weekly")], issues: [issue], decisions: [decision], projects: [project] };

describe("extractLinks", () => {
  it("parses targets and aliases", () => {
    expect(extractLinks("see [[Platform sync]] and [[PLAT-12|the issue]]")).toEqual([
      { raw: "[[Platform sync]]", target: "Platform sync", alias: undefined },
      { raw: "[[PLAT-12|the issue]]", target: "PLAT-12", alias: "the issue" },
    ]);
  });
});

describe("rewriteWikiLinks", () => {
  it("turns wikilinks into wiki: markdown links", () => {
    expect(rewriteWikiLinks("a [[B C|label]] d")).toBe("a [label](wiki:B%20C) d");
  });
});

describe("resolveLink", () => {
  it("resolves notes case-insensitively", () => {
    const r = resolveLink("platform SYNC", idx);
    expect(r.kind).toBe("note");
    expect(r.href).toBe("/notes/Platform sync");
  });
  it("resolves issue keys and ADR numbers", () => {
    expect(resolveLink("PLAT-12", idx).href).toBe("/projects/p1/issues/12");
    expect(resolveLink("adr-3", idx).kind).toBe("decision");
  });
  it("marks unknown targets as missing with a create link", () => {
    const r = resolveLink("Nope", idx);
    expect(r.kind).toBe("missing");
    expect(r.href).toContain("/notes/new?title=Nope");
  });
});

describe("backlinksTo", () => {
  it("finds notes linking to any of the targets", () => {
    const notes = [note("A", "links [[Weekly]]"), note("B", "nothing"), note("C", "[[ADR-3]]")];
    expect(backlinksTo(["weekly", "ADR-3"], notes).map((n) => n.title)).toEqual(["A", "C"]);
  });
});

describe("suggestTargets", () => {
  it("offers notes, issue keys and ADRs", () => {
    const labels = suggestTargets("", idx).map((s) => s.label);
    expect(labels).toContain("Platform sync");
    expect(labels).toContain("PLAT-12");
    expect(labels).toContain("ADR-3");
  });
});
