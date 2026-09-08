import { describe, expect, it } from 'vitest'
import { newPlaceSchema, placeSchema } from '#model/entities/place'

const place = {
  id: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b',
  kind: 'store',
  name: 'SAS',
  country: 'AM',
  city: 'Гюмри',
  createdAt: new Date('2026-09-08T10:00:00Z'),
}

describe('placeSchema', () => {
  it('accepts a shop', () => {
    expect(placeSchema.parse(place).name).toBe('SAS')
  })

  it("parses kind 'venue', so 0.3 needs no migration", () => {
    expect(placeSchema.parse({ ...place, kind: 'venue' }).kind).toBe('venue')
  })

  it('rejects a country that is not ISO 3166-1 alpha-2', () => {
    for (const country of ['ARM', 'am', 'A', '']) {
      expect(() => placeSchema.parse({ ...place, country })).toThrow()
    }
  })
})

describe('newPlaceSchema', () => {
  const input = { kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' }

  it('takes what a client can know', () => {
    expect(newPlaceSchema.parse(input)).toEqual(input)
  })

  it('refuses an id: the server hands those out', () => {
    expect(() => newPlaceSchema.parse({ ...input, id: place.id })).toThrow()
  })

  it('refuses a currency: money follows the person, not the shop', () => {
    expect(() => newPlaceSchema.parse({ ...input, currency: 'AMD' })).toThrow()
  })
})
