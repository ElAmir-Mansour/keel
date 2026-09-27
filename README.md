# Keel

**Plans, decisions, notes and a dashboard for tech leads.** Local-first, markdown, keyboard-first,
with an AI assistant that reads your vault.

Keel is the workspace a tech lead or technical product manager actually needs in one screen:
an Obsidian-style vault of markdown notes, the projects and issues the team is working on, the
decisions that were made, the risks that are open, and a handful of charts that change what you
do next. It runs entirely in your browser. Nothing leaves the device unless you export it or ask
the assistant a question.

> Live: https://keel-six-amber.vercel.app · Source: https://github.com/ElAmir-Mansour/keel

## What it does

| Area | What you get |
|---|---|
| **Vault** | Markdown notes with `[[wikilinks]]`, backlinks, folders, tags, pinned notes, daily notes (`T`), templates for weekly updates, 1:1s, meetings, retros, PRDs, RFCs, runbooks and post-mortems. A graph view of how notes, issues and decisions connect. |
| **Plan** | Projects → milestones → issues. A triage **inbox** with single-key actions (`1` accept, `2` start, `3` decline, `h` snooze), a dense issue list, a kanban **board** with drag and drop, and a **roadmap** timeline of milestones. Paste a list, get one issue per line. |
| **Decisions** | A first-class decision log (ADR-lite): context, decision, consequences, alternatives, status, supersession. Link a decision from any note with `[[ADR-3]]`. |
| **Risks** | A RAID register per project and across projects, scored likelihood × impact, with a 5 × 5 matrix on the dashboard. |
| **Health** | A weekly project update — on track / at risk / off track — drafted from the week's activity in one click. |
| **Dashboard** | Burn-up with a scope line, cumulative flow, throughput, cycle-time distribution, milestone progress, workload by person (framed as capacity, not a scorecard). No velocity, no vanity. |
| **Assistant** | Ask questions across the vault with numbered citations that link back to the note, issue or decision. Summarise a note, improve its writing, extract tasks, draft the weekly update. Ask it to *do* things and it proposes actions (create issues, log a decision, write a note, update an issue, add a risk) that you approve one by one before anything is written. Bring your own Anthropic key; it is stored only in your browser. |
| **Cycles** | Optional fixed-length cycles per project. One active, one upcoming; when a cycle ends, unfinished work rolls forward on its own. Saved views keep your favourite filters one click away. |
| **GitHub** | Link pull requests and commits to issues by key, straight from the browser. Optionally let an opened PR move the issue to review and a merged PR close it, stamped with GitHub's own times. |
| **Weekly digest** | Once a week, on the day you choose, a digest note is written for every active project: health, what shipped, what is next, risks and asks. The assistant writes it when you have a key; otherwise it is drafted from the facts. |
| **Semantic search** | Optional, on-device: a small embedding model runs in the browser so search and the assistant find notes by meaning, in English or Arabic. |
| **Install** | Installs as an app (PWA) and opens offline. Arabic interface with right-to-left layout is a switch in Settings. |

Everything is reachable from the keyboard: `⌘K` opens the palette (it shows every shortcut),
`C` new issue, `N` new note, `T` today's note, `A` ask the assistant, `G` then a letter to jump.

## Why local-first

A tech lead's notes are the record of why things were decided. Keel keeps them in IndexedDB in
your browser, exports the whole workspace as one JSON file, and imports it back anywhere. There
is no account, no server database and no telemetry. Sync between devices is on the roadmap as an
optional adapter; the data model was designed for it (string ids, ISO timestamps, no server-side
generated fields).

The one feature that sends data off the device is the assistant, and it only sends the context
the panel shows you, only when you press send, and only with the key you pasted.

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, then **Load sample data** on the empty dashboard to see every
screen populated with eight weeks of realistic history.

Requirements: Node 22+, pnpm 11.

### Run it on your own machine, permanently

Keel needs no server: the "server" only serves static files and the optional assistant route.
To keep a production build running locally:

```bash
pnpm local
```

That builds once and serves at http://localhost:3456. Your data stays in that browser profile,
so bookmark the address and keep using the same browser. Pair it with **Automatic backups**
in Settings, which writes a JSON copy to a folder of your choice (a synced folder such as
iCloud Drive or Dropbox works well) on a schedule.

### Keep it safe: backups and sync

Everything lives in your browser's IndexedDB. Two optional layers protect it:

- **Automatic backups** (Settings → Automatic backups): pick a folder once; while Keel is open
  it writes `keel-backup-<date>.json` on a schedule and keeps the newest copies. Chrome and
  Edge only, because it uses the File System Access API; other browsers get a reminder and
  the manual export.
- **Sync across devices** (Settings → Sync): bring your own [Supabase](https://supabase.com)
  project. Run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL editor, enable
  email sign-in, paste the project URL and anon key into Keel, and sign in with a magic link.
  Each device keeps working offline and merges when online: last write wins per record, and
  deletes travel too. Nothing is shared with anyone else; row-level security scopes every row
  to your user.

### Deploy

Keel is a plain Next.js app. On Vercel, import the repository and deploy; no environment
variables are needed. To let visitors use the assistant with **your** key instead of their own,
set `ANTHROPIC_API_KEY` and `KEEL_ALLOW_SERVER_KEY=true` — leave the second unset on a public
deployment, or strangers will spend your credits.

### Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | development server |
| `pnpm build` / `pnpm start` | production build and server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | unit tests (Vitest) |
| `pnpm test:e2e` | end-to-end tests (Playwright) against a production build |
| `pnpm local` | build once and serve on :3456 |

## How it is built

- **Next.js 16** (App Router) and **React 19**, TypeScript strict.
- **Dexie 4** on IndexedDB; every screen is a live query, so edits appear everywhere at once.
- **shadcn/ui** (Radix, Tailwind v4, RTL enabled), **cmdk** for the palette, **@dnd-kit** for the board.
- **react-markdown** with GFM and a hand-rolled `[[` completion; `dir="auto"` so Arabic and
  English mix cleanly in the same note.
- **Recharts 3** with a validated colour-blind-safe palette in light and dark.
- **@anthropic-ai/sdk** behind a single streaming route handler.

The data model, write rules and metrics live in `src/lib/`. All writes go through `repo.ts`;
pages only read. `metrics.ts` is pure functions from records to chart series.

The research behind the feature choices is in [`docs/RESEARCH.md`](docs/RESEARCH.md).

### Bring your data with you

Settings → Import reads an **Obsidian vault** (any folder of Markdown files; front-matter becomes properties, `[[links]]` keep working), a **Linear** CSV export (teams become projects, Linear projects become milestones) or a **Jira** CSV export (sprints or parents become milestones). You see a preview before anything is written.

## Roadmap

- Shared workspaces with sign-in for a whole team.
- Notes as Markdown files on disk, so an Obsidian vault can be opened in place.
- Mobile capture: quick notes and issues from the home screen shortcut.

## Licence

MIT. Built by [ElAmir Mansour](https://github.com/ElAmir-Mansour).
