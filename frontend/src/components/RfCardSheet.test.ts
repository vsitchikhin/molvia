import { describe, expect, it } from 'vitest'
import { tappedWithinDay } from './RfCardSheet.vue'

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
