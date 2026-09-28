---
paths:
  - 'e2e/**'
  - 'playwright.config.ts'
  - 'bin/e2e-database.mjs'
---

# End-to-end: its database, its ports, the login seam, traces, the live region

The detail behind the end-to-end lines of `CLAUDE.md`.

- **End-to-end has a database of its own too, and it is dropped before every run**
  (`molvia_<index>_e2e`, MOL-60). Until then the suite started the API without a
  `DATABASE_URL` of its own and wrote into the dev database, so every pass left a catalogue
  item and a purchase behind: a leftover «Кефир 4a2d4992» outranked the canonical item a
  test expected — deterministically, and only on a machine with history. `bin/e2e-database.mjs`
  recreates it (and refuses any name not ending in `_e2e`); the API migrates it at boot, so
  there is no second migrator. Recreated rather than truncated: it also makes the schema
  match the migrations after a branch switch, with no hand-kept list of tables. Not the
  `_test` database, because that one is never cleaned between runs — its tests own their
  rows — and `pre-push` runs both suites back to back.
- **The run also has its own ports** (`E2E_API_PORT`, `E2E_PWA_PORT` — the neighbouring port
  in this copy's band). A database alone would not have closed it: `reuseExistingServer`
  handed the suite the dev API whenever `make dev` was up, so no `DATABASE_URL` of ours
  reached a process — and `pre-push` runs e2e exactly then. Now the two stacks coexist.
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
  logins under load: late, never «not at all».
- **Outside CI a failed test keeps its trace** (`retain-on-failure`, MOL-67), since there are no
  retries to write one. It is recorded for every test and dropped when it passes, which costs
  12–22 % of a full local run (measured in four pairs); and under an overload that times a test
  out, the trace may still be lost: it is saved while the context is torn down, and that teardown
  shares the test's timeout.
- **Words that are said out loud are taken end-to-end by a locator outside the live region**
  (MOL-64). The app has one polite region, in `App.vue` above the router, and **six things write
  to it**: `ScreenState` («title. body»), `ScreenSkeleton` («Loading…»), `ItemSearchView` (the
  count of an answer, and an empty answer's own words), `ItemDetailsSheet` (the price per unit),
  `VerdictCard` («Pick a rating») and `useSettings` (the form's notice). Whatever any of them
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
