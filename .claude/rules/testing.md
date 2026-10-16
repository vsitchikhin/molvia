---
paths:
  - '**/*.test.ts'
  - '**/vitest*.config.ts'
---

# Tests: their own timeout, and a bound on the clock

The detail behind the timeout line of `CLAUDE.md` › Testing (MOL-243). The area owns no files of its
own — every test belongs to the area it tests — so it has no code map.

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
measure is written beside it, and the measure reads every run whose job of tests finished: a new push
cancels the whole run, often with its tests done and only end-to-end cut short, and a push after a push
is the busy hour. The measure of MOL-266 left out 43 such runs and with them `spendings`' 1482 ms.

**A hook is held the same way against its 10 s.** The CI log prints a test's time only past 300 ms,
and never a hook's, so the hooks and the short tests are measured by a reporter — MOL-266 brings
one.

## A duration a test asserts itself

**Its bound is at least ten times its worst on CI, and below the test's timeout** — otherwise
vitest's «Test timed out» judges it before the test does. Bounds equal to vitest's 5 s stood in the
suite when the rule was written (MOL-266).

**So a clock catches only a tenfold slowdown or worse.** A bound that must catch less — «no second
search», twice the work — is held by the work: count it, never time it.

**Whether a clock bound holds is decided by a breakage made on purpose, and no wider.** The bound
stays only where each breakage it guards crosses it. «429 without a parse» in `feedback` holds the
refusal before the body is read by 200 ms, and a mutant that parses a megabyte answers in ~6 ms on a
Mac: the clock does not hold it. `metrics` bounds the loop's lag at 0.1 and 0.15 s, and the mutants
answer 140 and 204 ms on a Mac: the clock holds it while its worst on CI stays below 10 and 15 ms —
0–6 ms by the test's time in the CI runs read by round 12 of MOL-243's review (11.10).

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
into it), as does the guard in CI that holds it.
