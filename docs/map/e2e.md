# Map · End-to-end infrastructure

Rules: `.claude/rules/e2e.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry. The specs of a product area live in
that area's map; here are the shell's own specs and what every run stands on.

## e2e

- `e2e/barcode-video.ts` — Global setup: draws an EAN-13 with its own encoder into the one-frame Y4M the `camera` project's fake camera films.
- `e2e/header.spec.ts` — Spec: at 320px, in both languages, the back label steps down by the ladder and never overlaps the title or leaves the window.
- `e2e/live-region.ts` — Helper: records every announcement added to the app's live region, and reads what it holds now.
- `e2e/motion.spec.ts` — Spec with motion on: a kept month just there, a day removed shrinking once and taking its gap, no second arrival after a move or the browser's own back, the charts' answer coming in.
- `e2e/navigation.spec.ts` — Spec: the shell in a phone browser — tabs and system «back», the nested chevron, collapsing title, safe areas, moves and focus.
- `e2e/client-errors.spec.ts` — A failure on the phone reaches the API (MOL-144): an answer of «Что брать» off the contract, the screen's «error», `POST /client-errors` answered `204`, and neither the API's answer nor the message in the body.
- `e2e/client-errors-built.spec.ts` — Spec in the `pwa` project, against the built app (MOL-144): a failure names its build by the page's own script and its frames are paths under `/assets`.
- `e2e/pwa-update.spec.ts` — Spec in the `pwa` project, against the built app: a new `sw.js` brings «Update», the tap reloads onto it, nothing reloads by itself; a first visit too, alone and beside another window.
- `e2e/scheme.spec.ts` — Spec: the device's scheme (MOL-111) — chosen against the system both ways, drawn by the head's script without the app, «Системная» one line at 320 px, another window following.
- `e2e/scroll.ts` — Helper: stands a control a given distance below the top of the window and reads where it stands, for «the page stayed».
- `e2e/session.ts` — Helper every spec comes in through but the worker's: `open()`, `signedIn()` by the dev seam, and `asBrowser()` headers carrying this browser's cookie.
- `e2e/sheet.spec.ts` — Spec: the sheet on the kit page — one history entry, every way to close, focus trap, page kept in place, taps while it rises.

## repository

- `bin/fake-open-food-facts.mjs` — A stand-in for Open Food Facts in a run (MOL-162): knows every code led by `46` as a can of stew, every other as unknown, refuses a request without our User-Agent. Started by `playwright.config.ts` on the API's port + 1.
- `bin/fake-receipt-reader.mjs` — A stand-in for the receipt reader in a run (MOL-127, Р-7): every photo is read as the bench read am-05, the item rows under a made-up header, so a receipt taken in the browser is read, reviewed and recorded with no Tesseract. Started by `playwright.config.ts` on the API's port + 3.
- `bin/e2e-database.mjs` — Drops and recreates this copy's `_e2e` database before a run; refuses any other name. Run by `playwright.config.ts`.
- `playwright.config.ts` — Playwright config: the copy's e2e ports and database from `.env`, phone profile, starts its own API and PWA, and a build for the `pwa` project; the `camera` project on the full Chromium with a fake camera; an iPhone profile for the sheet alone; traces on failure.
