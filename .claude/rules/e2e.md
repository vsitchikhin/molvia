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

- **CI runs end-to-end in the image of Playwright, `mcr.microsoft.com/playwright:v<version>-noble`**
  (MOL-295). Until then the job installed the browsers with `--with-deps` on every run: the browsers
  came from a cache, but their system packages — 181 through apt, gstreamer, fonts, WebKit's
  libraries — go into the system, where no cache reaches, and on a slow mirror of Ubuntu the step took
  17 to 60 minutes in 7 of the 21 runs of 23.10.2026, against half a minute otherwise, holding the
  pull request and the deploy behind it. Rejected: caching the `.deb`s of `/var/cache/apt` (fragile,
  or an action of a third party) and dropping `--with-deps` (WebKit does not start without
  gstreamer).
  - **The tag is the version the runner loads**: `@playwright/test`, its `playwright` and that one's
    `playwright-core`, each where Node resolves it from the one before — a `playwright` another
    dependency hoisted is not the runner's (adversarial А1). The image's browsers are built for that
    one version, and Playwright of another refuses at the first test, naming the tag itself — 1:24
    after the push in the mutation of #215. `bin/check-playwright-image.mjs` in `npm run lint` says
    it in the checks job too, in one sentence with the tag to set (4:10 there), so the pull request
    reads as a tag to move rather than a broken suite. It reads the value of `image:`, never a
    comment (А3), a version with a hyphen of its own whole (А2), and the tag before a digest — a tag
    moved asks for its digest too, which only the registry knows (Б1).
  - **Dependabot never moves the tag, so its pull request of Playwright is red until we do — on
    purpose** (owner's В-1 «а»). Playwright is a group of its own in `dependabot.yml`, so the rest of
    the week's packages go green without it. The tag is moved by a commit to Dependabot's branch;
    after that commit Dependabot no longer rebases the branch, and `@dependabot recreate` throws the
    commit away — so it is merged once green, or the tag moved again.
  - **The database is the service by its name**, `postgres:5432`: in the container the loopback is
    the container's own. `bin/init-env.sh` writes it when given `MOLVIA_PG_HOST` and `MOLVIA_PG_PORT`
    (В-3 «а») — one generator of `.env` still. The names are the project's: a `PG_HOST` another
    project left in a terminal would have sent every URL of a copy to that project's Postgres
    (adversarial А4). Both are checked, and a run given them says where the databases are.
  - The image's Node is 24; `setup-node` keeps `.nvmrc`'s. The job runs as the runner's uid
    (`--user 1001`, as Playwright's documentation has it).
  - **The job has 40 minutes and its tests 35** (`timeout-minutes`, В-2 «а»): a hung step was held
    for six hours. The job's limit cancels it, and a cancelled job skips `if: failure()` — the traces
    already written went with the container (adversarial А5); the step's own limit fails the step,
    and the traces go up (run 40313375737). **The price, named:** the step is killed with no summary,
    so a test hung with no timeout of its own is named nowhere — every spec keeps one, and none sets
    `0`. Not `globalTimeout`: it waits as long again for a hung worker's teardown.
  - **The prices, named:** the image, 956 MB compressed, is pulled on every run — 27 s on the first
    run, the containers up in 39–41 s against 12–14 (26.10.2026), in place of apt's half-minute and
    the cache's six seconds, so an ordinary run is no shorter, and the win is the tail. The tests took
    16.4, 17.3 and 15.7 minutes there, against 11.6–16.7 on the runner: whether the container is
    slower, three runs do not say, and `--ipc=host`, which Playwright advises for Chromium in Docker,
    was not tried. Its fallback fonts are not the runner's: the app's faces are its own, but a glyph
    outside them falls back to the image's.
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
  did not show in it. A machine installs both browsers once, `npx playwright install chromium webkit`,
  or `make e2e` fails on `Executable doesn't exist` (review Р-5); CI has them in its image.
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
  `verdicts.spec` does. A describe cannot say it — Playwright refuses `use({ trace })` there, since it
  would take a worker of its own — so the focus block of `scanner.spec` (MOL-249) and «a line gone under
  the category of «Год»» (MOL-267) call `firstAttemptTrace` (`e2e/trace.ts`): it starts the context's
  tracing on the first attempt itself, keeps it only when the attempt failed, and steps aside when
  the run already traces that attempt (`--trace on`, a config's `retain-on-first-failure`), whose
  second start threw in every test of the block (review Р2-А1); for the whole file it would have traced
  the camera's reads as well. Not without the DOM of each step: Playwright records the network only with
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
- **Across a page that goes away, a spec says what the phone keeps, never what the server has not
  got; while the page stays, «the server did not get it» needs `goOffline`** (`e2e/session.ts`,
  MOL-217). Seven failures in CI: the rating's `PUT` refused in the page — by the emulation, from the
  sixth on by `page.route` too — and, as the page was leaving, a `GET /verdicts/pending` and the `PUT`
  reached the API together, the app's answer to `online`: some 35 ms after `page.close()` (runs
  37619569005, 37743449964) and 5 ms after `page.goto('about:blank')` (37747326557, after the merge
  that had taken the app away first). How Chromium lets a document that is going away send past both
  was never shown — not reproduced here, three causes named and refuted in turn. The product is right
  either way: told the write failed, the phone keeps its draft until a send is confirmed, and a `PUT`
  again is the same row. So «…and the app closed» reads the drafts' drawer before it closes the page —
  the whole drawer, a refused send being a draft too — and after it opens again, that the server has
  the rating and the drawer is empty; the send at the start is held whenever the rating was still in
  the drawer as the app started, and a run where the leaving page already sent it has nothing left to
  send — the price. It still takes `goOffline`: the drawer keeps the draft only when the send failed in
  the page itself. `goOffline` itself is
  `setOffline` — the page's `navigator.onLine` and its states — **and `page.route` refusing every
  request of that page with `internetdisconnected`**: Playwright fails it before the network, and the
  page sees the same error — the route set before the offline, so nothing slips between them. That
  page only: a new one of the context is online when the context is; on the same page the connection
  comes back only by the function `goOffline` returns, the route off first — `setOffline(false)` leaves
  it refusing. **Which specs take it was found by the mechanism itself** (adversarial round 8): every
  spec with `setOffline` run with writes let through to the API while the page is told they failed —
  only «…and the app closed» and the trip «started with no connection» (`trip.spec`) fell, both saying
  what the server has not got — «…and the app closed» has since moved to the phone's side, the trip says
  it while its page stays; the rest assert the phone's own state or what went once the connection came
  back, a write being safe to repeat. A new spec that says «the server did not get it» takes it too, with
  its page in place; the harness is
  `.scratch/tasks/selftests/MOL-217-adversarial-round-8-leak.cjs`. The readings of the four failures
  before, both refuted by the trace — `.scratch/tasks/status/MOL-217/readings.md`.
- **A route a step relies on is laid before the page opens, never on the open page right before the
  step** (MOL-249): `page.route` before `open()`. Not free, though it matches nothing until the step:
  routing turns the page's HTTP cache off — Playwright says so, and a script shared by two pages is
  then asked for twice — and every request of the page stops for the driver to match it. In a fresh
  context loaded once, as `asked` does, that is little; a spec that reloads or goes from page to page
  pays it on each load (review С-5, adversarial А3). «An item full of codes» laid its `409` for the link on the open page, then pressed Enter;
  once in some 830 runs of CI (run 37484398374) the server got the real `POST …/barcodes` and wrote
  `201`, the screen went on to the purchase sheet, and the test read a focus in it — `Received: ''`.
  How the request passed was never shown: laid first on a page, the route turns interception on in the
  middle of the test, and a probe of exactly that — a route, then Enter, then `fetch` — let none through
  in 960 tries under load (`.scratch/tasks/status/MOL-249/`); nor was anything found that pressed the
  button before the route — the price, named. So the focus block of `scanner.spec` lays the link's
  answer in `asked`, before `open()`, and `asked` says that nothing was linked before the test's own
  Enter: should the cause be the second, the next failure names it. That check stands in `finally`
  (review С-3): pressed early, «Link and record» moves the screen on, and the step that fails first is
  the question's or the focus's — the check after them never ran and the failure was the old
  `Received: ''`; a test of the spec holds it, the button pressed as soon as it is drawn. The other routes laid after
  `open()` — some fifty — stay as they are until one of them fails so.
- **A position is measured once the faces have come** (MOL-63, MOL-267): `standAt` and `toTheEnd` of
  `e2e/scroll.ts` lay the page out and wait for `document.fonts.ready` (`facesIn`) before they set the
  scene; `topOf` only measures, so a measure with no scene set waits with `facesIn` itself (`money.spec`,
  «offline, a month not read…», at the top of the page). Every face is `font-display: swap` with a
  `unicode-range`, so its file is asked for only when a glyph of its range is first laid out — on «Год»
  the answer brings Onest 700 and ֏ — and the text stands in the fallback until it comes. On a Mac a
  late face moved the choice of «Год» half a pixel (456.19 → 456.70), which `topOf`'s rounding shows or
  hides by chance. **The price, named:** a face first needed after the action — a glyph only the next
  answer brings — still moves what is measured after it; on «Год» every face is on the page before the
  choice, the other screens were not checked for it.
- **«A line gone under the category of «Год»» keeps its first attempt's trace in CI** (MOL-267,
  `firstAttemptTrace` of `e2e/trace.ts`), since its one failure was never explained (run 37911189456,
  09.10, `scrollY` 1151 → 1132 with the choice where it was). Late faces were not it: held a second with
  the scene set without waiting, CI stayed green (run 39575601047), and held in the very window of the
  failure, in Chromium on Linux with DejaVu as the runner has, they moved no block on the failing head,
  on master or after this task (adversarial А1). On the failing head a calm page in that browser stands
  at 1132 (П2): the scene was set on a page 19 px longer than it settles to — something over the choice
  gave way between `toTheEnd` and the first `topOf`, two `evaluate`s, and Chromium's scroll anchoring
  kept the view; the choice of a category had no part in it. Which block was never caught — of forty runs
  at four times slower CPU seven reached the measure, and none failed so; the failure came two days
  before MOL-186 remade the blocks over the choice, and not in some 176 runs since. The trace has the DOM before and after each
  `evaluate`, that window included. **The prices, named:** a shift that changes no DOM is not in it —
  it keeps no screenshots; and the artifact lives seven days (`retention-days` of `ci.yml`), so the
  failure is read the week it comes.
- **A motion measured frame by frame is measured by the frame's time, never between two drawn frames**
  (MOL-292): a step is the way gone, brought to one frame of 60 Hz by the frame's own time — the moment
  `requestAnimationFrame` hands its callback, which the page's animations are drawn at. A loaded runner
  drops frames, and the next one drawn holds the way of all of them: «Тут дешевле» rises 60 px over
  220 ms, at most 16.2 px a frame (the CI trace: 1.0 · 10.6 · 16.2 · 16.2 · 7.0 …), and with one frame
  dropped between the two steepest it failed CI as 32.3 at a threshold of half the way (run
  39613154163). Shared over its time, a dropped frame's way is no more than a frame's; a jump goes its
  way in one frame and stays a jump. With one frame dropped right on it, a jump is half the way over two
  frames' time — at the threshold, and the frames' stamps, a tenth of a millisecond coarse, decide the
  side (60 over 33.4 ms is 29.94, adversarial Б1): `moving` at 1 is what fails it, so every test of a
  motion keeps a count of the frames it moved in. **Every run goes through a dropped frame, in a test of
  its own** («a frame the runner drops on the way up…»): `priceFieldMoves` holds the page busy 60 ms
  once the field has first moved, and the test says both halves — drawn, more than half the way went
  between two frames (CI: 50.0 of 60 in every attempt, run 39922499322), measured, under half (12.5) —
  and in more than three steps, as Е and Е′ (`moving > 3`; the rise held is 7–8). Not more than one: a
  jump with a pixel drawn before it is two steps, the hold arming on the pixel and taking the rest — a
  block in 20–90 ms is 2–3, 1 where it is the first move (adversarial В1). **Never in the tests of the
  motion itself** (adversarial А1): held after the first move, the hold covers the steepest of the
  rise, which then counts only as its average — a rise of 100 ms, 33 px a frame on screen, passed as
  smooth, and a runner's own 70 ms after the hold left `moving` at 3 (А2). Е and Е′ take the frames as
  the runner gives them. **The test of the dropped frame keeps А1, named** (adversarial Г1): its «not a
  jump» holds to ~90 ms, Е to ~110 — a block of 100–110 ms (120 in a late phase), 55 of 60 px drawn in
  one step, is 4 steps and passes it while Е fails it. One of two prices, chosen (Д1): `moving > 4`
  closes the gap — the rise held is 7–8 — at ~20 ms of the runner's margin, the test failing from
  60–80 ms beyond the hold rather than 80–90, two frames over the rise's 7 in CI; Е guards the product,
  so the gap is taken and the margin kept. **The price, named:** the count of frames the field moved in
  (`moving > 3`) stays a count — the one check that tells a jump the runner held right then from a rise
  it held, which look alike by time — so a runner busy over ~110 ms of the 220 ms rise still fails it,
  and over ~80 ms beyond the hold of 60 in the test of the dropped frame; it never has. Slowing the
  page's clock by CDP (`Animation.setPlaybackRate`) was not taken: four times slower, an animation of
  30 ms passes as a smooth one, and the check stopped telling it from a jump.
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
