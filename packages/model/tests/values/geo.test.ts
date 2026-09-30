import { describe, expect, it } from 'vitest'
import { geographyAllowed, SETTINGS_CITIES } from '#model/contracts/settings'
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
