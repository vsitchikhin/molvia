import { describe, expect, it } from 'vitest'
import { geographyAllowed, SETTINGS_CITIES, SETTINGS_COUNTRIES } from '#model/contracts/settings'
import { COUNTRY_PHONE_ZONES, COUNTRY_TIME_ZONES, timeZoneOf } from '#model/values/geo'

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

  it('reads Russia in Moscow’s zone (MOL-412)', () => {
    expect(timeZoneOf('RU')).toBe('Europe/Moscow')
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
    expect(timeZoneOf('KZ')).toBeNull()
    expect(timeZoneOf('constructor')).toBeNull()
  })
})

describe('COUNTRY_PHONE_ZONES (MOL-412)', () => {
  const phoneZones = Object.entries(COUNTRY_PHONE_ZONES).flatMap(([country, zones]) =>
    zones.map((zone) => ({ country, zone })),
  )
  /** The clock a zone shows at a moment, `HH:MM`. */
  const clock = (at: Date, timeZone: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at)

  it('is a zone of a country of the settings, which the runtime knows', () => {
    expect(phoneZones).not.toHaveLength(0)
    for (const { country, zone } of phoneZones) {
      expect(
        SETTINGS_COUNTRIES.some((known) => known === country),
        zone,
      ).toBe(true)
      expect(() => new Intl.DateTimeFormat('en', { timeZone: zone }), zone).not.toThrow()
    }
  })

  it('leads to one country, and is never a country’s own zone', () => {
    const zones = phoneZones.map(({ zone }) => zone)
    expect(new Set(zones).size).toBe(zones.length)
    for (const zone of zones) expect(Object.values(COUNTRY_TIME_ZONES), zone).not.toContain(zone)
  })

  it('shows the clock of its country’s zone, winter and summer: the person’s day is that zone’s', () => {
    const moments = [new Date('2026-01-15T12:00:00Z'), new Date('2026-07-15T12:00:00Z')]
    for (const { country, zone } of phoneZones) {
      const own = timeZoneOf(country)!
      for (const at of moments)
        expect(clock(at, zone), `${zone} ${at.toISOString()}`).toBe(clock(at, own))
    }
  })
})
