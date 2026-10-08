# Map · End-to-end infrastructure

Rules: `.claude/rules/e2e.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry. The specs of a product area live in
that area's map; here are the shell's own specs and what every run stands on.

## e2e

- `e2e/barcode-video.ts` — Global setup: draws an EAN-13 with its own encoder into the one-frame Y4M the `camera` project's fake camera films.
- `e2e/header.spec.ts` — Spec: at 320px, in both languages, the back label steps down by the ladder and never overlaps the title or leaves the window.
- `e2e/keyboard.ts` — Helper: stands in for the iOS keyboard — the visual viewport replaced before the app loads, moved by `keyboard(covered, pan)` as Safari moves it (MOL-135); shared by «Деньги» and the sheet (MOL-182).
- `e2e/live-region.ts` — Helper: records every announcement added to the app's live region, and reads what it holds now.
- `e2e/motion.spec.ts` — Spec with motion on: a kept month just there, a day removed shrinking once and taking its gap, no second arrival after a move or the browser's own back, the charts' answer coming in.
- `e2e/navigation.spec.ts` — Spec: the shell in a phone browser — tabs and system «back», the nested chevron, collapsing title, safe areas, moves and focus.
- `e2e/client-errors.spec.ts` — A failure on the phone reaches the API (MOL-144): an answer of «Что брать» off the contract, the screen's «error», `POST /client-errors` answered `204`, and neither the API's answer nor the message in the body.
- `e2e/client-errors-built.spec.ts` — Spec in the `pwa` project, against the built app (MOL-144): a failure names its build by the page's own script and its frames are paths under `/assets`.
- `e2e/outdated-built.spec.ts` — Spec in the `pwa` project, against the built app (MOL-231): a browser below the floor gets the locales' line in place of the app, makes no request to the API and registers no worker; one at the floor sees the app untouched.
- `e2e/pwa-update.spec.ts` — Spec in the `pwa` project, against the built app: a new `sw.js` brings «Update», the tap reloads onto it, nothing reloads by itself; a first visit too, alone and beside another window; an error at the door while a version waits offers «Update» once, first (MOL-180, 8c).
- `e2e/scheme.spec.ts` — Spec: the device's scheme (MOL-111) — chosen against the system both ways, drawn by the head's script without the app, «Системная» one line at 320 px, another window following.
- `e2e/scroll.ts` — Helper: stands a control a given distance below the top of the window and reads where it stands, for «the page stayed».
- `e2e/session.ts` — Helper every spec comes in through but the worker's: `open()`, `signedIn()` by the dev seam, and `asBrowser()` headers carrying this browser's cookie.
- `e2e/sheet.spec.ts` — Spec: the sheet on the kit page — one history entry, every way to close, focus trap, page kept in place, taps while it rises.
- `e2e/kit-inactive.spec.ts` — Spec in `phone` and `iphone`: «not now» of the kit on `/_kit` — an inactive segmented control walks the focus without choosing, an inactive switch holds against Space and a tap on its words, an inactive button takes the focus and does not light up (MOL-174); an inactive row is followed by neither Enter, a middle click nor a tap (MOL-175).
- `e2e/kit-rows.spec.ts` — Spec in `phone` and `iphone`: the kit's rows on `/_kit` — a chosen row shows the keyboard's focus inside its ring, the fill between them, and keeps the card's hairline above it straight (MOL-175).
- `e2e/state-strip.spec.ts` — Spec in `phone` and `iphone`: on `/_kit`, an error of the whole screen draws «Try again» in the strip and only there, and the focus on it goes with it between the strip and the block (MOL-180, А2).

## repository

- `bin/fake-open-food-facts.mjs` — A stand-in for Open Food Facts in a run (MOL-162): knows every code led by `46` as a can of stew, every other as unknown, refuses a request without our User-Agent. Started by `playwright.config.ts` on the API's port + 1.
- `bin/fake-purs.mjs` — A stand-in for the Serbian tax office's check in a run (MOL-232): reads the link's `vl` as the tax office does and answers a journal of two lines under a head that names nobody; the requesting unit picks the case — just printed, never shown, not valid. Started by `playwright.config.ts` on the API's port + 4.
- `bin/fake-receipt-reader.mjs` — A stand-in for the receipt reader in a run (MOL-127, Р-7): every photo is read as the bench read am-05, the item rows under a made-up header — a square one as a sole trader's receipt with no items (MOL-227) — so a receipt taken in the browser is read, reviewed and recorded with no Tesseract. Started by `playwright.config.ts` on the API's port + 3.
- `bin/e2e-database.mjs` — Drops and recreates this copy's `_e2e` database before a run; refuses any other name. Run by `playwright.config.ts`.
- `playwright.config.ts` — Playwright config: the copy's e2e ports and database from `.env`, phone profile, starts its own API and PWA, and a build for the `pwa` project; the `camera` project on the full Chromium with a fake camera; an iPhone profile for the sheet alone; traces on failure.
