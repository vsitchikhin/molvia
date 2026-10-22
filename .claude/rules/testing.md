---
paths:
  - '**/*.test.ts'
  - '**/vitest*.config.ts'
  - 'bin/test-time-reporter*'
  - 'bin/check-clock-bounds*'
  - 'packages/model/tests/support/clock*'
---

# Tests: their own timeout, and a bound on the clock

The detail behind the timeout line of `CLAUDE.md` › Testing (MOL-243). The area owns no tests of its
own — every test belongs to the area it tests — and its tools in `bin/` are mapped with the root's
(`docs/map/workspace.md`), so it has no code map.

## A test whose work takes over half a second on CI takes its own timeout

**vitest gives a test 5 s and a hook 10 s, and gives no second try.** No `vitest.config.ts` sets
`testTimeout`, `hookTimeout` or `retry`, and CI runs `vitest run` as it is: one timeout on a busy
runner is a red CI, and the merge waits for the job to be rerun by hand. The retry that turns a red
green and is still a red (`failOnFlakyTests`, MOL-164) is Playwright's, and does not apply here.

**The measure is the time the work takes, not the kind of test.** The first wording caught «the real
model, the whole seed, a subprocess», and missed both ways: it took in the `search-meaning` queries
of 45 ms and left out the pure parse of MOL-244 at 2.6 s. Any work may take that long — a loop of
writes to the database, a parse, a mount, a subprocess, the model. A wait the test sets itself is
not work: `navigation` «a step that never moved…» waits 2.1 s on purpose, `metrics` sleeps.

**Half a second is a tenth of vitest's 5 s**: past it the default limit is less than ten times the
worst. The threshold is the multiplier's, not a number of its own — while the rule said five times, it
was a second.

**Ten times the worst, because a busy runner multiplies a test of seconds nearly fivefold.**
`merge-corpus` «names what the model cannot judge…» went past 5 s (5005–5037 ms) on other people's
pull requests and twice on master, and was given 60 s by #173. On byte-identical code — the night,
the seed, the model, the test, the configs and the lockfile, `git diff` empty — it ran 1590–7655 ms
in 22 runs of 09–14.10.2026: ×4.8. «Five times» was chosen when a busy runner had been seen to slow
it 1.7× (3.0 → 5.0 s); the twenty runs after #173 and the pull request's own then gave 2200–6086 ms,
×2.8, and the rule read «nearly triples» — each the spread of a window, not of the code. A worst
taken in a window without the busiest runner is a calm one: five times it leaves ~1.04 against a run
4.8× slower, ten times ~2. So the test now has 90 s. A short test swings as far: `feedback-bot` ran
under 300 ms in 296 of the 301 runs of 03–09.10, and once 1169 ms — ×3.9 at least. The window of a
measure is written beside it, and the measure reads every test that finished, whatever became of its
run, in every attempt of it: a run re-run on a red lists only its last attempt, and a new push cancels
the whole run, often with its tests done or halfway — each is a measure like any other. The first
measure of MOL-266 left out all 98 cancelled runs of its window, 67 of them with a test that finished,
and with them `spendings`' 1482 ms; the first attempt of a re-run held `seed-catalogue`'s 7119 ms, which
no measure saw. MOL-266 raised the timeouts these put below ten times on 18.10.

**A hook is held the same way against its 10 s.** The CI log prints a test's time only past 300 ms,
and never a hook's, so the hooks and the short tests are measured by the time reporter — the
rule of time below.

## A duration a test asserts itself

**Its bound is at least ten times its worst on CI, and below the test's timeout** — otherwise
vitest's «Test timed out» judges it before the test does. Bounds equal to vitest's 5 s stood in the
suite when the rule was written (MOL-266).

**So a clock catches only a tenfold slowdown or worse.** A bound that must catch less — «no second
search», twice the work — is held by the work: count it, never time it.

**Whether a clock bound holds is decided by a breakage made on purpose, and no wider.** The bound
stays only where each breakage it guards crosses it. «429 without a parse» in `feedback` held the
refusal before the body is read by 200 ms, and a mutant that parses a megabyte answers in ~6 ms on a
Mac: the clock did not hold it, and the test now holds that no byte of the body was read (MOL-266).
`metrics` bounds the loop's lag at 0.1 and 0.15 s, and the mutants answer 140 and 204 ms on a Mac: the
clock holds it while its worst on CI stays below 10 and 15 ms — 0–6 ms by the test's time
in the CI runs read by round 12 of MOL-243's review (11.10).

**Whoever measured the duration**: the test subtracting two readings of the clock, a helper
(`picture`, `bot/assemble`'s `lagBetween`), or the code itself (`metrics`' loop lag). Where the
test's own time is its own wait — `metrics` by `sleep`, `bot/assemble` by `HELD_MS + 250` — that time
is not the measure: measure what is asserted.

**The age of a stamp is not such a duration.** `lastSeenAt` within the hour says when it was
written, not how fast; the slowdown that would cross it is an hour.

## Finding them

**By parsing the TypeScript, never by a line's pattern.** The pattern `expect(now() - started)`
missed the durations a helper measures, and subtracting readings missed the ones the code measures —
each time the hand count was short. **The list of the tests outside the rule is not kept here**: it
grows with the window of the measure and with every new test, and lives in MOL-266 (MOL-265 merged
into it); what holds the rule instead is CI, below.

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
- **Given twenty times, held at ten** (review №29, 19.10): ten times exactly was red again at the next new worst —
  three tests of the pull request on one run, 506 and 525 ms against 5 s, 2 064 against 15 s. Over 1 201 runs
  of CI a test's worst stood at most 1.9 times above the one before it (1.67 for 99 in 100 of the 232 tests
  printed thirty times or more), so a limit of twenty times the worst holds through the next. The 228 tests of
  the pull request's files whose worst came near half a second were given it, and the reporter advises it;
  it turns red at ten, as the rule is written. **The price, named:** a test never printed — under 300 ms
  everywhere — that a runner makes 1.7 times slower still turns its file red; and the clock bounds keep the
  values MOL-243 chose against their breakages, some within twice their ten times (`notify`, «searched only as
  far», `picture`): raising one would let its breakage through.
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
  timeout of 0 is vitest's «none», and such a test is not judged. **The advice is twenty times, rounded up
  to 5 s** — twice what the rule asks, for the next new worst — and every run on CI opens its verdict with how many files of
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
  **It never refuses fake time, and never lets it go** (review №12, adversarial В3; round 16): a number does
  not say which clock it came from, nor whether that clock stood still while it measured. Until round 16 a
  bound met with every clock replaced by vitest's fake timers was marked `fake` and held to nothing; round 16
  let real time through that mark three ways — fake timers that move with the real ones
  (`shouldAdvanceTime`), `perf_hooks`' and `node:process`' own clocks the fake never replaces, a fake turned on
  after the measure or by a concurrent neighbour. So every bound is held as real. **Under fake timers a test
  bounds the schedule, not a clock**: it moves the timers by the bound and asserts the outcome
  (`await vi.advanceTimersByTimeAsync(30_000)`, then `expect(bot.isInited()).toBe(true)` —
  `bot/src/assemble.test.ts`, the one such bound the repository had).
- **`bin/check-clock-bounds.mjs` refuses the upper bounds on a duration it knows**, found by parsing, never by
  a line's pattern (a pattern missed three of eighteen, review of MOL-243, Р10-А1); **the lists are in its
  head**, and two rounds of review found forty spellings past the first one — so the claim is what it lists,
  not «any». In short: readings of `performance.now`, `Date.now`, `new Date`, `process.hrtime` and
  `process.uptime` — the list, not «every clock» — under another name too (`perf_hooks`' and `node:process`' own, `{ now } = Date`, `.bind`), and the file's own clocks; a duration through names,
  fields, classes and their getters, arrays, `+=`, `push`, the answer of a helper, a helper that subtracts a
  reading it takes however it rounds, `hrtime(t0)`, `performance.measure`; a budget — a duration taken from a
  number, `200 - d`, `left -= d`, `deadline - Date.now()`, or divided into one, a rate (`1000 / ms`), kept through
  `Math.max` and `Math.min` — whose lower bound is an upper bound on the duration; each element of an array of
  durations a `for … of` or a callback of the array takes, under a plain name or taken apart, a parameter of a
  function of the file handed one — a method of an object or a class of the file too, by its symbol — or a
  callback a helper of the file hands one to, what a generator of the file yields, what a name of the file
  — not an import, so not `vi` — is handed by a method of its own and gives back (`took.set('a', d)`,
  `took.get('a')`), a store a helper of the file fills through its parameter, the entries `performance` gives
  back. An object or a store holding one holds it whole, and its fields besides: a name taken apart from known
  fields is its own field, `{ tries }` beside `took` a count; `.length`, `.size` and a spy's `mock` are counts
  (review №32). **What is held as time only in doubt and is none says so** (adversarial Ф4, review №34):
  `// not a duration: <why>` at the end of its line or on a line of its own above it — never over the clock read
  straight, a name it was given, a difference of them, a function of the file that is one (`since(t0)`) or a
  method of one (`d.toFixed()`, №37) — and every run prints what a note let go, for review
  to read in the log. Field by field alone lost `rows.at(-1)?.took` and `{ ...report }.took` (adversarial Х2),
  so `report.retries` beside `report.took` is refused, and the note is its lawful spelling;
  bounded by vitest's, chai's and `assert`'s forms, a comparison asserted true or false (`toBe(false)`,
  `isFalse`, `!`, `&&`), `toSatisfy`, `if … throw`, a helper bounding its parameter, and a deadline — a reading
  held below a reading plus a number, or a reading less a number held below a reading. **A comparison of time
  no assertion reads where it stands** — kept in a name, returned by a callback (`took.every((d) => d < n)`), a
  condition — **is held as a bound** (adversarial round 17): which way it is asserted is not read, and
  `expectWithin` is its lawful spelling — a lower bound is asserted where it stands instead,
  `expect(d).toBeGreaterThanOrEqual(250)` (review №31); a loop's condition is a wait, and a duration against zero
  a duration against zero says time has passed or is a mark (`if (d > 0)`, `failAt < 0`, `firstAt <= 0`), but
  a budget against zero is what is left of the time, and a duration less a number against zero (`d - 1_000 > 0`,
  or `over > 0` in two steps) an overage: both bounds (№30, №36, №38, Ф1, Х4, Ц2).
  Two readings against each other are a lower bound (adversarial В4). Names are resolved by TypeScript's binder, so the age of a stamp held under a name
  another test gave a reading is left alone: one side is not the clock. **Fake time is no exception** (MOL-266,
  round 15): a bound under `vi.useFakeTimers()` goes through `expectWithin` as any other, and is held as real. For fourteen rounds the parse let such a bound go raw where it read every clock
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

## A page's timers go with its window (MOL-286)

**The PWA's tests run in `frontend/testing/page-environment.ts`, happy-dom whose timers are cleared as its
window is taken down.** vitest makes `window` the global object itself and leaves Node's own `setTimeout`
in it — the key is Node's already, so happy-dom's is not put over it — and at the end of a file it deletes
`window` and leaves the timers to the process. In a browser a timer never outlives its tab. Here a step
back's guard (`stepBack`, a second, `navigation.ts`) set by a sheet closed in a file's last second fired
after the file was taken down, into a worker a busy runner had not stopped yet: `window is not defined`,
CI red with all 10 138 tests green and the deploy held (run 39489913605, 20.10.2026). A free machine stops
the worker within milliseconds, so it never showed here.

- **The environment, not the product** (owner's В-1 «а», Р-1): `stepBack` is right where it runs, and a
  guard for «no window» in it would be code no browser ever executes. The environment closes the class —
  the queues' doubling retry (`doublingRetry`, a store's timer that reaches the network) is one of it that
  had not failed yet.
- **`setTimeout`, `setInterval` and their `clear*` are wrapped as the window comes up** (`pageTimers`). One
  that ran once, or was cleared, is let go of — until Node's `refresh()` sets it going again under the same
  handle, which puts it back (adversarial А2: no page calls it, a browser's timer has none, and let go of it
  ran past the close). `vi.useFakeTimers()` installs over the wrappers and gives them back; its timers are
  not the page's.
- **Cleared before happy-dom is taken down, and again after it, the wrappers kept between** (adversarial
  А1). Taking happy-dom down aborts what is in the air — a request, a load, a navigation — and runs the
  page's handlers of the failure while the window is still there: a step back answering a failed request
  set its guard then, and cleared only before, it fired past the window exactly as on CI. Only after the
  second clearing are Node's functions given back. **A request still on its way is not aborted by
  happy-dom at all**: its teardown waits for it, so the environment's own test waits for the request to
  reach the server first.
- **The runner's timers go through it too** (review №2): vitest takes its own «safe» timers after the
  environment is up, so a test's deadline, `vi.waitFor` and `expect.poll` are wrapped like the page's. None
  is pending at the teardown — each ends with its test; a runner that one day keeps one past the file has
  it cleared there.
- **Held by tests, each with its mutant red** (В-2 «а»): the bookkeeping — a timeout and an interval pending
  at the close never run, only what is pending is cleared, a timer set between the two clearings is cleared,
  `refresh()` is kept, the functions come back; the teardown — the environment set up over a global object
  of its own, a request aborted as it is taken down, its handler's timer never runs. **That the PWA runs in
  it**: vitest names the environment in the state of `expect`, and `'happy-dom'` back in the config, or
  `--environment` on the command line, turns `expect.getState().environment` red (review №1). **That no file
  names its own past it**: `// @vitest-environment happy-dom` in a file gives it the built-in window and
  Node's timers back, and a directive can carry only a name — vitest reads the first
  `@vitest-environment` or `@jest-environment` by `[\w-]+`, so this environment's path never fits — so every
  test file of the module is read by the same pattern, and only `node` passes (adversarial А3). The race
  itself needs a worker that outlives the teardown, which no ordinary run makes: an environment kept alive
  1.2 s past it reproduced the error of CI over happy-dom and nothing over this one — run by hand
  (`.scratch/tasks/selftests/MOL-286*`), not committed.
- **The price, named:** the environment rests on `builtinEnvironments` of `vitest/runtime` — a vitest that
  renames it fails every file of the PWA at once, loudly. **And vitest tells a DOM by the name in the
  config** (adversarial А4): where it reads the name, not the environment, it takes this one for the server
  — the files no test imported are transformed for the coverage report by Vite's `ssr`, not `client`, so
  `npm run test:coverage` counts other totals for them (AppButton.vue 17 lines, 12 under happy-dom), and a
  static collection of tests (`astCollectTests`) transforms the same way. The PWA has no coverage threshold and
  CI does not count coverage; a test run is untouched — it goes by the environment's `viteEnvironment`.
- **Not this:** a step left in flight between two tests of one file (Р-2). A memory history sends no
  `popstate`, so a step lands only by its guard, a second later; the files that step twice dispatch
  `popstate` themselves (`putBothAway` in `ExchangeView.test.ts`).
