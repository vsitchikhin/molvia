import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT } from '@molvia/model'
import { addressMinute } from './address-minute'

/** A counter on a clock the test moves: `at` is the moment of the next call. */
function onClock(perAddress = LOGIN_ADDRESS_LIMIT, perMinute = LOGIN_WINDOW_LIMIT) {
  const clock = { at: 0 }
  return { clock, limit: addressMinute(perAddress, perMinute, () => clock.at) }
}

/** How many of one from `address` go before one is refused. */
function letIn(limit: ReturnType<typeof addressMinute>, address: string) {
  let taken = 0
  while (taken <= LOGIN_WINDOW_LIMIT && limit(address, 1)) taken += 1
  return taken
}

/** What the counter's map holds of `address`: every `Map.prototype.set` is watched. */
function memory(): { readonly of: (address: string) => unknown } {
  const spy = vi.spyOn(Map.prototype, 'set')
  return {
    of: (address) =>
      (spy.mock.contexts as Map<unknown, unknown>[]).find((map) => map.has(address))?.get(address),
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('addressMinute — a rolling minute per address and for everybody (MOL-144, MOL-359)', () => {
  it('an address takes its limit exactly, not one more; another address has its own', () => {
    const { limit } = onClock()
    expect(letIn(limit, '203.0.113.5')).toBe(LOGIN_ADDRESS_LIMIT)
    expect(letIn(limit, '198.51.100.9')).toBe(LOGIN_ADDRESS_LIMIT)
  })

  it('counts what was asked for, not calls: a batch too large is refused whole', () => {
    const { limit } = onClock(5, 100)
    expect(limit('a', 6)).toBe(false)
    expect(limit('a', 5)).toBe(true)
  })

  it('the minute rolls: a start leaves it sixty seconds later, not a millisecond sooner', () => {
    const { clock, limit } = onClock()
    expect(letIn(limit, '203.0.113.5')).toBe(LOGIN_ADDRESS_LIMIT)
    clock.at = 59_999
    expect(limit('203.0.113.5', 1)).toBe(false)
    clock.at = 60_000
    expect(limit('203.0.113.5', 1)).toBe(true)
  })

  it('a refusal takes no place and leaves no address', () => {
    const kept = memory()
    const { clock, limit } = onClock()
    expect(limit('greedy', LOGIN_ADDRESS_LIMIT + 1)).toBe(false)
    expect(kept.of('greedy')).toBeUndefined()
    expect(letIn(limit, '203.0.113.5')).toBe(LOGIN_ADDRESS_LIMIT)
    clock.at = 30_000
    for (let i = 0; i < 10; i += 1) expect(limit('203.0.113.5', 1)).toBe(false)
    clock.at = 60_000
    expect(letIn(limit, '203.0.113.5')).toBe(LOGIN_ADDRESS_LIMIT)
  })

  it('everybody together stops at the ceiling, so the memory holds no more than it', () => {
    const { limit } = onClock()
    for (let host = 0; host < LOGIN_WINDOW_LIMIT / LOGIN_ADDRESS_LIMIT; host += 1) {
      expect(letIn(limit, `198.51.${String(host)}.1`)).toBe(LOGIN_ADDRESS_LIMIT)
    }
    expect(limit('203.0.113.5', 1)).toBe(false)
  })

  it('forget lets an address go a minute on, with no other request, and keeps the young', () => {
    const kept = memory()
    const { clock, limit } = onClock()
    expect(limit('old', 1)).toBe(true)
    clock.at = 1
    expect(limit('young', 1)).toBe(true)
    clock.at = 60_000
    limit.forget()
    expect(kept.of('old')).toBeUndefined()
    expect(kept.of('young')).toEqual([{ at: 1, count: 1 }])
  })

  it('forget gives nothing back before the minute', () => {
    const { clock, limit } = onClock()
    expect(letIn(limit, 'a')).toBe(LOGIN_ADDRESS_LIMIT)
    clock.at = 30_000
    limit.forget()
    expect(limit('a', 1)).toBe(false)
    expect(limit('b', 1)).toBe(true)
  })

  it('giveBack frees the latest place the address took, and an address with none left goes (А2)', () => {
    const kept = memory()
    const { clock, limit } = onClock()
    expect(limit('a', 1)).toBe(true)
    clock.at = 10_000
    expect(letIn(limit, 'a')).toBe(LOGIN_ADDRESS_LIMIT - 1)
    limit.giveBack('a', 1)
    expect(limit('a', 1)).toBe(true)
    limit.giveBack('b', 1)
    expect(limit('b', 1)).toBe(true)
    limit.giveBack('b', 1)
    expect(kept.of('b')).toBeUndefined()
  })

  it('the minute is a clock that never steps back: a wall clock stepped either way changes nothing (А1)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    const limit = addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT)
    expect(letIn(limit, '203.0.113.5')).toBe(LOGIN_ADDRESS_LIMIT)
    // NTP steps the wall clock back by ten minutes; a real second passes.
    vi.setSystemTime(Date.now() - 10 * 60_000)
    vi.advanceTimersByTime(1_000)
    expect(limit('203.0.113.5', 1)).toBe(false)
    // Then forward by twenty, and another real second: still the same minute, no five more.
    vi.setSystemTime(Date.now() + 20 * 60_000)
    vi.advanceTimersByTime(1_000)
    expect(limit('203.0.113.5', 1)).toBe(false)
    // A real minute after the starts, the address is free, and forget lets it go.
    vi.advanceTimersByTime(58_000)
    limit.forget()
    expect(letIn(limit, '203.0.113.5')).toBe(LOGIN_ADDRESS_LIMIT)
  })
})
