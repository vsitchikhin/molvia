// Run by `test-time-reporter.test.ts` through vitest itself, never collected on its own: the hooks
// wait set times, so the reporter's reading of the worker's marks can be checked against them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectWithin } from '@molvia/model/testing/clock'

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const OWN_MS = 30_000

// past the 300 ms the reporter prints a hook from
beforeAll(async () => {
  await wait(320)
}, OWN_MS)

afterAll(async () => {
  await wait(310)
})

describe('inner', () => {
  beforeAll(async () => {
    await wait(100)
  })

  it('takes its own timeout', async () => {
    await wait(10)
    expect(true).toBe(true)
  }, 20_000)

  it('keeps what it bounded', () => {
    expectWithin(3, 15)
    expectWithin(12, 5_000)
  })
})
