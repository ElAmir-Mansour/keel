# Changelog

All notable changes to Keel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor versions may
include breaking changes to the exported JSON shape; the Dexie schema always upgrades in place.

## [Unreleased]

### Changed

- The Content-Security-Policy is now **enforced** rather than report-only. Every origin in it was
  measured in a full session (dashboard, notes, timelines, slide export, the on-device model
  download and a semantic search) with zero violations, and `tests/e2e/csp.spec.ts` keeps it that
  way. A self-hosted Supabase on another domain needs its origin added to `connect-src`.
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

[Unreleased]: https://github.com/ElAmir-Mansour/keel/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ElAmir-Mansour/keel/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ElAmir-Mansour/keel/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ElAmir-Mansour/keel/releases/tag/v0.1.0
