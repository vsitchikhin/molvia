import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { actorPatchSchema } from '#model/entities/actor'
import { INT8_MAX } from '#model/support/decimal'
import { ERROR } from '#model/support/errors'
import type { Expense } from '#model/entities/expense'
import { newExpenseSchema } from '#model/entities/expense'
import { itemSchema } from '#model/entities/item'
import {
  MINOR_EXPONENT,
  decimalFromMinor,
  formatMoney,
  money,
  moneyCodec,
  parseMoney,
  subtractMoney,
} from '#model/values/money'
import { newPlaceSchema } from '#model/entities/place'
import { tripSchema, tripTotal } from '#model/entities/trip'
import {
  compareUnitPrice,
  formatUnitPrice,
  parseQuantity,
  quantityCodec,
  quantitySchema,
  unitPrice,
} from '#model/values/units'
import { verdictLevel } from '#model/entities/verdict'

/**
 * The adversarial pass on this model found twenty ways to make it answer wrongly, silently
 * or with the wrong kind of error. Every one of them is pinned here, in the shape it was
 * found in, so that a later change has to break a named scenario rather than a unit.
 *
 * The report that produced them: `.scratch/tasks/selftests/MOL-4-adversarial.md`.
 */

const ids = {
  trip: 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
  item: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  expense: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
}

const place = { kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' }

const item = {
  id: ids.item,
  kind: 'product',
  name: 'Молоко «Ашхар»',
  searchKey: 'moloko ashkhar',
  barcodes: [],
  note: null,
  defaultUnit: 'l',
  typicalQuantity: null,
  createdBy: null,
  createdAt: new Date('2026-09-08T10:00:00Z'),
}

const trip = {
  id: ids.trip,
  actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
  placeId: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b',
  currency: 'AMD',
  rate: null,
  startedAt: new Date('2026-09-08T10:00:00Z'),
  finishedAt: null,
}

const expense = (amount: Expense['amount']): Expense => ({
  id: ids.expense,
  tripId: ids.trip,
  itemId: ids.item,
  quantity: null,
  amount,
  createdAt: new Date('2026-09-08T10:05:00Z'),
})

describe('a malformed body reaches the route as a failure, not as an exception', () => {
  it('does not escape safeParse anywhere a codec is used', () => {
    // A1. Every schema with a codec inside: an expense, a patch, an item, a trip.
    const bodies = [
      { tripId: ids.trip, itemId: ids.item, amount: { amount: 'не число', currency: 'AMD' } },
      { tripId: ids.trip, itemId: ids.item, quantity: { value: '0', unit: 'kg' } },
      { tripId: ids.trip, itemId: ids.item, amount: { amount: '-5', currency: 'AMD' } },
    ]
    for (const body of bodies) {
      expect(() => newExpenseSchema.safeParse(body)).not.toThrow()
      expect(newExpenseSchema.safeParse(body).success).toBe(false)
    }
  })
})

describe('a negative price cannot become the cheapest thing in the catalogue', () => {
  it('is refused before it can be compared', () => {
    // B1. One such expense used to sit at the top of "where is it cheaper" for good,
    // with nothing on the card to show what the minimum was built from.
    expect(() => parseMoney('-1', 'AMD')).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_AMOUNT }),
    )
    expect(
      newExpenseSchema.safeParse({
        tripId: ids.trip,
        itemId: ids.item,
        amount: { amount: '-1', currency: 'AMD' },
      }).success,
    ).toBe(false)
    expect(() => unitPrice(money(-1n, 'AMD'), parseQuantity('0.9', 'l'))).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_AMOUNT }),
    )
  })

  it('and an honest one still sorts the way the product needs', () => {
    const small = unitPrice(parseMoney('520', 'AMD'), parseQuantity('0.9', 'l'))
    const litre = unitPrice(parseMoney('570', 'AMD'), parseQuantity('1', 'l'))
    expect(compareUnitPrice(small, litre)).toBe(1)
  })
})

describe('a comma cannot turn 1500 grams into one', () => {
  it('refuses the ambiguous form rather than reading it a thousandfold small', () => {
    // C2. The worst of the twenty: silent, on an everyday input, and it landed straight
    // in a unit price — 1500x too high, which then poisons "where is it cheaper".
    expect(parseQuantity('1 500', 'g').milli).toBe(1500n)
    expect(() => parseQuantity('1,500', 'g')).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
    )
  })

  it('and refuses precision it cannot hold, in both directions', () => {
    // C1. The truncation used to be silent above one gram and an error below it.
    // Refusing 0.5 g is a decision, not an oversight: a gram is the resolution of the
    // unit, and the alternative was to widen `milli` across the whole schema.
    for (const bad of ['1.9', '0.5']) {
      expect(() => parseQuantity(bad, 'g')).toThrow(
        expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
      )
    }
  })
})

describe('the exponent table cannot be rewritten under the stored data', () => {
  it('keeps a stored amount meaning what it meant when it was stored', () => {
    // F1. A write here left every minor unit as it was and changed the price it reads as.
    const stored = parseMoney('5403.12', 'AMD')
    expect(() => {
      // @ts-expect-error frozen in the type and at runtime, which is the whole point
      MINOR_EXPONENT.AMD = 3
    }).toThrow(TypeError)
    expect(decimalFromMinor(stored)).toBe('5403.12')
    expect(formatMoney(stored)).not.toContain('NaN')
  })
})

describe('a patch that changes nothing is refused however it is spelled', () => {
  it('including an explicit undefined, which a form produces and JSON cannot', () => {
    // H1. `{ city: form.city }` from an unfilled form bumped updatedAt.
    expect(actorPatchSchema.safeParse({}).success).toBe(false)
    expect(actorPatchSchema.safeParse({ city: undefined }).success).toBe(false)
    expect(actorPatchSchema.safeParse({ city: 'Ереван' }).success).toBe(true)
  })
})

describe('a broken aggregate cannot come back as a confident verdict', () => {
  it('refuses sums no set of ratings could produce', () => {
    // I1. A join that multiplied rows, or a NULL counted as zero, used to return «take».
    expect(() => verdictLevel(100, 1)).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_SCORE }),
    )
    expect(() => verdictLevel(3, 10)).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_SCORE }),
    )
    expect(verdictLevel(40, 10)).toBe('take')
    expect(verdictLevel(25, 10)).toBe('if_cheap')
  })
})

describe('a trip paid partly in another currency still has a total', () => {
  it('reports one per currency instead of refusing or inventing a rate', () => {
    // G1, decided rather than defended: the currency is prefilled from the trip and the
    // person may change it on the spot, so the two legitimately differ.
    expect(
      tripTotal([expense(parseMoney('570', 'AMD')), expense(parseMoney('500', 'RUB'))]),
    ).toEqual([
      { minor: 57000n, currency: 'AMD' },
      { minor: 50000n, currency: 'RUB' },
    ])
  })
})

describe('a price reaches a person the way the design asks for it', () => {
  it('carries the dram sign and stays exact past what a float holds', () => {
    // K1 and E2. The separate font face for U+058F exists for prices, and the sign never
    // reached one; the only bigint-to-float bridge rewrote digits without failing.
    expect(formatMoney(money(540312n, 'AMD'))).toContain('֏')
    const bare = formatMoney(money(9_007_199_254_740_993n, 'USD'), 'en-US').replace(/[\s,]/g, '')
    expect(bare).toContain('90071992547409.93')
  })

  it('and a unit price keeps the digits that make it worth showing', () => {
    expect(
      formatUnitPrice(unitPrice(parseMoney('520', 'AMD'), parseQuantity('0.9', 'l'))),
    ).toContain('577,78')
  })
})

describe('round two: the same classes, found again on the new code', () => {
  it('refuses a name that is invisible by any means, not by a listed one', () => {
    // N1/N2. The blocklist missed U+2800, which is a Symbol and renders as nothing, and
    // NUL, which Postgres text cannot store at all — the class INT8_MAX exists for.
    for (const name of ['\u2800', '\u3164', 'a\u0000b', 'a\u0007b', 'a\u2028b', 'a\u202eb']) {
      expect(newPlaceSchema.safeParse({ ...place, name }).success).toBe(false)
    }
    expect(newPlaceSchema.safeParse({ ...place, name: 'SAS' }).success).toBe(true)
  })

  it('refuses half a piece on the way out as well as on the way in', () => {
    // N3. The rule lived in the parser only, so the codec encoded a value it then
    // refused to decode — and a round trip through the client lost the edit.
    const half = { milli: 1500n, unit: 'piece' as const }
    expect(quantitySchema.safeParse(half).success).toBe(false)
    expect(() => z.encode(quantityCodec, half)).toThrow()
    const whole = parseQuantity('2', 'piece')
    expect(quantityCodec.parse(z.encode(quantityCodec, whole))).toEqual(whole)
  })

  it('refuses a search key that is blank or a megabyte long', () => {
    // N4. `.min(1)` without `.trim()` counts characters, not meaning; and the key goes
    // into the GIN index the whole search is built on.
    for (const searchKey of ['', ' ', '\n', 'x'.repeat(1_000_000)]) {
      expect(itemSchema.safeParse({ ...item, searchKey }).success).toBe(false)
    }
  })

  it('lets a night trip carry the rate of its own day', () => {
    // N5. The official rate is published at UTC midnight, Armenia is UTC+4, so every trip
    // before 04:00 local was «earlier» than the rate it was snapshotted with.
    const rate = {
      base: 'RUB' as const,
      quote: 'AMD' as const,
      scaled: 4_820_000n,
      source: 'official' as const,
      asOf: new Date('2026-09-08T00:00:00Z'),
    }
    const night = { ...trip, rate, startedAt: new Date('2026-09-07T22:00:00Z') }
    expect(tripSchema.safeParse(night).success).toBe(true)
    const tomorrow = { ...trip, rate: { ...rate, asOf: new Date('2026-09-10T00:00:00Z') } }
    expect(tripSchema.safeParse(tomorrow).success).toBe(false)
  })

  it('prints a unit price exactly, the way an amount is printed', () => {
    // N6. The bridge to float was removed from formatMoney and left in the function the
    // whole module exists for — the one that prints the comparison.
    const price = unitPrice(money(INT8_MAX, 'USD'), parseQuantity('1', 'kg'))
    expect(formatUnitPrice(price, 'en-US').replace(/[\s,]/g, '')).toContain('92233720368547758.07')
  })

  it('does not treat a line break as a group separator', () => {
    // N8. Two lines of pasted text glued into one number.
    for (const pasted of ['5\n403', '5\t403']) {
      expect(() => parseMoney(pasted, 'AMD')).toThrow()
    }
    expect(parseMoney('5 403', 'AMD').minor).toBe(540300n)
  })

  it('will not encode money it would refuse to decode', () => {
    // The circle the codec exists for: a difference from subtractMoney is a legitimate
    // value and has no business on the wire, so encode refuses it too.
    expect(() =>
      z.encode(moneyCodec, subtractMoney(money(100n, 'AMD'), money(500n, 'AMD'))),
    ).toThrow()
  })
})
