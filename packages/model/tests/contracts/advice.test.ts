import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ADVICE_LIMIT,
  PRICE_MEDIAN_MIN_OBSERVATIONS,
  adviceResponseSchema,
  adviceRowSchema,
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
  places: [market],
}

const never = {
  level: 'never',
  itemId: ITEM,
  name: 'Колбаса «Молочная»',
  rating: '2.0',
  ratingsCount: 1,
  review: 'Пахнет крахмалом, а не мясом',
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
    const answer = adviceResponseSchema.parse({ scope: 'shared', rows: [take, never] })

    expect(answer.scope).toBe('shared')
    expect(z.encode(adviceResponseSchema, answer)).toEqual({ scope: 'shared', rows: [take, never] })
  })

  it('answers an empty catalogue with an empty list, not with a missing field', () => {
    expect(adviceResponseSchema.parse({ scope: 'own', rows: [] }).rows).toEqual([])
    expect(adviceResponseSchema.safeParse({ scope: 'own' }).success).toBe(false)
  })

  it('refuses a mode a client invented', () => {
    expect(adviceResponseSchema.safeParse({ scope: 'everyone', rows: [] }).success).toBe(false)
  })

  it('stops at the limit rather than carrying a list nobody bounded', () => {
    const rows = Array.from({ length: ADVICE_LIMIT + 1 }, () => take)

    expect(adviceResponseSchema.safeParse({ scope: 'own', rows: rows.slice(1) }).success).toBe(true)
    expect(adviceResponseSchema.safeParse({ scope: 'own', rows }).success).toBe(false)
  })
})

describe('the numbers the screen depends on', () => {
  it('needs three purchases before a threshold, as everything else in this project does', () => {
    expect(PRICE_MEDIAN_MIN_OBSERVATIONS).toBe(3)
  })
})
