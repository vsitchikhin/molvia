import { describe, expect, it } from 'vitest'
import { signedInClock } from '#model/contracts/login-notice'

describe('signedInClock (MOL-361)', () => {
  it('reads the day and HH:MM in the country’s zone, padded at midnight', () => {
    // 20:05 UTC is 00:05 of the next day in Yerevan, and 21:05 in Belgrade in winter.
    const at = new Date('2026-11-09T20:05:00Z')
    expect(signedInClock(at, 'AM')).toEqual({ day: '2026-11-10', time: '00:05' })
    expect(signedInClock(at, 'RS')).toEqual({ day: '2026-11-09', time: '21:05' })
  })

  it('a country with no zone of ours is read in Yerevan’s', () => {
    expect(signedInClock(new Date('2026-11-09T10:05:00Z'), 'XX')).toEqual({
      day: '2026-11-09',
      time: '14:05',
    })
  })
})
