import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ADVICE_LIMIT,
  OWN_ALTERNATIVES_MAX,
  PRICE_MEDIAN_MIN_OBSERVATIONS,
  adviceResponseSchema,
  adviceRowSchema,
  ownPricesQuerySchema,
  ownPricesResponseSchema,
  ownPricesSchema,
} from '#model/contracts/advice'

const ITEM = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const PLACE = '2b7a1f30-5c8d-4a2e-9f11-6d3c8e0b4a57'

// A unit price crosses the wire with every digit the ratio holds — eight for a currency on
// two — so these are what `encode` produces, not a shortened spelling of it.
const price = { amount: '4790.00000000', currency: 'AMD', unit: 'kg' } as const
const cheaper = { amount: '4500.00000000', currency: 'AMD', unit: 'kg' } as const

const market = { placeId: PLACE, name: 'Рынок в Гюмри', unitPrice: price, observations: 2 }

const take = {
  level: 'take',
  itemId: ITEM,
  name: 'Говядина, вырезка',
  rating: '4.3',
  ratingsCount: 3,
  review: null,
  isMine: true,
  places: [market],
}

const never = {
  level: 'never',
  itemId: ITEM,
  name: 'Колбаса «Молочная»',
  rating: '2.0',
  ratingsCount: 1,
  review: 'Пахнет крахмалом, а не мясом',
  isMine: true,
}

describe('adviceRowSchema', () => {
  it('carries the cheapest places of a «take» over the wire', () => {
    const row = adviceRowSchema.parse(take)

    expect(row.level).toBe('take')
    expect(row.level === 'take' && row.places[0]?.unitPrice.scaledMinor).toBe(479_000_000_000n)
    expect(z.encode(adviceRowSchema, row)).toEqual(take)
  })

  it('carries a threshold on «if_cheap», and null while there is nothing to build one from', () => {
    const base = { ...take, level: 'if_cheap' as const, rating: '3.0', places: [market] }

    expect(adviceRowSchema.parse({ ...base, threshold: cheaper }).level).toBe('if_cheap')
    expect(adviceRowSchema.parse({ ...base, threshold: null })).toMatchObject({ threshold: null })
    // The field is not optional: «no threshold» is a thing the server says, not one it omits.
    expect(adviceRowSchema.safeParse(base).success).toBe(false)
  })

  it('has no place for a price on «never» — the rule is held by the type, not by a reader', () => {
    expect(adviceRowSchema.parse(never).level).toBe('never')

    for (const smuggled of [
      { places: [market] },
      { places: [] },
      { threshold: cheaper },
      { threshold: null },
    ]) {
      expect(adviceRowSchema.safeParse({ ...never, ...smuggled }).success).toBe(false)
    }
  })

  it('says whose verdict stands behind it — nothing else in the row does', () => {
    // In the shared mode a row may be entirely other people's, and a review is empty there
    // exactly as it is on one's own verdict without one (MOL-32, А2).
    expect(adviceRowSchema.parse({ ...never, isMine: false }).isMine).toBe(false)
    // Not optional: «whose is it» is a thing the server says, not one it omits.
    expect(adviceRowSchema.safeParse({ ...never, isMine: undefined }).success).toBe(false)
  })

  it('refuses a level nobody decided on', () => {
    expect(adviceRowSchema.safeParse({ ...take, level: 'maybe' }).success).toBe(false)
  })

  it('refuses a rating that is not a decimal with one tenth', () => {
    // A whole number and a float are both wrong here: one person's five is «5.0», and an
    // average is never a double — the field is a string so neither can become one.
    for (const rating of ['5', '4.25', '0.9', '5.1', '', '4,3']) {
      expect(adviceRowSchema.safeParse({ ...take, rating }).success).toBe(false)
    }
  })

  it('refuses a count of nobody — a row exists because someone rated it', () => {
    expect(adviceRowSchema.safeParse({ ...take, ratingsCount: 0 }).success).toBe(false)
  })

  it('refuses a place with no purchase behind its price', () => {
    const empty = { ...market, observations: 0 }

    expect(adviceRowSchema.safeParse({ ...take, places: [empty] }).success).toBe(false)
  })

  it('refuses a field nobody put in the contract, whatever the level', () => {
    expect(adviceRowSchema.safeParse({ ...take, sponsored: true }).success).toBe(false)
    expect(adviceRowSchema.safeParse({ ...never, boost: 1 }).success).toBe(false)
  })
})

describe('adviceResponseSchema', () => {
  it('says whose figures it carries', () => {
    const wire = {
      geography: { country: 'AM', city: 'Гюмри' },
      scope: 'shared',
      rows: [take, never],
      total: 2,
    }
    const answer = adviceResponseSchema.parse(wire)

    expect(answer.scope).toBe('shared')
    expect(z.encode(adviceResponseSchema, answer)).toEqual(wire)
  })

  it('answers an empty catalogue with an empty list, not with a missing field', () => {
    expect(
      adviceResponseSchema.parse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        rows: [],
        total: 0,
      }).rows,
    ).toEqual([])
    expect(
      adviceResponseSchema.safeParse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        total: 0,
      }).success,
    ).toBe(false)
    expect(
      adviceResponseSchema.safeParse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        rows: [],
      }).success,
    ).toBe(false)
  })

  it('refuses a mode a client invented', () => {
    expect(
      adviceResponseSchema.safeParse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'everyone',
        rows: [],
        total: 0,
      }).success,
    ).toBe(false)
  })

  it('stops at the limit rather than carrying a list nobody bounded', () => {
    const rows = Array.from({ length: ADVICE_LIMIT + 1 }, () => take)

    const total = rows.length
    expect(
      adviceResponseSchema.safeParse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        rows: rows.slice(1),
        total,
      }).success,
    ).toBe(true)
    expect(
      adviceResponseSchema.safeParse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        rows,
        total,
      }).success,
    ).toBe(false)
    // Счётчик не может быть меньше страницы, которую он сопровождает.
    expect(
      adviceResponseSchema.safeParse({
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        rows: [take],
        total: 0,
      }).success,
    ).toBe(false)
  })
})

describe('the numbers the screen depends on', () => {
  it('needs three purchases before a threshold, as everything else in this project does', () => {
    expect(PRICE_MEDIAN_MIN_OBSERVATIONS).toBe(3)
  })
})

describe('ownPricesSchema (MOL-92, «Тут дешевле»)', () => {
  const zovuni = {
    ...market,
    name: 'Зовуни',
    quantity: { value: '1.000', unit: 'kg' },
    day: '2026-09-12',
    observations: 3,
  }
  const marianna = {
    itemId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    name: 'Молоко Марианна',
    level: 'take',
    rating: '4.5',
    places: [zovuni],
  } as const
  const priced = {
    itemId: ITEM,
    level: 'take',
    rating: '4.0',
    places: [zovuni],
    alternatives: [marianna],
  }

  it('carries the places and the alternatives of a rated item, the unit price decoded', () => {
    const answer = ownPricesSchema.parse(priced)
    expect(answer.level === 'take' && answer.places[0]?.unitPrice.unit).toBe('kg')
  })

  it('has no field for a price on «не брать нигде» — a price there fails to parse (Т-3)', () => {
    expect(ownPricesSchema.safeParse({ itemId: ITEM, level: 'never' }).success).toBe(true)
    for (const extra of [{ places: [zovuni] }, { alternatives: [] }, { rating: '1.0' }]) {
      expect(ownPricesSchema.safeParse({ itemId: ITEM, level: 'never', ...extra }).success).toBe(
        false,
      )
    }
  })

  it('has no rating on an item not rated, and still its prices', () => {
    const unrated = { itemId: ITEM, level: 'unrated', places: [zovuni], alternatives: [] }
    expect(ownPricesSchema.safeParse(unrated).success).toBe(true)
    expect(ownPricesSchema.safeParse({ ...unrated, rating: '4.0' }).success).toBe(false)
  })

  it('refuses a day that is not a calendar day', () => {
    for (const day of ['2026-02-31', '12.09', '2026-9-12']) {
      const bad = { ...priced, places: [{ ...zovuni, day }] }
      expect(ownPricesSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('refuses an alternative that is «не брать нигде», unrated, or has no place', () => {
    for (const other of [
      { ...marianna, level: 'never' },
      { ...marianna, rating: undefined },
      { ...marianna, places: [] },
    ]) {
      expect(ownPricesSchema.safeParse({ ...priced, alternatives: [other] }).success).toBe(false)
    }
  })

  it(`carries at most ${String(OWN_ALTERNATIVES_MAX)} alternatives`, () => {
    const many = (n: number) => ({
      ...priced,
      alternatives: Array.from({ length: n }, () => marianna),
    })
    expect(ownPricesSchema.safeParse(many(OWN_ALTERNATIVES_MAX)).success).toBe(true)
    expect(ownPricesSchema.safeParse(many(OWN_ALTERNATIVES_MAX + 1)).success).toBe(false)
  })

  it('travels with the city it was counted in, `null` for a record not one’s own', () => {
    const where = { country: 'AM', city: 'Ереван' }
    expect(ownPricesResponseSchema.parse({ where, prices: priced }).where).toEqual(where)
    expect(
      ownPricesResponseSchema.parse({
        where: null,
        prices: { ...priced, places: [], alternatives: [] },
      }).where,
    ).toBeNull()
    expect(ownPricesResponseSchema.safeParse({ prices: priced }).success).toBe(false)
  })
})

describe('ownPricesQuerySchema', () => {
  const city = { item: ITEM, country: 'AM', city: 'Ереван' }
  const trip = { item: ITEM, trip: PLACE }

  it('names the record the server holds, or the city of one still in the queue; `except` optional', () => {
    expect(ownPricesQuerySchema.parse(trip)).toEqual(trip)
    expect(ownPricesQuerySchema.parse(city)).toEqual(city)
    expect(ownPricesQuerySchema.parse({ ...trip, except: PLACE })).toMatchObject({ except: PLACE })
  })

  it('refuses both at once, neither, half a city, a malformed id and anything else', () => {
    for (const query of [
      { ...trip, country: 'AM', city: 'Ереван' },
      { item: ITEM },
      { item: ITEM, city: 'Ереван' },
      { ...trip, item: 'milk' },
      { ...trip, trip: 'record' },
      { ...city, except: 'row' },
      { ...city, scope: 'shared' },
    ]) {
      expect(ownPricesQuerySchema.safeParse(query).success).toBe(false)
    }
  })
})
