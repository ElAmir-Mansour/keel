// Tools the assistant may propose. Shared by the route (definitions sent to
// the model) and the browser (execution after the person approves). Schemas
// are strict: additionalProperties false, every listed property required.

export interface AiToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

const PRIORITY = { type: "string", enum: ["none", "low", "medium", "high", "urgent"] };
const STATUS = { type: "string", enum: ["triage", "backlog", "todo", "in_progress", "in_review", "done", "cancelled"] };
const NULLABLE_STRING = { type: ["string", "null"] };

export const AI_TOOLS: AiToolDef[] = [
  {
    name: "create_issues",
    description:
      "Propose new issues in a project. Use when the user asks to create, add, capture or turn something into issues or tasks. The person approves before anything is written.",
    input_schema: {
      type: "object",
      properties: {
        projectKey: { ...NULLABLE_STRING, description: "Project key such as PLAT; null to use the attached or first active project." },
        issues: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Imperative, specific, under 80 characters, in the user's language." },
              description: NULLABLE_STRING,
              priority: { ...PRIORITY, description: "Only when the user signals urgency; otherwise none." },
              dueDate: { ...NULLABLE_STRING, description: "YYYY-MM-DD or null." },
              status: { ...STATUS, description: "Usually backlog; todo when the user says it is next." },
              points: { type: ["number", "null"], description: "Story points when the user gives a size (1, 2, 3, 5, 8, 13), otherwise null. Never guess." },
            },
            required: ["title", "description", "priority", "dueDate", "status", "points"],
            additionalProperties: false,
          },
        },
      },
      required: ["projectKey", "issues"],
      additionalProperties: false,
    },
  },
  {
    name: "log_decision",
    description: "Propose a decision record (ADR) when the user states or asks to log a decision. Fill context, decision and consequences from what was said; never invent.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        context: { type: "string", description: "Why a decision was needed; markdown." },
        decision: { type: "string", description: "What was decided, stated as a fact; markdown." },
        consequences: { type: "string", description: "What becomes easier or harder; markdown, may be short." },
        alternatives: { ...NULLABLE_STRING, description: "Options rejected and why, or null." },
        projectKey: NULLABLE_STRING,
        status: { type: "string", enum: ["proposed", "accepted"] },
      },
      required: ["title", "context", "decision", "consequences", "alternatives", "projectKey", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "create_note",
    description: "Propose a new note in the vault (meeting notes, a page, a draft). Use [[wikilinks]] to existing notes, issues (PLAT-12) and decisions (ADR-3) in the body.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Markdown body." },
        kind: { type: "string", enum: ["page", "daily", "meeting", "oneonone", "retro", "quick", "prd", "rfc", "runbook", "postmortem", "weekly"] },
        projectKey: NULLABLE_STRING,
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body", "kind", "projectKey", "tags"],
      additionalProperties: false,
    },
  },
  {
    name: "update_issue",
    description: "Propose a change to an existing issue identified by its key (PLAT-12): status, priority, assignee name, due date or points. Leave a field null to keep it.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Issue key such as PLAT-12." },
        status: { type: ["string", "null"], enum: ["triage", "backlog", "todo", "in_progress", "in_review", "done", "cancelled", null] },
        priority: { type: ["string", "null"], enum: ["none", "low", "medium", "high", "urgent", null] },
        assignee: { ...NULLABLE_STRING, description: "Person's name as it appears in the workspace, or null." },
        dueDate: { ...NULLABLE_STRING, description: "YYYY-MM-DD, or null." },
        points: { type: ["number", "null"], description: "New story points, or null to keep them. Points lock once work starts; a locked issue keeps its points." },
      },
      required: ["key", "status", "priority", "assignee", "dueDate", "points"],
      additionalProperties: false,
    },
  },
  {
    name: "add_risk",
    description: "Propose a RAID entry (risk, assumption, issue or dependency) for a project with likelihood and impact from 1 to 5.",
    input_schema: {
      type: "object",
      properties: {
        projectKey: NULLABLE_STRING,
        title: { type: "string" },
        kind: { type: "string", enum: ["risk", "assumption", "issue", "dependency"] },
        likelihood: { type: "integer", minimum: 1, maximum: 5 },
        impact: { type: "integer", minimum: 1, maximum: 5 },
        mitigation: { ...NULLABLE_STRING, description: "Markdown, or null." },
      },
      required: ["projectKey", "title", "kind", "likelihood", "impact", "mitigation"],
      additionalProperties: false,
    },
  },
];

const TIMELINE_ENTRY = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short, under 60 characters, in the user's language." },
    start: { type: "string", description: "YYYY-MM-DD. For a month-long phase use its first day and set end." },
    end: { ...NULLABLE_STRING, description: "YYYY-MM-DD inclusive for a phase or range; null for a single day." },
    group: { ...NULLABLE_STRING, description: "Lane or category such as Design, Ops, Release; null for none." },
    kind: { type: "string", enum: ["event", "milestone"], description: "milestone for a key moment (drawn as a diamond)." },
    status: { type: ["string", "null"], enum: ["done", "active", "planned", null], description: "Only when the dates alone would mislead; otherwise null and it follows from today." },
    link: { ...NULLABLE_STRING, description: "An issue key (PLAT-12), ADR-n or a note title to link, or null." },
    note: { ...NULLABLE_STRING, description: "One line of context, or null." },
  },
  required: ["title", "start", "end", "group", "kind", "status", "link", "note"],
  additionalProperties: false,
};

AI_TOOLS.push(
  {
    name: "create_timeline",
    description:
      "Propose a new timeline: a dated chronology of what happened and what comes next, drawn as a chart. Use when the user asks for a timeline, a chronology, a plan over months, or 'what happened between X and Y'. Build entries only from facts in the context or the user's message; never invent dates.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { ...NULLABLE_STRING, description: "One line on what it covers, or null." },
        projectKey: { ...NULLABLE_STRING, description: "Project key to attach to, or null." },
        entries: { type: "array", maxItems: 60, items: TIMELINE_ENTRY },
      },
      required: ["title", "description", "projectKey", "entries"],
      additionalProperties: false,
    },
  },
  {
    name: "add_timeline_entries",
    description: "Propose entries for an existing timeline, named by its title. An entry with the same title and start date as an existing one updates it.",
    input_schema: {
      type: "object",
      properties: {
        timelineTitle: { type: "string", description: "The timeline's title as it appears in the context." },
        entries: { type: "array", maxItems: 60, items: TIMELINE_ENTRY },
      },
      required: ["timelineTitle", "entries"],
      additionalProperties: false,
    },
  },
);

export const AI_TOOL_NAMES = AI_TOOLS.map((t) => t.name);

export function toolByName(name: string) {
  return AI_TOOLS.find((t) => t.name === name);
}
