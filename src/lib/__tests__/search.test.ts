import { describe, expect, it } from "vitest";
import { searchAll } from "../search";
import type { Issue, Note, Project } from "../types";

const project: Project = { id: "p1", key: "PLAT", name: "Platform base", description: "", color: "#000", status: "active", createdAt: "", updatedAt: "" };
const issue: Issue = { id: "i1", projectId: "p1", seq: 4, title: "Rate limit per tenant", description: "", status: "todo", priority: "none", labels: [], order: 0, createdAt: "", updatedAt: "" };
const note: Note = { id: "n1", kind: "page", folder: "Pages", title: "Launch checklist", date: "", body: "escrow the backup key", tags: ["launch"], pinned: false, createdAt: "", updatedAt: "" };

describe("searchAll", () => {
  it("ranks title matches above body matches and matches issue keys", () => {
    const hits = searchAll("launch", { notes: [note], issues: [issue], decisions: [], projects: [project] });
    expect(hits[0].title).toBe("Launch checklist");
    const byKey = searchAll("plat-4", { notes: [note], issues: [issue], decisions: [], projects: [project] });
    expect(byKey.some((h) => h.kind === "issue" && h.subtitle === "PLAT-4")).toBe(true);
  });
  it("returns nothing for an empty query", () => {
    expect(searchAll("  ", { notes: [note], issues: [], decisions: [], projects: [] })).toEqual([]);
  });
});
