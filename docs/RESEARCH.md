# Research: what a tech lead's workspace should be

Date: 2026-09-27. This is the research that shaped Keel's v1. Star counts and
prices were read on that day.

## 1. What the persona uses today, and the one complaint per tool

**Planning / roadmaps**

- **Linear** — praised for speed and a keyboard-first, opinionated flow. Complaint: little
  customisation, cloud-only, and a price rise in late 2025.
  https://www.siit.io/tools/comparison/linear-vs-jira
- **Jira** — praised for configurability and governance. Complaint: complexity and setup overhead.
- **Shortcut** — closest drop-in for Linear's feel with built-in docs. Complaint: busy UI.
  (Height shut down on 24 Sep 2025.) https://www.pilotstack.in/linear-vs-height/
- ClickUp / Asana / Monday are generalist; none is engineer-first.

**Docs / wiki**

- **Confluence** — the Jira coupling is its most defensible advantage; slow and dated otherwise.
  https://www.docsie.io/blog/articles/confluence-vs-notion-enterprise-comparison-2026/
- **Notion** — one flexible workspace; sprawls when used as a wiki.
- **Outline** — fast, markdown-native; not OSI open source (BSL) and fiddly to self-host.
- **Docmost** — rising AGPL Confluence/Notion alternative.

**Personal notes**

- **Obsidian** — 1,500+ plugins, handles large vaults; paid sync, weak mobile, and the trap of
  being "busier with the tool than the work". https://workifylab.com/obsidian-sync-options-2026/
- **Logseq** — daily journal and native TODOs; development stalled behind a database rewrite.
- **Reflect** — encrypted and calm, but a subscription for less.

**Engineering dashboards**

- **Jellyfish** — boardroom investment allocation; observes from the management layer.
- **LinearB** — PR automation plus DORA and cycle time; reports upward rather than to the team.
- **Swarmia** — developer-trusted, free for small teams; needs several sprints of data.
  https://codepulsehq.com/guides/engineering-analytics-tools-comparison

## 2. Why Linear feels easy (the patterns Keel copies)

- Everything via keyboard: a ⌘K palette that shows the shortcut beside each command, `g`+letter
  navigation, single-key triage (`1` accept, `2` duplicate, `3` decline, `h` snooze).
  https://linear.app/docs/triage
- Sub-100 ms interactions from a local-first store; undo instead of confirm dialogs.
- An opinionated default flow: Triage → Backlog → In progress → Done; triage is hidden until accepted.
- Cycles are optional; unfinished work rolls over. https://linear.app/docs/use-cycles
- Projects carry a lead, a target date and a weekly **health** (On track / At risk / Off track)
  that replaces most status meetings. https://linear.app/docs/initiative-and-project-updates
- Charts show **scope**: completed against a grey scope line — burn-up, not burn-down.
  https://linear.app/docs/cycle-graph
- "Write issues, not user stories." https://linear.app/method

## 3. What a tech lead produces, ranked by frequency

1. Weekly status update — weekly. https://lethain.com/eng-org-meetings/
2. 1:1 notes — weekly per report.
3. Meeting notes and action items — weekly.
4. RAID / risk register review — weekly.
5. Sprint or cycle plan and retro notes — biweekly.
6. Decision log entry (ADR) — per decision; ADRs are cheap, RFCs are for non-trivial work.
   https://newsletter.pragmaticengineer.com/p/rfcs-and-design-docs
7. RFC / tech spec — per project.
8. Release notes — per release.
9. PRD / one-pager — per feature.
10. Roadmap and OKRs — quarterly.

## 4. Charts: actionable versus vanity

- **Cycle time** — the most useful metric among 978 engineering leaders two years running.
  https://leaddev.com/the-engineering-team-performance-report-2024
- **Cumulative flow** — a widening band is a bottleneck; WIP becomes visible.
- **Burn-up with a scope line** — exposes scope creep. Linear's default.
- **Throughput** — actionable when paired with quality signals.
- **Milestone / project health** — low effort, high read value.
- **DORA four keys** — guardrails for larger orgs; misleading for one small team.
  https://leaddev.com/reporting/are-dora-metrics-right-your-team
- **Burndown, velocity, story points** — widely called vanity: estimates inflate when rewarded.
  https://linearb.io/blog/burndown-charts
- Per-person output metrics read as surveillance. Workload is shown as capacity, never as a score.

## 5. Open-source alternatives and what they still lack for a solo lead

| Project | Stars | Stack / licence | Gap |
|---|---|---|---|
| AppFlowy | 76.9k | Dart + Rust, AGPL | Notion clone, not PM |
| AFFiNE | 73.0k | TS | docs + whiteboard, no issues |
| Plane | 59.9k | TS/Python, AGPL | closest Linear/Jira clone; company-shaped |
| Outline | 40.7k | TS, BSL | wiki only |
| Huly | 27.8k | TS, EPL-2.0 | five datastores to self-host |
| Focalboard | 26.5k | TS | unmaintained |
| Docmost | 21.8k | TS, AGPL | wiki only |
| OpenProject | 16.2k | Ruby, GPL | classic-PM feel |
| Leantime | 11.7k | PHP, AGPL | strategy-first, slower UI |
| Kaneo | 9.2k | TS, MIT | thin, one year old |
| Vikunja | 5.5k | Go, AGPL | best for one person, tasks only |

The common gap: every one is company-shaped (workspaces, members, roles) and splits notes,
plans and metrics across separate products. None pairs a plan with a decision log, a weekly
update and a chart on one screen.

## 6. What this means for Keel v1

1. Keyboard-first with a ⌘K palette that teaches its shortcuts.
2. Issues → projects → one roadmap; opinionated statuses; a triage inbox with 1/2/3/h.
3. Weekly project health with a draft written from the week's activity.
4. A markdown vault with templates (weekly, 1:1, meeting, retro, ADR, PRD, RFC, runbook,
   post-mortem), `[[wikilinks]]`, backlinks and daily notes — the Obsidian lesson without the
   plugin sprawl.
5. First-class decisions (ADR-lite) and a RAID register with a likelihood × impact matrix.
6. Four charts that change a decision: burn-up with scope, cumulative flow, cycle time,
   milestone progress. No velocity. No per-person scorecards.
7. Single user by default, local-first, one deploy, zero configuration.
8. An assistant that reads the vault: summarise, draft the weekly, extract tasks, ask.

## 7. Stack choices (verified 2026-09-27)

- **Next.js 16.3 + React 19.3**, App Router; every data page is a client component and the
  Dexie database is only ever touched in the browser. https://nextjs.org/blog
- **Dexie 4.4** with `dexie-react-hooks`; `useLiveQuery` always receives a default so server
  and first client render match. https://dexie.org/docs/dexie-react-hooks/useLiveQuery()
- **shadcn/ui 4** (Radix, Tailwind v4, RTL enabled) for components; **cmdk** for the palette;
  **@dnd-kit** for the board. https://ui.shadcn.com/docs/cli
- **Plain textarea + react-markdown/remark-gfm** for editing, with a hand-rolled `[[`
  completion; `dir="auto"` keeps mixed Arabic/English readable.
- **Hand-rolled CSS-grid timeline** for the roadmap; no Gantt dependency.
- **Recharts 3** for charts, colours from a validated palette (colour-blind-safe ordinal ramp
  and categorical slots in both themes).
- **@anthropic-ai/sdk** through one route handler; bring-your-own-key by default so a public
  deployment never spends the owner's credits.
- **Vercel** from the GitHub repo; `vercel link` + `vercel --prod` for a manual release.
