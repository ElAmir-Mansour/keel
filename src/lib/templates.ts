import type { NoteKind } from "./types";

// Markdown templates. Kept short on purpose: a template that is longer than
// the document people write with it gets deleted, not filled in.

const DOC_TEMPLATES = {
  page: "",
  prd: `## Problem
What is broken or missing, for whom, and how do we know?

## Goals
- 

## Non-goals
- 

## Proposal
Short description of the change and how it looks to the user.

## Success metrics
| Metric | Today | Target |
|---|---|---|
|  |  |  |

## Open questions
- 
`,
  rfc: `## Summary
One paragraph. What are we changing and why now?

## Context
Constraints, prior art, what already exists.

## Design
The proposal in enough detail to review. Diagrams welcome.

## Alternatives considered
- **Option A** — rejected because…

## Risks and rollout
How this ships, how it rolls back, what could go wrong.

## Open questions
- 
`,
  runbook: `## When to use this
Symptoms that mean this runbook applies.

## Preconditions
Access, tools, and who to tell before starting.

## Steps
1. 
2. 

## Verification
How you know it worked.

## Rollback
`,
  postmortem: `## Summary
One paragraph, blameless: name systems and conditions, never people.

## Timeline (UTC)
| Time | Event |
|---|---|
|  |  |

## Impact
Who was affected, for how long.

## Detection
How we found out — and **time to detect** separately from time to fix.

## Root cause and contributing factors

## Action items
| Action | Type (fix / detect / prevent) | Owner | Due |
|---|---|---|---|
|  |  |  |  |

At least one *detect* item: the reflex is to fix the cause and leave the detection gap open.
`,
  weekly: `## Health
On track / At risk / Off track — and the one sentence that justifies it.

## Shipped this week
- 

## Next week
- 

## Risks and asks
- 
`,
  retro: `## What went well
- 

## What was hard
- 

## What we will change
| Change | Owner | By when |
|---|---|---|
|  |  |  |
`,
};

const PERSONAL_TEMPLATES = {
  daily: `## Focus today
- 

## Notes

## Follow-ups
- [ ] 
`,
  meeting: `**Attendees:** 
**Purpose:** 

## Notes

## Decisions

## Actions
- [ ] 
`,
  oneonone: `## Their agenda

## My agenda

## Notes

## Actions
- [ ] 
`,
  retro: `## Went well
- 

## Went badly
- 

## Change next time
- 
`,
  quick: "",
};

export const NOTE_TEMPLATES: Record<NoteKind, string> = {
  ...PERSONAL_TEMPLATES,
  page: DOC_TEMPLATES.page,
  prd: DOC_TEMPLATES.prd,
  rfc: DOC_TEMPLATES.rfc,
  runbook: DOC_TEMPLATES.runbook,
  postmortem: DOC_TEMPLATES.postmortem,
  weekly: DOC_TEMPLATES.weekly,
  retro: DOC_TEMPLATES.retro,
};
