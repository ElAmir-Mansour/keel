# Changelog

All notable changes to Keel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor versions may
include breaking changes to the exported JSON shape; the Dexie schema always upgrades in place.

## [Unreleased]

## [0.5.0] — 2026-10-04

### Added

- **A graph that answers questions.** The Graph tab now draws the whole workspace, not only
  notes: notes, issues, decisions, projects, milestones, people, risks, timelines and tags, each
  with its own shape, connected by wikilinks and by structure (part of, assigned to, owned by,
  supersedes, tagged). A Show menu turns each type on or off, and structure, closed work and
  unconnected items each have a switch.
- **Insights.** Ten lenses each answer one question and light up the answer on the graph:
  decisions no note argues for, superseded decisions still cited, orphan notes, broken links,
  unowned risks, projects with a bus factor of one, urgent work without a plan, brokers (the
  items that sit on the most paths), bridges between clusters, and what changed this week.
- **Clusters.** Related work is grouped automatically (Louvain community detection on links and
  milestones), drawn as a tinted region and named after its milestone or most-connected item.
  Colour by cluster or by type.
- **Local graph and paths.** Select a node to see its connections grouped by kind, open it, or
  show only its neighbourhood at depth 1, 2 or 3. Shift-click a second node for the shortest
  path between them. Focus, depth and lens live in the URL, so a view can be bookmarked.
- **List view.** The same graph as a sortable table of names, types, clusters, connections and
  last update, for screen readers and for anyone who prefers rows to dots.
- Find a node with `F`, change depth with `[` and `]`, fit the view, export a PNG, and highlight
  what changed in the last 7 or 30 days. Layout positions and settings are remembered.

### Changed

- The graph renders on a canvas with level-of-detail labels, so it stays responsive with
  thousands of nodes. The previous notes-only graph is gone.

## [0.4.0] — 2026-10-04

### Added

- **Any AI provider.** The assistant works with Anthropic, OpenAI, Google Gemini, OpenRouter,
  Groq, Mistral, DeepSeek, xAI, any OpenAI-compatible endpoint, and models on your own machine
  through Ollama or LM Studio, which need no internet at all. Four fetch-based adapters (Anthropic
  Messages, OpenAI Responses, OpenAI-compatible Chat Completions, Gemini generateContent) stream
  the same events, tool calls included, with no SDK. One key, model and endpoint per provider,
  stored only in the browser; model lists load from each provider.
- Cloud providers go through Keel's relay or, if you prefer, directly from the browser. Local and
  custom endpoints are called from the browser on the web, and through Keel's own server when
  Keel runs on your machine, so offline models work without CORS set-up. The relay never fetches
  an address the browser chose, except a local one when Keel itself runs locally.
- Operators can provide a shared key per provider (`OPENAI_API_KEY`, `GEMINI_API_KEY` and so on)
  behind the existing `KEEL_ALLOW_SERVER_KEY=true` opt-in.
- **Points.** An estimation scale for the workspace (Fibonacci, linear, powers of two or T-shirt
  sizes) with quick picks on every issue and in the new-issue dialog. Points lock when work starts,
  are earned when the issue is done and reversed if it is reopened; re-estimating after the start
  needs a reason and is recorded. Points can be split between several people.
- **KPIs per person.** Points delivered, commitment kept, on-time delivery, cycle time, review
  wait, reopen rate, or a manual result, each with a target, an optional stretch goal, a weight,
  a monthly or quarterly cadence, and a filter by project, label or priority. An issue shows the
  KPIs it counts toward, can be linked to one its filter misses, and assigning it says so.
- **Scorecard** on every person: each KPI against target with a pace marker for the running period,
  a weighted score capped at 150% with rates that have too few items left out visibly, a projected
  end-of-period score, points earned, and a ledger of earned, reversed, adjusted and bonus points.
  A starter set of KPIs is one click; a summary copies into a 1:1 note.
- **Bonuses.** Tiers turn a high KPI score into a suggested number of extra points, drafted for you
  to approve or decline; a payout multiplier follows a threshold–target–stretch curve blended with
  the team's score. Manual adjustments always carry a reason, and decided entries are never deleted.
- The People page shows the quarter's points, score and pace for everyone, by name, never ranked.
- The assistant can set points when it creates or updates issues.

### Changed

- The Content-Security-Policy is now **enforced** rather than report-only. Every origin in it was
  measured in a full session (dashboard, notes, timelines, slide export, the on-device model
  download and a semantic search) with zero violations, and `tests/e2e/csp.spec.ts` keeps it that
  way. Scripts load only from this site and the listed CDN; connections may go to any https origin
  and to `localhost`, so the assistant can reach any provider or a local model from the browser.
- The on-device embedding model is loaded with a plain dynamic `import()` the bundler leaves
  alone instead of an eval-built importer, so the policy needs no `'unsafe-eval'`.

## [0.3.0] — 2026-10-03

### Added

- **Timeline builder.** A new Timelines area (`G L`) for "what happened and what comes next".
  Type dated lines in a small Markwhen-like text form (`2026-09-12: Kickoff`,
  `Sep 20 – Oct 3: Wireframes #Design`, `2026-12-01: !Launch [[PLAT-12]]`, `## Group` for a
  lane, `>` for a note) or fill in rows; entries are the record and the text round-trips.
- Pull milestones, decisions and cycles from a project as timeline entries, so a timeline starts
  from facts rather than memory.
- **To-scale chart:** two-tier time axis, one lane per group, range bars packed into rows,
  diamond milestones with labels that never overlap, a today line, and a story of what happened,
  what is in progress and what is next. One pure layout serves screen, PNG and PDF.
- **Export** as a PDF handout (through the browser's print dialog), PNG in light or dark, SVG
  with colours and fonts baked in, or copy the image or the text. No export library.
- **Management view:** the same timeline reduced to one 1600×900 slide for a steering meeting.
  Entries can be flagged as executive items and carry a baseline date, owner, confidence and a
  reason; the timeline carries a headline, as-of and next-review dates, recorded reviews and the
  decisions leadership owes with owners and dates.
- **RAG from the facts:** done is on track, late against today is off track, slipped past the
  baseline is at risk up to 14 days and off track beyond; an override must say why. Lanes roll up
  to the worst colour with a trend arrow against the last review.
- **Slippage drawn, not narrated:** a hollow baseline diamond and a `+Nd` label; hatched planned
  bars; circle, triangle and square status glyphs that survive printing and colour blindness.
- **Review snapshots** and a "since last review" strip listing what got done, slipped, was added
  or removed.
- A **decisions box** on the slide, a one-line legend, and type and rows that shrink in steps so
  five lanes fit; labels open a new row rather than being cut.
- The slide's axis **mirrors for an Arabic audience**; Arabic strings for the whole Timelines area.
- The assistant can **build or extend a timeline** as an approved action.
- 13 unit tests for the management logic and one end-to-end test for the timeline journey.

### Fixed

- Timeline exports embed the page fonts, so PNG and SVG render the same type as the screen,
  including Arabic shaping.
- A range bar's label no longer moves ahead of the bar when the window ends right after it.
- Text measurement uses the body font before the chart mounts, so the first layout matches the
  drawn text.

## [0.2.0] — 2026-09-28

### Added

- **Sync across devices** through a Supabase project you own: `supabase/schema.sql`, magic-link
  sign-in, last-write-wins per record, tombstoned deletes that travel between devices, offline
  first with merge on reconnect, row-level security per user.
- **Automatic folder backups** (Settings → Automatic backups) through the File System Access
  API: `keel-backup-<date>.json` on a schedule, newest copies kept.
- **Import** from an Obsidian vault (front-matter becomes properties, `[[links]]` keep working),
  Linear CSV exports (teams → projects, Linear projects → milestones) and Jira CSV exports
  (sprints or parents → milestones), with a preview before anything is written.
- **An assistant that acts:** it proposes tool calls (create issues, log a decision, write a
  note, update an issue, add a risk) that you approve one by one before anything is written;
  numbered citations that link back to the note, issue or decision; a weekly digest note per
  active project on the day you choose; optional on-device semantic search with a small
  embedding model that runs in the browser, in English or Arabic.
- **GitHub links:** pull requests and commits linked to issues by key, straight from the browser;
  optionally an opened PR moves the issue to review and a merged PR closes it, stamped with
  GitHub's own times.
- **Cycles and saved views:** optional fixed-length cycles per project, one active and one
  upcoming, with unfinished work rolling forward automatically; saved views for favourite filters.
- **Arabic interface with RTL:** gettext-style `t()` with about 900 Arabic strings across the
  shell, dashboard, issues, vault, settings and assistant; language stored in a cookie so the
  server renders the right direction with no flash; IBM Plex Sans Arabic; charts and code stay
  LTR islands; the assistant sheet flips side.
- **Installable offline app (PWA):** web manifest, icons, service worker with an offline shell,
  install button and update prompt in Settings.
- **Note version history:** a snapshot at most every five minutes, fifty kept, browse and
  restore from the note page.
- **End-to-end tests** with Playwright over a production build (seeding, quick create, palette,
  inbox keys, board drag, note autosave and wikilinks, weekly update, export, theme, phone
  layout), with a CI job and traces on failure.
- **Local folder bridge** for a Keel that runs on your own machine: with `KEEL_LOCAL_DIR` set,
  Markdown under `vault/` imports as notes, JSON bundles under `import/` merge into the
  workspace, and `backups/` is the suggested backup target. The routes answer only to
  localhost. `scripts/macos-launch-agent.sh` runs the production build at login on macOS.

### Fixed

- Task checkboxes in loose lists render their checked state, read from the source line.
- Wikilinks in the preview kept losing their `href` to URL sanitisation.
- Two hydration mismatches on the settings page.
- The GitHub section in Settings uses an icon that exists.

### Changed

- CI reads the pnpm version from `packageManager` instead of a hard-coded value.

## [0.1.0] — 2026-09-27

Initial release.

### Added

- **Vault:** markdown notes with `[[wikilinks]]`, backlinks, folders, tags, pinned notes, daily
  notes, templates for weekly updates, 1:1s, meetings, retros, PRDs, RFCs, runbooks and
  post-mortems, and a graph view of how notes, issues and decisions connect.
- **Plan:** projects, milestones and issues; a triage inbox with single-key actions; a dense issue
  list; a kanban board with drag and drop; a roadmap of milestones; paste a list to get one issue
  per line.
- **Decisions:** an ADR-lite decision log with context, decision, consequences, alternatives,
  status and supersession, linkable from any note as `[[ADR-n]]`.
- **Risks:** a RAID register per project and across projects, scored likelihood × impact, with a
  5 × 5 matrix on the dashboard.
- **Health:** a weekly project update drafted from the week's activity.
- **Dashboard:** burn-up with a scope line, cumulative flow, throughput, cycle-time distribution,
  milestone progress and workload by person, on a colour-blind-safe palette in light and dark.
- **Assistant:** ask questions across the vault, summarise a note, improve its writing, extract
  tasks into issues, draft the weekly update, with your own Anthropic key stored only in the
  browser and a single streaming route handler on the server.
- Command palette (`⌘K`) with every shortcut, sample data for the empty dashboard, JSON export
  and import of the whole workspace.
- `pnpm local` to build once and serve on :3456 for a permanent install on your own machine.

[Unreleased]: https://github.com/ElAmir-Mansour/keel/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/ElAmir-Mansour/keel/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ElAmir-Mansour/keel/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ElAmir-Mansour/keel/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ElAmir-Mansour/keel/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ElAmir-Mansour/keel/releases/tag/v0.1.0
