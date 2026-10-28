import { describe, expect, it } from 'vitest'
import {
  SILENCE_SEND_FROM_HOUR,
  SILENCE_SEND_UNTIL_HOUR,
  SILENCE_DEFAULT_ZONE,
  silenceCountdown,
  silenceSendDay,
  silenceZoneOf,
} from '#model/entities/silence'
import { COUNTRY_TIME_ZONES } from '#model/values/geo'

const countries = (now: Date) => [...silenceSendDay(now).countries].sort()

describe('silenceSendDay — the person’s own day (MOL-239, Р-5)', () => {
  it('names every country at noon in Yerevan in summer', () => {
    // 12:00 in Yerevan and Tbilisi, 10:00 in Belgrade (summer time)
    expect(countries(new Date('2027-09-26T08:00:00Z'))).toEqual(['AM', 'GE', 'RS'])
  })

  it('opens at ten and closes at twenty, by each country’s clock', () => {
    // 09:59 in Belgrade is not yet, while Yerevan has been open for two hours
    expect(countries(new Date('2027-07-01T07:59:00Z'))).toEqual(['AM', 'GE'])
    expect(countries(new Date('2027-07-01T08:00:00Z'))).toEqual(['AM', 'GE', 'RS'])
    // 20:00 in Yerevan is closed; 18:00 in Belgrade is still open
    expect(countries(new Date('2027-07-01T16:00:00Z'))).toEqual(['RS'])
    expect(SILENCE_SEND_FROM_HOUR).toBeLessThan(SILENCE_SEND_UNTIL_HOUR)
  })

  it('names nobody at night everywhere', () => {
    // 01:00 in Yerevan and Tbilisi, 23:00 in Belgrade
    expect(silenceSendDay(new Date('2027-09-25T21:00:00Z'))).toEqual({
      countries: [],
      elsewhere: false,
    })
  })

  it('knows every country with a zone', () => {
    const all = new Set<string>()
    for (let hour = 0; hour < 24; hour += 1) {
      for (const country of silenceSendDay(new Date(Date.UTC(2027, 6, 1, hour))).countries) {
        all.add(country)
      }
    }
    expect([...all].sort()).toEqual(Object.keys(COUNTRY_TIME_ZONES).sort())
  })
})

describe('a country with no zone (self-review №4)', () => {
  it('is read in Yerevan’s day, never in nobody’s', () => {
    expect(silenceZoneOf('XX')).toBe(SILENCE_DEFAULT_ZONE)
    expect(silenceZoneOf('RS')).toBe('Europe/Belgrade')
    // 12:00 in Yerevan — and its day is the day of a country with no zone
    expect(silenceSendDay(new Date('2027-09-26T08:00:00Z')).elsewhere).toBe(true)
    // 20:00 in Yerevan, 18:00 in Belgrade
    expect(silenceSendDay(new Date('2027-07-01T16:00:00Z')).elsewhere).toBe(false)
  })
})

describe('silenceCountdown — the day it goes and the days left, in the person’s zone', () => {
  it('counts calendar days of the zone, not 24-hour spans', () => {
    // 23:30 in Yerevan on the 25th, and the account goes at 01:00 there on the 27th
    expect(
      silenceCountdown(
        new Date('2027-09-26T21:00:00Z'),
        new Date('2027-09-25T19:30:00Z'),
        'Asia/Yerevan',
      ),
    ).toEqual({ day: '2027-09-27', days: 2 })
  })

  it('reads the day in the zone where the UTC day is another', () => {
    expect(
      silenceCountdown(
        new Date('2027-10-25T22:30:00Z'),
        new Date('2027-09-26T08:00:00Z'),
        'Europe/Belgrade',
      ),
    ).toEqual({ day: '2027-10-26', days: 30 })
  })

  it('never says fewer than one day', () => {
    const now = new Date('2027-09-26T08:00:00Z')
    expect(silenceCountdown(now, now, 'Asia/Yerevan')).toEqual({ day: '2027-09-26', days: 1 })
  })
})
