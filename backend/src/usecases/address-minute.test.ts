import { describe, expect, it } from 'vitest'
import { LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT } from '@molvia/model'
import { addressMinute } from './address-minute'

const T0 = Date.UTC(2026, 10, 6, 10)

/** Starts from `address` at `now` until one is refused; how many went. */
function startsLetIn(limit: ReturnType<typeof addressMinute>, address: string, now: number) {
  let taken = 0
  while (taken <= LOGIN_WINDOW_LIMIT && limit(address, 1, now)) taken += 1
  return taken
}

describe('addressMinute — the minute of a login start by its address (MOL-359)', () => {
  it('five for an address; another address has its own five in the same minute', () => {
    const limit = addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT)
    expect(startsLetIn(limit, '203.0.113.5', T0)).toBe(LOGIN_ADDRESS_LIMIT)
    expect(startsLetIn(limit, '198.51.100.9', T0)).toBe(LOGIN_ADDRESS_LIMIT)
  })

  it('the minute rolls: a start leaves it sixty seconds later, not a millisecond sooner', () => {
    const limit = addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT)
    expect(startsLetIn(limit, '203.0.113.5', T0)).toBe(LOGIN_ADDRESS_LIMIT)
    expect(limit('203.0.113.5', 1, T0 + 59_999)).toBe(false)
    expect(limit('203.0.113.5', 1, T0 + 60_000)).toBe(true)
  })

  it('a refusal takes no place: the address has all five again once its starts have left', () => {
    const limit = addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT)
    expect(startsLetIn(limit, '203.0.113.5', T0)).toBe(LOGIN_ADDRESS_LIMIT)
    for (let i = 0; i < 10; i += 1) expect(limit('203.0.113.5', 1, T0 + 30_000)).toBe(false)
    expect(startsLetIn(limit, '203.0.113.5', T0 + 60_000)).toBe(LOGIN_ADDRESS_LIMIT)
  })

  it('everybody together stops at the ceiling, so the memory holds no more than it', () => {
    const limit = addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT)
    const addresses = LOGIN_WINDOW_LIMIT / LOGIN_ADDRESS_LIMIT
    for (let host = 0; host < addresses; host += 1) {
      expect(startsLetIn(limit, `198.51.${String(host)}.1`, T0)).toBe(LOGIN_ADDRESS_LIMIT)
    }
    expect(limit('203.0.113.5', 1, T0)).toBe(false)
  })
})
