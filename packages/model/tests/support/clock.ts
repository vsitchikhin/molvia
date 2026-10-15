import { expect, TestRunner, type TestContext } from 'vitest'

/** What a test asserted of a duration, kept for the time reporter (`bin/test-time-reporter.ts`). */
export interface ClockBound {
  readonly elapsed: number
  readonly bound: number
}

declare module 'vitest' {
  interface TaskMeta {
    clockBounds?: ClockBound[]
  }
}

/**
 * The one way a test bounds a duration from above (MOL-243, MOL-266): asserts `elapsed < bound`, in
 * milliseconds, and writes both into the test's meta, so every run of CI says how far below its
 * bound each one stood. A bound less than ten times its worst there, or not below the test's own
 * timeout, is the time reporter's to name. Whoever measured it — the test's clock, a helper of the
 * test, the code under test (`metrics`) — the duration comes here; `bin/check-clock-bounds.mjs`
 * refuses a reading of the clock bounded any other way.
 *
 * A concurrent test passes its context: vitest's current test is one for the whole worker, and
 * beside another test running it is that other test, or none (adversarial А7). Without the context
 * a bound there is refused rather than kept on the wrong test.
 */
export function expectWithin(
  elapsed: number,
  bound: number,
  context?: Pick<TestContext, 'task'>,
): void {
  const test = context?.task ?? TestRunner.getCurrentTest()
  if (!test || (!context && test.concurrent)) {
    throw new Error(
      'expectWithin outside a test, or in a concurrent one without its context: expectWithin(elapsed, bound, context)',
    )
  }
  ;(test.meta.clockBounds ??= []).push({ elapsed, bound })
  expect(elapsed).toBeLessThan(bound)
}
