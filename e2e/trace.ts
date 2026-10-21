import { test } from '@playwright/test'

/**
 * Keeps the first attempt's trace in CI for the tests of the describe it is called in (MOL-249,
 * MOL-267): a flake passes its retry, and the retry's trace — the config's `on-first-retry` — shows
 * nothing of the failure. Started by hand: `test.use({ trace })` is refused in a describe, and for a
 * whole file it would trace every test of it. Kept only when the first attempt failed — the retry
 * passing included: CI uploads `test-results/` whenever the job fails, for seven days.
 *
 * A run that traces the first attempt itself — `--trace on`, a config's `retain-on-first-failure` —
 * has started it already: that trace is the run's to keep, and this one is not started (review Р2-А1
 * of MOL-249: a second start threw in every test of the block).
 */
export function firstAttemptTrace(): void {
  let own = false
  test.beforeEach(async ({ context }, info) => {
    own = false
    if (!process.env.CI || info.retry > 0) return
    try {
      await context.tracing.start({ snapshots: true, screenshots: false })
      own = true
    } catch (error) {
      if (!String(error).includes('Tracing has been already started')) throw error
    }
  })
  test.afterEach(async ({ context }, info) => {
    if (!own) return
    if (info.status === info.expectedStatus) return context.tracing.stop()
    const path = info.outputPath('trace.zip')
    await context.tracing.stop({ path })
    await info.attach('trace', { path, contentType: 'application/zip' })
  })
}
