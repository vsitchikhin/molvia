import { describe, expect, it } from 'vitest'
import { expectWithin } from './clock'

describe('expectWithin', () => {
  it('passes below the bound and keeps what it was asked in the test’s meta', ({ task }) => {
    expectWithin(3, 10)
    expectWithin(9.99, 10)
    expect(task.meta.clockBounds).toEqual([
      { elapsed: 3, bound: 10 },
      { elapsed: 9.99, bound: 10 },
    ])
    // these are the test's own numbers, not durations: the reporter must not read them
    delete task.meta.clockBounds
  })

  it('fails at the bound and past it, and keeps those too — the reporter reads a red run as well', ({
    task,
  }) => {
    expect(() => {
      expectWithin(10, 10)
    }).toThrow()
    expect(() => {
      expectWithin(10.01, 10)
    }).toThrow()
    expect(task.meta.clockBounds).toEqual([
      { elapsed: 10, bound: 10 },
      { elapsed: 10.01, bound: 10 },
    ])
    delete task.meta.clockBounds
  })
})

// adversarial round 1 of MOL-266, А7: vitest's current test is one for the worker, so beside a running
// neighbour it is the neighbour or none
describe.concurrent('expectWithin in a concurrent test', () => {
  it('refuses a bound without the test’s context, rather than keep it on another test', ({
    expect,
  }) => {
    expect(() => {
      expectWithin(1, 10)
    }).toThrow(/concurrent/)
  })

  it('keeps the bound on its own test when given its context', async ({ task, expect }) => {
    await Promise.resolve()
    expectWithin(1, 10, { task })
    expect(task.meta.clockBounds).toEqual([{ elapsed: 1, bound: 10 }])
    delete task.meta.clockBounds
  })
})
