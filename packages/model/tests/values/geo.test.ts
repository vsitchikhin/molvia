import { describe, expect, it } from 'vitest'
import { geographyAllowed, SETTINGS_CITIES, SETTINGS_COUNTRIES } from '#model/contracts/settings'
import { COUNTRY_TIME_ZONES, timeZoneOf } from '#model/values/geo'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

describe('timeZoneOf (MOL-101)', () => {
  it('has a day for every country the settings accept', () => {
    // Every pair of letters, since the settings keep no list of countries: whatever a person can
    // choose, the reminder has to know when their evening is.
    const held = { country: 'ZZ', city: 'Nowhere' }
    for (const first of LETTERS) {
      for (const second of LETTERS) {
        const country = first + second
        if (SETTINGS_CITIES.some((city) => geographyAllowed({ country, city }, held))) {
          expect(timeZoneOf(country), country).not.toBeNull()
        }
      }
    }
  })

  it('reads Tbilisi and Belgrade in their own zones (MOL-109)', () => {
    expect(timeZoneOf('GE')).toBe('Asia/Tbilisi')
    expect(timeZoneOf('RS')).toBe('Europe/Belgrade')
  })

  it('gives every country of the settings a zone of its own, so a zone names one country', () => {
    const zones = SETTINGS_COUNTRIES.map((country) => timeZoneOf(country))
    expect(zones).not.toContain(null)
    expect(new Set(zones).size).toBe(zones.length)
  })

  it('names zones the runtime knows', () => {
    for (const zone of Object.values(COUNTRY_TIME_ZONES)) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow()
    }
  })

  it('has no day for a country it does not know, nor for a key of Object', () => {
    expect(timeZoneOf('RU')).toBeNull()
    expect(timeZoneOf('constructor')).toBeNull()
  })
})
