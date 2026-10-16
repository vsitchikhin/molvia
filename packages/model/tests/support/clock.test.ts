import { afterEach, describe, expect, it, vi } from 'vitest'
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

// adversarial round 2 of MOL-266, Б2: fake time is no duration — no runner moves it; round 3, В3 and review
// №12: a number does not say its clock, so nothing is refused, and only a bound with no real clock left is fake
describe('expectWithin under fake timers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a bound met with every clock fake marked fake, for the reporter to hold to nothing', ({
    task,
  }) => {
    vi.useFakeTimers()
    expectWithin(1, 10)
    expect(task.meta.clockBounds).toEqual([{ elapsed: 1, bound: 10, fake: true }])
    delete task.meta.clockBounds
  })

  it.for([
    ['only Date', { toFake: ['Date'] }],
    ['all but performance', { toNotFake: ['performance'] }],
    ['only setTimeout', { toFake: ['setTimeout'] }],
  ] satisfies [string, Parameters<typeof vi.useFakeTimers>[0]][])(
    'holds a bound as real where a clock is left real — %s',
    ([, options], { task }) => {
      vi.useFakeTimers(options)
      expectWithin(1, 10)
      expect(task.meta.clockBounds).toEqual([{ elapsed: 1, bound: 10 }])
      delete task.meta.clockBounds
    },
  )

  it('holds a bound as real after vi.setSystemTime alone, which fakes Date and nothing else', ({
    task,
  }) => {
    vi.setSystemTime(0)
    expectWithin(1, 10)
    expect(task.meta.clockBounds).toEqual([{ elapsed: 1, bound: 10 }])
    delete task.meta.clockBounds
  })
})
