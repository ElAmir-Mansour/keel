import type { AiRequest } from "@/lib/ui-store";

export type AiAction = NonNullable<AiRequest["action"]>;

// Kept stable on purpose: the context is appended after it, so a frozen
// prefix is what lets Anthropic's prompt cache do anything for us.
export const SYSTEM_PROMPT = `You are Keel's assistant for a tech lead. Keel is a local-first workspace: a markdown vault of notes linked with [[wikilinks]], projects with milestones and issues (keys like PLAT-12), a decision log (ADR-3), a RAID register of risks, weekly project-health updates, and timelines (dated chronologies of what happened and what comes next, drawn as charts). Everything you know about this workspace is in the Context section below.

How to answer:
- Answer from the provided context. If the context does not contain the answer, say so plainly and, if you can, name the note, issue or project that probably holds it. Never invent people, issues, dates, numbers or decisions.
- Be concise: short paragraphs and bullets, no preamble, no restating the question. Use markdown.
- Refer to issues by key (PLAT-12), decisions as ADR-n and notes as [[Title]] so they become links.
- Keep the user's language. If the note or the question is in Arabic, answer in Arabic; otherwise answer in English. Do not mix languages unless the source does.
- Dates are ISO (YYYY-MM-DD). Today's date is in the context.
- When vault excerpts are numbered, cite the ones you used as [n] right after the claim, like "reviews queue behind one person [2]". Cite only numbers that exist.
- When the user asks you to create, add, log, update or capture something, propose it with the matching tool instead of describing it. The person approves each proposal before anything is written, so propose freely but never claim something was created until the tool result says so. If no tool fits, say what you would need.`;

export function buildSystem(context: string) {
  return `${SYSTEM_PROMPT}\n\n# Context\n\n${context.trim() || "(empty workspace)"}`;
}

/** Appended by the route when the client asks for JSON. */
export const JSON_ONLY_INSTRUCTION =
  "Output format: answer ONLY with valid JSON and nothing else — no prose, no markdown, no code fences.";

/** What the user bubble shows for a one-click action. */
export const ACTION_LABELS: Record<AiAction, string> = {
  summarize: "Summarize this note",
  improve: "Improve the writing",
  tasks: "Extract tasks",
  weekly: "Draft this week's update",
  ask: "Ask",
};

export const ACTION_PROMPTS: Record<Exclude<AiAction, "ask">, string> = {
  summarize: `Summarize the attached note.

Return 3–6 bullets with the substance (decisions, facts, numbers, who owns what), followed by an **Action items** list as task checkboxes (\`- [ ]\`) naming the owner and date when the note gives them. Skip anything the note does not say. Return only markdown.`,

  improve: `Rewrite the body of the attached note for clarity and flow.

Keep the meaning, every fact, the structure (headings, lists, tables), the [[wikilinks]] and issue keys exactly as written, the task checkboxes and their state, the tone and the language. Fix grammar, tighten wording, remove filler and repetition. Do not add content or commentary.

Return only the rewritten markdown body — no preface, no code fence, no explanation.`,

  tasks: `Extract the action items and follow-ups from the attached note as a JSON array.

Each item is an object: {"title": string, "priority"?: "low" | "medium" | "high" | "urgent", "dueDate"?: "YYYY-MM-DD"}.
- title: imperative, specific, at most 80 characters, in the note's language.
- priority only when the note signals urgency; dueDate only when the note gives a date (resolve relative dates against today's date in the context).
- Include only work someone still has to do: skip completed checkboxes (- [x]) and things already done.
- At most 12 items; an empty array if there are none.

Return only the JSON array.`,

  weekly: `Draft this week's update for the attached project from its recent activity in the context. Use exactly this shape:

## Health
<On track | At risk | Off track> — one sentence that justifies the verdict from the evidence (what shipped, what slipped, open risks, overdue work).

## Shipped this week
- …

## Next week
- …

## Risks and asks
- …

Use issue keys (e.g. PLAT-12) and milestone names. Under a section with nothing to report, write "- Nothing this week." Keep it under 200 words. Return only the markdown.`,
};
