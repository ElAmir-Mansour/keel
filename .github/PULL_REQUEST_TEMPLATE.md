<!-- Title as a conventional commit, e.g. "feat(timelines): export the slide as PDF" -->

## What changes for the user

<!-- One or two sentences. What is different on screen or in behaviour, and why. -->

## How it was tested

<!-- Unit tests added or changed, e2e tests run, manual steps. -->

## Screenshots

<!-- For anything visual: light and dark, and Arabic (RTL) when the layout is affected. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] `pnpm build && pnpm test:e2e` pass if a user journey changed
- [ ] All writes go through `src/lib/repo.ts`; no component calls `db.*` to write
- [ ] Schema changes add a new `.version(n)` block in `src/lib/db.ts` and are named in this description
- [ ] Chart colours use `--viz-*` roles from `src/lib/chart-theme.ts`, never hex
- [ ] New user-visible strings go through `t()` and have Arabic in `src/lib/i18n/ar/*.ts`
- [ ] No new network calls, or they are opt-in and described in the README's privacy section
- [ ] `CHANGELOG.md` has an entry under Unreleased
- [ ] No secrets, keys or workspace data in the diff
