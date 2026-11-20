import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tappedWithinDay, useRfCardTap } from './useRfCardTap'

const rfCardTap = vi.fn<(again: boolean) => Promise<void>>(() => Promise.resolve())
vi.mock('@/api', () => ({ api: { rfCardTap: (again: boolean) => rfCardTap(again) } }))

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-11-21T12:00:00Z')

describe('«У меня только карта РФ» — the device’s own repeat (MOL-277, Р-8)', () => {
  it('is a repeat within the day before, as the login’s', () => {
    expect(tappedWithinDay(String(now - 1), now)).toBe(true)
    expect(tappedWithinDay(String(now - DAY + 1), now)).toBe(true)
  })

  it('is none a day on, with nothing kept, with junk, or from a clock that ran ahead', () => {
    expect(tappedWithinDay(String(now - DAY), now)).toBe(false)
    expect(tappedWithinDay(null, now)).toBe(false)
    expect(tappedWithinDay('yes', now)).toBe(false)
    expect(tappedWithinDay(String(now + 60_000), now)).toBe(false)
  })
})

describe('useRfCardTap — the button counts its tap (review №5)', () => {
  beforeEach(() => {
    localStorage.clear()
    rfCardTap.mockClear()
  })

  it('sends a first tap, then the device’s repeat, and a refused send is no error', async () => {
    const tap = useRfCardTap()
    tap()
    rfCardTap.mockRejectedValueOnce(new Error('offline'))
    tap()
    await Promise.resolve()
    expect(rfCardTap.mock.calls).toEqual([[false], [true]])
  })
})
