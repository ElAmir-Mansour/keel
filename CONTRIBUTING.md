# Contributing to Keel

Thank you for taking the time. Keel is a small codebase with a few firm rules; this page lists
them so a first pull request lands without surprises.

## Setup

Keel needs **Node 22** (the version is in `.nvmrc`) and **pnpm 11** (pinned in `package.json`
under `packageManager`; `corepack enable` selects it for you).

```bash
git clone https://github.com/ElAmir-Mansour/keel.git
cd keel
pnpm install
pnpm dev
```

Open http://localhost:3000 and click **Load sample data** to get eight weeks of realistic
history to work against. No environment variables are needed; `.env.example` documents the
optional ones (a server-side assistant key and the local folder bridge).

## Scripts

| Command | What it does |
|---|---|
| `pnpm lint` | ESLint (`eslint-config-next` core-web-vitals and TypeScript rules) |
| `pnpm typecheck` | `tsc --noEmit` against the strict config |
| `pnpm test` | unit tests with Vitest |
| `pnpm build` | production build |
| `pnpm test:e2e` | Playwright end-to-end tests. **Run `pnpm build` first**; the config starts `next start` on port 3100 itself. The first time, install the browser with `pnpm exec playwright install chromium` |
| `pnpm local` | build once and serve on :3456 |

CI runs lint, typecheck, unit tests and the build on every push and pull request, then the
end-to-end suite against the production build. A pull request should be green on all of it.

## Where tests live

- **Unit tests:** `src/lib/__tests__/*.test.ts`, run by Vitest in a Node environment
  (`vitest.config.mts` includes `src/**/*.test.ts`). `fake-indexeddb` is available for code
  that touches Dexie. Pure modules such as `metrics.ts`, `wikilinks.ts`, `cycles.ts`, the
  importers, sync merge rules and the timeline layout and management logic each have a file here.
- **End-to-end tests:** `tests/e2e/*.spec.ts`, run by Playwright in two projects, `desktop`
  (1440×900 Chrome) and `mobile` (Pixel 7, `mobile.spec.ts` only). `tests/e2e/helpers.ts` has
  the shared seeding and navigation helpers. These tests see what users see, so they run against
  a production build, never the dev server.

Add a unit test for logic and an end-to-end test for a new user journey. Bug fixes should come
with a test that failed before the fix.

## Conventions

These come from the code itself; each is written as a comment at the top of the module it
governs, so read the module before changing it.

- **All writes go through `src/lib/repo.ts`.** Pages and components only read (through Dexie
  live queries). The rules that must hold on every write live in one place: per-project issue
  numbers, status transitions that record events and timestamps, `updatedAt` maintenance,
  tombstones so deletes reach other devices. Never call `db.*` for a write from a component.
- **Dexie schema versions are append-only.** `src/lib/db.ts` has one `.version(n).stores({...})`
  block per schema version. For a schema change, bump the version and add a new block. Never
  edit a shipped block; Dexie applies them in order so existing browsers upgrade cleanly.
- **Charts use colour roles, never hex.** Values live in `src/app/globals.css` as `--viz-*`
  custom properties (series, ordinal ramp, status, chrome) with light and dark definitions, and
  `src/lib/chart-theme.ts` exposes them as roles. The palette was validated for colour-vision
  deficiency and contrast in both modes; a new series or status colour goes through the same check.
- **Every user-visible string goes through `t()`.** The English string is the key
  (`t("New issue")`), so code stays readable and a missing translation degrades to English.
  Arabic translations live in `src/lib/i18n/ar/*.ts`, one file per area (`shell`, `dashboard`,
  `issues`, `vault`, `settings`, `assistant`, `timelines`). New UI text needs its Arabic string in
  the same pull request. Check the RTL layout with the language switch in Settings; charts and
  code stay left-to-right islands on purpose.
- **Metrics are pure functions.** `src/lib/metrics.ts` maps records to chart series with no
  I/O; the same holds for `src/lib/timeline/layout.ts` and `management.ts`, which is why they
  are easy to unit test.
- **The server stays minimal.** The only server code is the assistant route
  (`src/app/api/ai/route.ts`), which relays one chat turn to Anthropic with the user's key, and
  the local folder bridge (`src/app/api/local/*`), which answers only to localhost. Keel has no
  server database and no telemetry; a change that adds a network call needs to be opt-in and
  described in the README's privacy section.
- **Assistant actions are proposed, not executed.** Tool calls stream back to the browser and run
  only after the user approves each one. Keep that boundary.
- **New dependencies need a reason.** Prefer what is already in `package.json`; the timeline
  exporters, for example, are plain SVG and the browser's own print dialog rather than a library.

## Commits

Keel uses [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`,
`ci`, `chore`, `refactor`, `test`, with an optional scope that names the area:

```
feat(timelines): management view — one slide for a steering meeting
fix(markdown): read task checkbox state from the source line
docs: point the README at the live deployment
```

Write the body for the reader who finds the commit in a year: what changed for the user and why,
not a list of files. Pull requests are squash-merged, so the PR title should be a valid
conventional commit.

## Pull requests

- Keep each PR to one change. Separate refactors from behaviour changes.
- Fill in the pull request template: what the user sees differently, how you tested it, and
  screenshots or a short recording for anything visual (light and dark, English and Arabic when
  the layout is affected).
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` locally; run `pnpm build && pnpm test:e2e`
  when you touched a user journey.
- A schema change says so in the description and names the new Dexie version.
- Never commit secrets. `.env*` files are git-ignored except `.env.example`.
- Do not add attribution or tooling trailers to commit messages; the author line is enough.

## Reporting bugs and proposing features

Use the issue templates. For bugs, say where Keel was running (the live demo, your own
deployment, `pnpm local` or `pnpm dev`), the browser, and the language setting. Never paste an
API key, a Supabase anon key or exported workspace data into an issue.

Security problems go through the repository's private vulnerability reporting instead; see
[SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind and specific.
