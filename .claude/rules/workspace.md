---
paths:
  - '**/package.json'
  - '**/tsconfig*.json'
  - '**/eslint.config*.js'
  - '**/vitest*.config.ts'
  - '**/vite.config.ts'
  - '.prettierrc.json'
  - '.editorconfig'
  - 'bin/check-code-map.mjs'
  - 'bin/one-at-a-time.sh'
  - 'bin/test-time-reporter*'
  - 'bin/check-clock-bounds*'
  - 'packages/model/tests/support/clock*'
  - '.githooks/**'
  - 'Makefile'
  - 'docs/map/**'
---

# The stack's rejected alternatives, and what stays at the root

The detail behind the stack and workspace lines of `CLAUDE.md`.

## Why not Nest, Prisma, TypeORM or Quasar

**Nest, Prisma and TypeORM were considered and rejected**, each for a reason that is not
obvious enough to leave unwritten:

- **Nest** is Fastify plus a DI container, decorators and modules. That superstructure
  solves a team problem — imposing one shape on ten people. Here the shape is imposed by
  these rules and by the linter's import boundaries, for free. Worse, it works against the
  core decision: in Nest the business logic lives in `@Injectable()` classes, so the domain
  would import the framework, and "the domain imports nothing but zod" could not hold.
- **TypeORM** makes an entity a decorated class, so a table becomes a framework object;
  its migration generator has a long history of being unreliable, and the query builder
  returns `any` down many paths — typed on paper, untyped where it matters.
- **Prisma** has the best developer experience of the three. It breaks on exactly this
  project: its schema is its own DSL, and everything the DSL lacks is hand-written into
  generated migrations. Nearly all of the plan sits outside it — the `pg_trgm` and
  `unaccent` extensions, GIN indexes, `similarity()` queries, the aggregates behind "what
  to buy". Raw SQL exists through `$queryRaw` but loses its types, and here raw SQL is the
  main instrument rather than an escape hatch.

**Quasar was rejected for the same reason**, with one addition. It bundles a component kit
with a build layer for SPA, PWA, Capacitor and Electron. The second half is useful one day;
the first brings its own theme and Sass variables, which would become a second source of
truth about colour. And the second half is available on its own: if native happens at 1.0,
**Capacitor** wraps the existing web app for the stores without a component kit or a CLI of
its own. Until then `vite-plugin-pwa` already ships the manifest, the service worker and
the precache — a PWA that installs to the home screen and works offline is the mobile
build.

## The root only gathers the applications

The root only gathers them. `eslint.config.base.js` is a shared preset a module opts into,
the way separate repositories share a company config; it knows nothing about the modules'
names. The root `eslint.config.js` ignores the module directories entirely and covers only
`e2e/` and the repository's own config files. The root `vitest.config.ts` lists the
modules' configs as projects rather than defining suites itself.

**What deliberately stays at the root**, with the reason:

|                                         | Why                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prettier, `.editorconfig`, `.gitignore` | repository hygiene, not application config; five copies would only drift                                                                                                       |
| `.env` (development)                    | the three must agree on ports here — the frontend proxies to the backend's port and the bot calls it. In production nothing is shared: each container gets its own environment |
| `Makefile`                              | the entry point to the repository                                                                                                                                              |
| `playwright.config.ts`                  | end-to-end spans the whole stack and belongs to no single application                                                                                                          |

## The code map

**`docs/map/` answers «which file», before any search (MOL-133).** Every task used to open with
reconnaissance — grep, find, reading files in a row — repeated by every session and every subagent.
The map is one file per area, named as the area's rules file, so the name is already known from
«Rules by area»; `docs/map/README.md` holds the conventions and the skeleton that belongs to no area.
An entry says what a file is and what it is for, never how it works and never a rule.

**It is not in `.claude/rules/`, though the task first proposed that.** A rules file reaches the
context only after a file in its `paths:` is read — measured on MOL-130 with `claude -p`: no file
read, no rules — which is after the search the map is meant to replace. Loaded whole in every
session it would cost what MOL-130 took out of the core.

**The check is in `npm run lint`, not in a test**, so the pre-commit hook refuses a commit that adds,
moves or removes a file without the map. `bin/check-code-map.mjs` reads only entries — list items
that start with a path in backticks — so prose may name `x.test.ts` freely. Code is named file by
file; a test beside or mirroring its source is covered by the source's entry; only data (`sql`,
`json`, fonts, icons) may be covered by a directory, or the map would decay to «`backend/src/` —
the backend» and still pass. A file with two homes is refused: the map gives one. A path an entry
points at after its own (`Tests: …`) must exist too, unless it is outside the repository's
directories — a route or a build output. What it cannot check is meaning: an entry describing old
behaviour passes, and that is left to review.

## The heavy checks take turns

**Every check is CI's** (MOL-165, owner's decision 01.10.2026). After MOL-164 the push ran types and
vitest and the commit a type-aware lint of the whole repository — the lint past the queue, at every
commit of every copy — and pushes still failed on a timeout: the machine was too loaded to finish
them. With the ruleset of MOL-164, `master` takes a pull request only when CI is green, so a check
here guarded nothing CI does not; it only made the machine slower for the copies that were writing
code. **What stays is `pre-commit` on the files committed, Prettier alone** — seconds, and CI checks
formatting rather than fixing it, so without it a push would come back red for a space. **The
price, named:** an error of types or lint is met in CI some six minutes after the push rather than
before it, and a task may push more than once; each push cancels the run before it, and the minutes
are free on a public repository. `pre-push` went, and with it `bin/green.sh`, whose marks only it
read.

**One lock for the whole machine, taken by `make format`, `lint`, `typecheck`, `test`, `e2e` and
`check` (MOL-139)** — what is still run here, by hand. The copies exist so that several sessions
work at once, and each push once ran every check: four at once were four typechecks, four vitest
runs and four Playwright runs with their browsers on eight cores and 16 GB. Measured on 29.09.2026:
a load average of 95–223, the swap full, a push of 10–20 minutes against about five alone the day
before, and `search.integration.test.ts` running seventy minutes. Worse than slow: a test timed out
under that load failed, and was started again into the same crowd. In turn, the last of four waits
for three runs of a few minutes, and none of them fails for want of a core.

**A run of tests typed by hand takes the lock too: `bin/one-at-a-time.sh <label> npx vitest run …`,
`… npx playwright test …`** (owner's decision, 01.10.2026, MOL-162). The lock holds only what goes
through `make`, and a session fixing a review runs single files directly, again and
again — with a reviewer's worktree beside it doing the same. On 01.10.2026 the load reached 87–131
while every push was waiting its turn: the pushes took turns, the direct runs did not, and four
specs of one copy failed on `page.goto` under it and passed in one worker. **By the layers of the
table «Testing» in `CLAUDE.md`:** one file of Unit or Use case — no database, no DOM — may run
without the lock; Component, Integration, end-to-end and any run of a whole module wait their turn.
**The price:** a single integration file waits for whatever run holds the lock — minutes on each
round of a fix.

**What does not end by itself never holds the lock** (adversarial Л2–Л7). vitest watches by default
only when its stdin is a terminal, so the script gives the command none (`/dev/null`): under the lock
`npx vitest …` without `run`, a path to the binary, a version, `sh -c` run once. **Told to watch** it
watches with no terminal at all, and `run` does not stop it — `npm run test -- --watch` is `vitest run
--watch`. So `--watch` in any spelling but `=false` is refused always (npm, npx and Playwright have no
such flag); `-w` beside a vitest or after `--`, alone or folded with other short flags (`-wu`), where
it is vitest's — elsewhere it is npm's workspace, and `npm run test -w …` is how a module is tested
(Л3, Л8); `watch` and `dev` after a vitest unless `run` or `--run` came first — vitest finds its
command past options (`-c … watch`), and after `run` a word is a filter (Л8); a `run` straight after an
option with no `=` may be its value (`-t run watch`), so it does not count (Л9). The price: `vitest -t
watch` without `run` and `vitest --silent run watch` are refused too. Playwright's UI and debugger wait for a person
whatever stdin is: `--ui`, `--ui-port`, `--ui-host`, `--debug` in any spelling and `PWDEBUG` are
refused. **The price:** hidden in `sh -c`, a flag still passes — the script reads words, not meaning.
**A waiting run names the copy by its root**
(`git rev-parse --show-toplevel`), not the folder the run was typed in: a module's tests are typed
in the module, and «waiting for backend» was every copy (Л1).

**The lock is `flock` held by the process that runs the command**, so the kernel drops it however
that process ends: a lock file with a pid in it was the alternative, and breaking a stale one is a
race between two waiters. The descriptor is closed on exec, so a server a run leaves behind does
not hold the lock. `make check` takes one turn for all four steps — one per step would let another
copy slip in between — and a run already inside the lock does not take it again.

**The integration files run in parallel, each worker in a database of its own** (MOL-164). They ran
in turn because they shared `molvia_<index>_test` and each cleans its rows in `beforeEach`: in
parallel they deleted each other's. Now the global setup migrates that database as a template and
drops the last run's copies, and `tests/setup-worker.ts` gives each worker `…_test_w<VITEST_POOL_ID>`,
copied from it on the worker's first file — the files of one worker still run in turn in one
database, exactly as all of them did. Measured under the lock on 01.10.2026: 61 s against 164 s
in turn, all 1686 green. The production bundle, which three files test, is built once in the global
setup: built by each of them, it was rewritten under a neighbour reading it.

## The rule of time, held by CI (MOL-266)

**The rule is `CLAUDE.md` › Testing (MOL-243); this is how it holds without a list.** MOL-243 wrote it
beside a list of the tests past it, and fourteen rounds of review chased the list: it grew with the window
of the measure and with every test merged. So CI checks every run instead (owner's В-1 «а», 14.10.2026).

- **Ten times the worst, and so half a second** (В-7 «а» and №15 «а» of MOL-243): on byte-identical code a
  busy runner ran `merge-corpus` 4.8 times slower than a calm one, and five times a calm worst leaves
  ~1.04 against that. Half a second is vitest's 5 s over ten: past it the default limit is less than ten
  times the worst. **The limit is ten times the worst, rounded up to 5 s; the worst is of the runs where the
  test's file was as it is now** (the blob in each run's commit) — the measure of 14.10 found 6 291 ms for a
  test on its first branch that runs under 300 ms now. **The worst is every printed time of the test, in every
  run and every attempt of it** — a run cancelled by a new push, a job cut off halfway, the first attempt of a
  run re-run, which the list of runs leaves out (MOL-243, rounds 19–21): the first measure read none of them,
  and the fourteen tests they put past ten times were raised on 18.10 — `seed-catalogue`'s dry run to 75 s
  for 7 119 ms. **It is a number, the third argument**: Prettier keeps
  a test's body where it is for a numeric literal there, and a constant or `{ timeout }` re-indents it — as
  does any `it.each(…)(title, fn, N)` whose title line no longer fits (5 of the 277 given 10 s on 15.10).
- **The reporter is in the root run only** (`vitest.config.ts`): CI and `make check` run the whole suite
  there, and a module's own `npm run test -w` stays as it was. **A warning here** — the machine runs
  several copies at once, and its times say nothing of CI's. **On CI red only in a file the pull request
  changes** (owner's В-4 «а», 15.10.2026), an annotation of `error` on it; any other breach is a `warning`.
  A limit of ten times the worst, rounded up, stands 1.0–2 times above it, so a run on a busy runner sets a
  new worst somewhere now and then: red everywhere, that was somebody else's pull request red for a test it
  never touched — the flake MOL-243 closed, back by another door. The files are the merge CI checks out,
  `HEAD^1..HEAD` (`fetch-depth: 2` in `ci.yml`); a push to master changes no file of a pull request and only
  warns; a merge that cannot be read makes every breach red and says why, since a guard gone quiet would go
  unseen. **The price, named:** a test made slow by a change of the code, not of its file, only warns; and
  whoever touches a file answers for every test in it, which is how the 277 came to be given 10 s at once.
- **A test is held by its whole time**, `beforeEach`, `afterEach`, `aroundEach` and a wait it sets included:
  the reporter cannot tell a wait from work, so `navigation` and `metrics`, whose time is their own wait,
  carry a limit too — it costs nothing. **The price, named:** vitest gives those hooks no time of their
  own to read, and holds them by `hookTimeout`, 10 s, whatever the test's timeout — so a slow `beforeEach`
  behind a test of a long timeout is not told from the test (adversarial А2); the advice names them. A
  timeout of 0 is vitest's «none», and such a test is not judged. **The advice is the limit as the rule
  writes it** — ten times, rounded up to 5 s — and every run on CI opens its verdict with how many files of
  the pull request it read, so a merge read wrong shows before the first breach (review №11).
- **A hook by the worker's own marks on the runner's tasks** (`experimental_getRunnerTask`): a suite's start
  to its first child's is its `beforeAll`, its last child's end to its own its `afterAll`. The reporter's
  hook events come in batches, 100–200 ms late (measured: 276 ms for a hook of 400). The marks are an
  experimental door of vitest, so the reporter's test runs vitest on a fixture of hooks with set waits, and a
  version that moves them turns that red. **The marks give the sum of a suite's hooks of a kind**, so the sum
  is held to the sum of their limits (`hookLimit`) — and of its `aroundAll`, whose setup falls before the first
  child and its teardown after the last, each held by its own timeout (adversarial В5). A timeout of 0 or
  `Infinity` is vitest's «none», and a sum with one in it is none. A hook under 300 ms is still judged where
  the file gives it a limit of its own below ten times it (В6). **The price, named:** one slow hook beside
  fast ones of the same suite is judged with their time to spare. **A hook's own timeout is not in the API** — it is read from
  the file by parsing: a number, arithmetic on numbers and the file's constants — each in its own scope, by
  TypeScript's binder — `{ timeout }`; `undefined` or nothing is the project's. A suite is `describe` or
  `suite`; one named by a string is the hook's own, one named by a template, `each`'s placeholders or an
  expression (`X.name`) a guess. A hook in a helper of the file stands in the suite the helper is called in,
  beside the suite's own and summed with them (review №14, В5) — its own helpers' with it, by their calls, and a
  suite the helper declares itself under that suite (review №16, Г5); one whose helper is
  called nowhere the parse sees stands wherever it may, a guess, and a helper of another file is not seen. The exact suite is taken before a guess, and the smallest of the guesses where they differ (review
  №10). **A timeout the parse cannot read** — an import, a condition, a call — is held as the project's, and
  the advice asks for it as a number: the limit is one, and silence would let a hook past the rule (Б4).
- **A bound on a duration is `expectWithin`** (`packages/model/tests/support/clock.ts`, served as
  `@molvia/model/testing/clock`): it asserts and keeps the duration in the test's meta, which is how the
  reporter sees how far below its bound each one stood. **In a concurrent test it takes the test's
  context** (`expectWithin(d, n, context)`): vitest's current test is one for the worker, the neighbour or
  none beside another running, and a bound without it is refused rather than kept on the wrong test.
  **It never refuses fake time** (review №12, adversarial В3): a number does not say which clock it came
  from, and a refusal there left a bound on the real clock of a test that fakes only `Date` with no lawful
  spelling. A bound met while vitest's fake timers are on (`vi.isFakeTimers()`) and have replaced every clock
  the module found is kept marked `fake`, printed, and held to nothing; with one clock left real, or every one
  replaced by hand with the fake timers off, it is held as real. **The price, named:** with every clock fake
  and moving with real time (`shouldAdvanceTime`), or a clock kept under another name before the fake, the
  duration is real and still held to nothing — the run does not say how fake time moves, and the repository's
  `shouldAdvanceTime` fakes `Date` alone.
- **`bin/check-clock-bounds.mjs` refuses the upper bounds on a duration it knows**, found by parsing, never by
  a line's pattern (a pattern missed three of eighteen, review of MOL-243, Р10-А1); **the lists are in its
  head**, and two rounds of review found forty spellings past the first one — so the claim is what it lists,
  not «any». In short: readings of every clock of the platform, under another name too (`perf_hooks`'
  and `node:process`' own, `{ now } = Date`, `.bind`), and the file's own clocks; a duration through names,
  fields, classes and their getters, arrays, `+=`, `push`, the answer of a helper, a helper that subtracts a
  reading it takes however it rounds, `hrtime(t0)`, `performance.measure`; a budget — a duration taken from a
  number, `200 - d`, `left -= d`, `deadline - Date.now()`, or divided into one, a rate (`1000 / ms`), kept through
  `Math.max` and `Math.min` — whose lower bound is an upper bound on the duration;
  bounded by vitest's, chai's and `assert`'s forms, a comparison asserted true or false (`toBe(false)`,
  `isFalse`, `!`, `&&`), `toSatisfy`, `if … throw`, a helper bounding its parameter, and a deadline — a reading
  held below a reading plus a number. Two readings against each other are a lower bound (adversarial В4). Names are resolved by TypeScript's binder, so the age of a stamp held under a name
  another test gave a reading is left alone: one side is not the clock. **Fake time is no exception** (MOL-266,
  round 15): a bound under `vi.useFakeTimers()` goes through `expectWithin` as any other, and `expectWithin` marks
  it `fake` as the test runs. For fourteen rounds the parse let such a bound go raw where it read every clock
  fake at the bound — in the order vitest runs hooks, through the file's helpers, its directory's configs and
  setup files, every command line of the repository — and every round found another way the clock stayed
  real: a list of spellings, a lexer of the shell, a reader of YAML, each answered by one more. Whether a clock
  is fake is a fact of the run, not of the text, and the whole repository had one such bound
  (`bot/src/assemble.test.ts`, a retry on fake time), so the exemption cost more than it ever spared.
  **What the check is**: a guard against a bound written the ordinary way, not against a form built to slip
  past it. **The price, named:** a duration the code under test measures has no clock in the test to be found
  by (`metrics`' lag), a helper imported from another file is not followed, a structure the lists do not name
  is not seen, nor a clock reached through `vm`, `eval` or reflection — all go to `expectWithin` by review; a
  form found that hides an ordinary bound is a new line in the check, not a reason to read the run.
- **A test may take a testing export wherever it lives**: `TEST_DATA` keeps a package's testing export out
  of `src`, which ships, and leaves `src/**/*.test.ts` alone (`TESTS_BESIDE_SOURCE`) — a test never ships. A
  module's own boundary over part of `src` goes through `boundary()` of the base preset, which gives the
  tests beside it the same boundary without `TEST_DATA`; a bare `deny` there would put it back (adversarial
  А6: the use cases' tests could not import `expectWithin`). It takes globs of `.ts` sources only and refuses
  any other: its tests' block is the glob with `*.test.ts`, and from `src/db/**` it would be the sources (Б5).
- **Where a clock cannot hold, the domain keeps a count for the tests** — `candidateSearches` in the
  parse of receipts (MOL-265), `normalisations` in `support/text.ts`: «found once», «refused before the
  normalisation». Twice the work, or a hundred times a third of a millisecond, is under any bound a clock
  keeps on CI. A count is no rule of the domain and no state anyone reads but a test.
