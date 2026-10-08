---
paths:
  - 'e2e/**'
  - 'playwright.config.ts'
  - 'bin/e2e-database.mjs'
  - 'frontend/vite.config.ts'
---

# End-to-end: where it runs, its database, its ports, the login seam, the camera, traces, the live region

The detail behind the end-to-end lines of `CLAUDE.md`.

- **End-to-end runs in CI, not on the push** (MOL-164). After MOL-139 a push following `make check`
  ran only this suite, and every copy waited for the others' in the machine's one line: on
  01.10.2026 a measurement in molvia7 waited 7½ minutes for one push of another copy before it began.
  CI ran the very same suite on every push anyway — on GitHub's machines, in parallel, with no line,
  and for free on a public repository — so the push was paying a second time for an answer CI
  already gave. **What keeps it a gate is the ruleset on `master`**: a pull request merges only when
  both jobs, «format, lint, types, tests» and «end-to-end», are green; before it nothing but habit
  stopped a red merge. **And a flake fails CI** (`failOnFlakyTests`): the push ran with no retries,
  so a flaky test failed loudly there; CI keeps its two retries so the report names a flake as one,
  but a test green only on a retry is red. **The price, named:** the answer comes with CI, some
  seven minutes after the push, rather than in two to four here with an empty line; the agent's
  «done» waits for it (`gh pr checks --watch`). Since MOL-165 every other check is CI's as well. `make e2e` is the same suite here, on demand — for a
  spec being written, or a change the agent wants seen before it leaves the machine.

- **End-to-end has a database of its own too, and it is dropped before every run**
  (`molvia_<index>_e2e`, MOL-60). Until then the suite started the API without a
  `DATABASE_URL` of its own and wrote into the dev database, so every pass left a catalogue
  item and a purchase behind: a leftover «Кефир 4a2d4992» outranked the canonical item a
  test expected — deterministically, and only on a machine with history. `bin/e2e-database.mjs`
  recreates it (and refuses any name not ending in `_e2e`); the API migrates it at boot, so
  there is no second migrator. Recreated rather than truncated: it also makes the schema
  match the migrations after a branch switch, with no hand-kept list of tables. Not the
  `_test` database, because that one is never cleaned between runs — its tests own their
  rows — and a copy may run both suites back to back.
- **The browser is in `Asia/Yerevan`** (`timezoneId`, MOL-121): the app dates by the phone's
  calendar and the specs by Yerevan's, and in CI's UTC the two parted from 20:00 to midnight. A
  phone in another zone is the component tests' — they run in UTC.
- **The run also has its own ports** (`E2E_API_PORT`, `E2E_PWA_PORT` — the neighbouring port
  in this copy's band). A database alone would not have closed it: `reuseExistingServer`
  handed the suite the dev API whenever `make dev` was up, so no `DATABASE_URL` of ours
  reached a process — and `make e2e` is run exactly then. Now the two stacks coexist.
- **Every spec comes in through `open()` in `e2e/session.ts`, and it waits for two things
  apart** (MOL-67). The seam's answer has no limit of its own, as the app itself waits for it
  (`devLogin` has no timeout): on an overloaded machine that answer is what is slow — up to 23 s
  with eight workers on a throttled CPU, most of it inside the API, under a second otherwise. **And
  the spec does not pay for it**: whatever was waited is added back to a finite test timeout, so a
  slow stand no longer lets the login pass and the body die three seconds later on a step of its
  own with no word about the login. A timeout of `0` (`--timeout 0`, `--debug`, `PWDEBUG=1`) is
  left unlimited — `0 + waited` would have turned it into a budget as long as the login. A login
  slower than five seconds leaves a «вход швом» attachment with its seconds in the report of any
  later failure; a seam that never answers times out on `page.waitForEvent` at the line in
  `session.ts` that says so, and a request cut off without an answer fails at once with its own
  error. **The price, named:** a login made slow by the product — the seam goes through the same
  `signIn` as the real one — no longer fails at the door either; on a quiet machine the seam
  answers in under a second, so an attachment there is a finding about the product, not the
  stand. The door after the answer keeps the default five seconds and must not be raised: from the
  answer to the door is one synchronous chain and one render, so a failure there is the login
  (`verify()`, `claimed`, MOL-56), not the machine, and its message says so. Measured over 284
  logins under load: late, never «not at all». **A newcomer of the seam meets the terms first**
  (MOL-95): `open()` waits for the step or the app, and passes the step as a person does — the age
  ticked, «Принимаю» (`acceptTerms`); one request more before the door, and never the seam accepting
  by itself, which would make the step invisible in every working copy, as the seam once made the
  login screen. `consent.spec` is the step's own and presses the seam itself, as `login-screen.spec`
  does. **On WebKit `open()` answers the step's question itself, «accepted»**: the engine keeps no
  `Secure` cookie on the loopback (below), so the question went out signed out and its `401` put the
  page back on the login screen before any sheet was opened.
- **A worker needs a build, so one spec runs against one** (MOL-132): the project `pwa` is the same
  phone against `vite build` + `vite preview` in `frontend/dist-e2e`, on the next port of the band
  (`E2E_PWA_PORT + 1`, derived, so no `.env` has to be made again), and holds
  `pwa-update.spec.ts`, serially, since its specs rewrite the one built worker: a page on the screen,
  a first visit, which nothing controls — the fake of the unit tests had its version waiting, and
  Chromium showed it becomes active at once (adversarial Д2) — and a first visit beside another
  window of the app, where it does wait (Е1). Beside it `client-errors-built.spec.ts` (MOL-144) and
  `outdated-built.spec.ts` (MOL-231): the line of a browser below the floor is put in by the build,
  and a start that stayed silent is proved where a worker could have registered. `phone` ignores
  them. The build is a web server of the run, so every `make e2e`
  pays for it — some twenty seconds. The spec comes in by `page.goto('/privacy')`, **the one spec
  not through `open()`**: the development seam is not in a build, and that page is open without a
  session. A new version is a byte appended to the built `sw.js`, put back after the spec; `preview`
  keeps plain http even in a copy with certificates (`PWA_PLAIN_HTTP`), since the loopback is a
  secure context anyway. Chromium only: Safari's worker lives by rules of its own, and that is
  checked on a phone.
- **The camera needs the full Chromium, so the scanner's specs run in one project** (MOL-98): `camera`
  is the same phone with `channel: 'chromium'` and a fake camera filming a barcode drawn by
  `globalSetup` (`e2e/barcode-video.ts`); `phone` ignores `scanner.spec.ts`. The headless shell every
  other spec runs in answers any `getUserMedia` with `NotSupportedError`, fake camera or not. Why the
  video is drawn rather than kept, and what each spec holds — `.claude/rules/barcodes.md`.
- **The sheet also runs on an iPhone's engine** (`iphone`, `devices['iPhone 14']`, MOL-80), and
  so does «not now» of the kit (`kit-inactive.spec.ts`, MOL-174): it is held by what the engine
  sends for a radio's arrow, Space and a tap on a label, which only a real engine shows; and the
  kit's rows (`kit-rows.spec.ts`, MOL-175): a focus ring is the engine's own drawing, and happy-dom
  computes no style; and an error's buttons carried into the strip and back (`state-strip.spec.ts`,
  MOL-180): a node moved by `insertBefore` loses its focus in every engine (adversarial А2), on the
  kit, since a screen with data comes in signed out there. Nothing else runs on WebKit. WebKit shows what Chromium hides: Safari does not focus a tapped
  button, so a closed `<dialog>` has nothing to give focus back to, and only there does the sheet's
  own return of focus get tested. The rest of the suite stays on one engine — a second run of
  everything would double the wait at every push for differences no other screen has. Two kinds of
  test are left to Chromium, each with its reason in `sheet.spec.ts`: **WebKit keeps no `Secure`
  cookie on http://127.0.0.1**, so every page load after the first comes in signed out (a reload, a
  `goto`); and **CDP** — the rise held still, a touch moved — is Chromium's alone. Playwright's
  WebKit is not an iPhone either: its touches do not go through UIKit, and the scrim bug of MOL-80
  did not show in it. CI installs both browsers; a new machine installs them once,
  `npx playwright install chromium webkit`, or its first push fails on `Executable doesn't exist`
  (review Р-5).
- **Outside CI a failed test keeps its trace** (`retain-on-failure`, MOL-67), since there are no
  retries to write one. It is recorded for every test and dropped when it passes, which costs
  12–22 % of a full local run (measured in four pairs); and under an overload that times a test
  out, the trace may still be lost: it is saved while the context is torn down, and that teardown
  shares the test's timeout. **In CI the retry's, and the first attempt's only where a spec asks
  for it** (MOL-217, owner's choice on review С-6): `on-first-retry` records the retry, which a flake
  passes, and the failure itself leaves only its message — `verdicts.spec` failed four times so.
  Recorded for every test, the first attempt's ran 13.2 to 15.8 minutes (15.6 and 15.8 with the
  screencast, 13.2 and 15.5 without) against a median of 9.6 and a spread of 9.3–12.8 before it — four
  runs of a runner that wanders, so a cost likely rather than measured; a spec that needs it says
  `test.use({ trace: { mode: 'retain-on-first-failure', screenshots: false } })` under `CI`, as
  `verdicts.spec` does. Not without the DOM of each step: Playwright records the network only with
  those snapshots, and the network — which request left and how it ended — is what a flake's trace is
  for. Whatever there is goes up from `test-results/` when the job fails; the artifact used to be
  `playwright-report/`, which the `github` reporter never writes.
- **The dev server optimizes every package on its start, never in the middle of a run** (MOL-217):
  what only a worker imports stands in `optimizeDeps.include` of `vite.config.ts`, held by
  `optimizeDeps.test.ts`. Vite's first crawl reads the pages and never a worker, so `zxing-wasm` was
  found when the first spec of `camera` opened the scanner — while the last file of `phone` was running
  beside it — and the pages loading then waited on the optimizer. It stood seconds before four failures
  of «…and the app closed» and was first taken for their cause; the fifth came without it (below).
  Locally the cache is warm, so it was never seen here; a run that wants to see it removes
  `frontend/node_modules/.vite/deps`.
- **A page offline is closed only after the app has left it; where a spec then says what the server
  did not get, the offline is `goOffline`** (`e2e/session.ts`, MOL-217). The traces of the first
  attempts of the fifth and sixth failures (runs 37619569005, 37743449964 — the sixth with
  `page.route` already refusing): the rating's `PUT` was refused in the page, and some 35 ms after
  `page.close()` the API got a `GET /verdicts/pending` and the `PUT` together — what the app sends
  when it hears `online`. So the close is the hole: it takes the route and the emulation off a page
  whose app still runs, the page hears `online` and sends the draft past both. Read so from the logs
  of all six failures (the pair stands in each), not reproduced here — the Mac closes a page too fast.
  The spec takes the app away first, `page.goto('about:blank')` under the route, then counts, then
  closes. The phone itself, told the write failed, keeps its draft as it should. So `goOffline` is
  `setOffline` — the page's `navigator.onLine` and its states — **and `page.route` refusing every
  request of that page with `internetdisconnected`**: Playwright fails it before the network, and the
  page sees the same error — the route set before the offline, so nothing slips between them. That
  page only: a new one of the context is online when the context is; on the same page the connection
  comes back only by the function `goOffline` returns, the route off first — `setOffline(false)` leaves
  it refusing. **Which specs take it was found by the mechanism itself** (adversarial round 8): every
  spec with `setOffline` run with writes let through to the API while the page is told they failed —
  only «…and the app closed» and the trip «started with no connection» (`trip.spec`) fell, both saying
  what the server has not got, and both take `goOffline`; the rest assert the phone's own state or
  what went once the connection came back, a write being safe to repeat. A new spec that says «the
  server did not get it» takes it too; the harness is
  `.scratch/tasks/selftests/MOL-217-adversarial-round-8-leak.cjs`. The readings of the four failures
  before, both refuted by the trace — `.scratch/tasks/status/MOL-217/readings.md`.
- **Words that are said out loud are taken end-to-end by a locator outside the live region**
  (MOL-64). The app has one polite region, in `App.vue` above the router, and **eight things write
  to it**: `ScreenState` («title. body»), `ScreenSkeleton` («Loading…»), `ItemSearchView` (the
  count of an answer, and an empty answer's own words), `ItemDetailsSheet` (the price per unit, with
  «Тут дешевле», MOL-92), `VerdictCard` («Pick a rating»), `useSettings` (the form's notice),
  `YourDataGroup` («Файл готов», MOL-93) and `LoginView` («Ваши данные удалены», MOL-94). Whatever any of them
  says is on the screen twice, so a plain `getByText` matches two nodes and playwright's strict
  mode refuses — a failure the machine's speed decides: measured, one match at once and two from
  200 ms onwards. Strict mode is right, and it is answered with a locator, never muted with
  `.first()`; the region is not the place to fix it either, since the whole announcement is
  MOL-19's decision — a screen reader hears the state whole. **The heading when the block has
  one** (`getByRole('heading', { name: … })`), **the block's own container when it has none** —
  the search's `.not-found-text`, the settings' `.dock`. Three things are easy to get wrong.
  **A heading needs its name where the level is shared:** `{ level: 2 }` alone is not outside
  anything, because a state's `h2` is the level of a card's and a sheet's too, and an inline
  notice puts two of them on one screen (MOL-64, Н3). The `h1` is the exception rather than a
  loophole — `AppScreen` draws one per screen and the pinned copy of the title is `aria-hidden` —
  so `getByRole('heading', { level: 1 })` is the screen's own title, and asserting its text is
  what says which screen this is (`navigation.spec.ts`, `sheet.spec.ts`); naming it there would
  only restate the answer. A second `h1` would make those two the same race. **Not every state speaks** — a full-screen `error` or `attention` carries
  `role="alert"` and hands the region nothing, so of `ScreenState`'s own states only `empty`,
  `offline` and anything `inline` double; that is why four of MOL-64's five places were not
  failing yet and were fixed anyway. And **`exact: true` is not the rule and holds by
  accident:** it saves only while the announcement is longer than what the screen shows.
  `ScreenState` joins with `[title, body].filter(Boolean)`, so a title without a body is
  announced alone and matches exactly too; `useSettings` writes `${title}. ${body}` unfiltered,
  and the trailing «. » is the only reason two settings assertions were ever green (Н2). Two
  ways of joining one string, and a locator must not depend on which one ran.
