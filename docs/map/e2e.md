# Map · End-to-end infrastructure

Rules: `.claude/rules/e2e.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry. The specs of a product area live in
that area's map; here are the shell's own specs and what every run stands on.

## e2e

- `e2e/barcode-video.ts` — Global setup: draws an EAN-13 with its own encoder into the one-frame Y4M the `camera` project's fake camera films.
- `e2e/header.spec.ts` — Spec: at 320px, in both languages, the back label steps down by the ladder and never overlaps the title or leaves the window.
- `e2e/live-region.ts` — Helper: records every announcement added to the app's live region, and reads what it holds now.
- `e2e/navigation.spec.ts` — Spec: the shell in a phone browser — tabs and system «back», the nested chevron, collapsing title, safe areas, moves and focus.
- `e2e/pwa-update.spec.ts` — Spec in the `pwa` project, against the built app: a new `sw.js` brings «Update», the tap reloads onto it, nothing reloads by itself; a first visit too, alone and beside another window.
- `e2e/session.ts` — Helper every spec comes in through but the worker's: `open()`, `signedIn()` by the dev seam, and `asBrowser()` headers carrying this browser's cookie.
- `e2e/sheet.spec.ts` — Spec: the sheet on the kit page — one history entry, every way to close, focus trap, page kept in place, taps while it rises.

## repository

- `bin/e2e-database.mjs` — Drops and recreates this copy's `_e2e` database before a run; refuses any other name. Run by `playwright.config.ts`.
- `playwright.config.ts` — Playwright config: the copy's e2e ports and database from `.env`, phone profile, the `camera` project on the full Chromium with a fake camera, starts its own API and PWA, and a build for the `pwa` project; traces on failure.
