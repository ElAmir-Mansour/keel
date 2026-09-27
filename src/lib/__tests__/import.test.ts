import { describe, expect, it } from "vitest";
import { parseCSV, csvRecords } from "../import/csv";
import { mapPriority, mapStatus, toISO } from "../import/common";
import { planLinear } from "../import/linear";
import { planJira } from "../import/jira";
import { parseFrontMatter } from "../import/frontmatter";
import { planObsidian } from "../import/obsidian";
import { linkBase } from "../wikilinks";

describe("parseCSV", () => {
  it("handles quotes, doubled quotes, embedded newlines and CRLF", () => {
    const text = 'a,b,c\r\n1,"hello, ""world""","line1\nline2"\r\n';
    expect(parseCSV(text)).toEqual([
      ["a", "b", "c"],
      ["1", 'hello, "world"', "line1\nline2"],
    ]);
  });
  it("normalises headers", () => {
    const { headers, rows } = csvRecords("Issue Key,  Summary \nK-1,Hi");
    expect(headers).toEqual(["issue key", "summary"]);
    expect(rows[0]["summary"]).toBe("Hi");
  });
});

describe("mappings", () => {
  it("maps statuses by keyword", () => {
    expect(mapStatus("In Progress")).toBe("in_progress");
    expect(mapStatus("Code Review")).toBe("in_review");
    expect(mapStatus("Done")).toBe("done");
    expect(mapStatus("Canceled")).toBe("cancelled");
    expect(mapStatus("Selected for Development")).toBe("todo");
    expect(mapStatus("Weird custom")).toBe("backlog");
  });
  it("maps priorities from words and numbers", () => {
    expect(mapPriority("Urgent")).toBe("urgent");
    expect(mapPriority("1")).toBe("urgent");
    expect(mapPriority("Highest")).toBe("urgent");
    expect(mapPriority("Minor")).toBe("low");
    expect(mapPriority("")).toBe("none");
  });
  it("parses tracker date shapes", () => {
    expect(toISO("2026-09-27T10:00:00.000Z")).toBe("2026-09-27T10:00:00.000Z");
    expect(toISO("27/Sep/26 10:00 AM")?.slice(0, 10)).toBe("2026-09-27");
    expect(toISO("")).toBeUndefined();
  });
});

describe("planLinear", () => {
  it("maps a Linear export", () => {
    const csv = `ID,Team,Title,Description,Status,Estimate,Priority,Project,Assignee,Labels,Created,Updated,Started,Completed,Canceled,Due Date
ENG-12,Engineering,Fix login,"Some text",In Progress,3,High,Auth revamp,Sara Haddad,"bug, backend",2026-09-01T10:00:00.000Z,2026-09-05T10:00:00.000Z,2026-09-02T10:00:00.000Z,,,2026-09-20
ENG-13,Engineering,Old one,,Done,,Low,,,,2026-08-01T10:00:00.000Z,2026-08-10T10:00:00.000Z,2026-08-02T10:00:00.000Z,2026-08-10T10:00:00.000Z,,`;
    const plan = planLinear(csv);
    expect(plan.warnings).toEqual([]);
    expect(plan.issues).toHaveLength(2);
    const a = plan.issues[0];
    expect(a).toMatchObject({ projectName: "Engineering", projectKey: "ENG", seq: 12, status: "in_progress", priority: "high", assignee: "Sara Haddad", milestone: "Auth revamp", labels: ["bug", "backend"], estimate: 3, dueDate: "2026-09-20" });
    expect(plan.issues[1].completedAt).toBe("2026-08-10T10:00:00.000Z");
  });
});

describe("planJira", () => {
  it("maps a Jira export and skips epics", () => {
    const csv = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Due date,Labels,Description,Sprint,Project key,Project name
Big epic,PLAT-1,1,Epic,To Do,Medium,,27/Sep/26 9:00 AM,27/Sep/26 9:00 AM,,,,,,PLAT,Platform
Bind tenant,PLAT-2,2,Story,Done,Highest,Omar Khalil,20/Sep/26 9:00 AM,25/Sep/26 9:00 AM,25/Sep/26 9:00 AM,,tenancy,Desc,Sprint 3,PLAT,Platform`;
    const plan = planJira(csv);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({ projectName: "Platform", projectKey: "PLAT", seq: 2, status: "done", priority: "urgent", milestone: "Sprint 3", labels: ["tenancy"] });
    expect(plan.issues[0].completedAt?.slice(0, 10)).toBe("2026-09-25");
  });
});

describe("front matter and Obsidian", () => {
  it("reads scalars and lists", () => {
    const fm = parseFrontMatter(`---\ntitle: X\ntags: [a, b]\naliases:\n  - one\n  - two\nstatus: in review\n---\nBody #inline`);
    expect(fm.data.tags).toEqual(["a", "b"]);
    expect(fm.data.aliases).toEqual(["one", "two"]);
    expect(fm.body).toBe("Body #inline");
  });
  it("plans notes from a folder", () => {
    const plan = planObsidian([
      { path: "Daily/2026-09-27.md", text: "# Today\n- [ ] thing", modifiedAt: 0 },
      { path: "Meetings/Platform sync.md", text: "---\ntags: [sync]\n---\nSee [[2026-09-27#Today]] and #ops", modifiedAt: 0 },
      { path: ".obsidian/app.json", text: "{}" },
      { path: "img.png", text: "" },
    ]);
    expect(plan.skipped).toEqual([".obsidian/app.json", "img.png"]);
    expect(plan.notes[0]).toMatchObject({ kind: "daily", folder: "Daily", title: "2026-09-27", date: "2026-09-27" });
    expect(plan.notes[1]).toMatchObject({ kind: "meeting", folder: "Meetings", tags: ["sync", "ops"] });
  });
  it("strips heading and block suffixes from link targets", () => {
    expect(linkBase("Note#Heading")).toBe("Note");
    expect(linkBase("Note^abc")).toBe("Note");
    expect(linkBase("Plain")).toBe("Plain");
  });
});
