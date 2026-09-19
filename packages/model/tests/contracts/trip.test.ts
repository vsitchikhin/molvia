import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CATALOGUE_QUERY_MAX } from '#model/contracts/catalogue'
import {
  addExpenseBodySchema,
  currentTripResponseSchema,
  startTripBodySchema,
  tripViewCodec,
  tripViewOf,
} from '#model/contracts/trip'
import type { Expense } from '#model/entities/expense'
import { itemSchema } from '#model/entities/item'
import type { Item } from '#model/entities/item'
import { placeSchema } from '#model/entities/place'
import type { Trip } from '#model/entities/trip'
import { DomainError } from '#model/support/errors'
import { parseMoney } from '#model/values/money'
import { parseRate } from '#model/values/rates'
import { formatUnitPrice, parseQuantity, unitPriceCodec } from '#model/values/units'

const CREATOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b'

const item = (id: string, name: string, unit: 'kg' | 'l' | 'piece'): Item =>
  itemSchema.parse({
    id,
    kind: 'product',
    name,
    searchKey: 'x',
    barcodes: [],
    note: null,
    defaultUnit: unit,
    typicalQuantity: null,
    createdBy: CREATOR,
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
  })

const ashkhar = item('0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c', 'Молоко «Ашхар»', 'l')
const marianna = item('1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d', 'Молоко «Марианна»', 'l')
const beef = item('2d8b4e6a-0f3c-4b5d-9e0a-7c4f3a2b5d6e', 'Говядина, вырезка', 'kg')
const bread = item('3e9c5f7b-1a4d-4c6e-8f1b-8d5a4b3c6e7f', 'Хлеб', 'piece')

const place = placeSchema.parse({
  id: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b',
  kind: 'store',
  name: 'Ереван Сити',
  country: 'AM',
  city: 'Gyumri',
  createdAt: new Date('2026-09-18T09:00:00.000Z'),
})

const trip: Trip = {
  id: TRIP,
  actorId: CREATOR,
  placeId: place.id,
  currency: 'AMD',
  rate: null,
  startedAt: new Date('2026-09-19T10:00:00.000Z'),
  finishedAt: null,
}

let row = 0
const expense = (
  of: Item,
  amount: string | null,
  quantity: [string, 'kg' | 'l' | 'piece'] | null,
  currency: 'AMD' | 'USD' = 'AMD',
): Expense => {
  row += 1
  return {
    id: `aa11bb22-cc33-4d44-8e55-${String(row).padStart(12, '0')}`,
    tripId: TRIP,
    itemId: of.id,
    quantity: quantity ? parseQuantity(quantity[0], quantity[1]) : null,
    amount: amount === null ? null : parseMoney(amount, currency),
    createdAt: new Date(`2026-09-19T10:0${String(row % 10)}:00.000Z`),
  }
}

// The handoff's fixtures: on the shelf 520 is cheaper than 570, per litre it is the other way.
const handoff = (): Expense[] => [
  expense(ashkhar, '570', ['1', 'l']),
  expense(marianna, '520', ['0.9', 'l']),
  expense(beef, '5403.12', ['1.128', 'kg']),
]

const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

describe('tripViewOf', () => {
  const items = [ashkhar, marianna, beef, bread]

  it('prices every row per unit, and 520 for 0,9 l comes out dearer than 570 for a litre', () => {
    const view = tripViewOf(trip, place, handoff(), items)
    const shown = view.expenses.map((line) =>
      line.unitPrice ? digits(formatUnitPrice(line.unitPrice)).replace(/[^\d,/a-z]/g, '') : null,
    )

    // Only the figures and the unit: the symbol is Intl's to choose, and `formatUnitPrice` has
    // its own tests.
    expect(shown).toEqual(['570,00/l', '577,78/l', '4790,00/kg'])
  })

  it('totals the trip, 6 493,12 ֏', () => {
    const view = tripViewOf(trip, place, handoff(), items)
    expect(view.total).toEqual([{ minor: 649_312n, currency: 'AMD' }])
  })

  it('NULL: a row with neither price nor quantity is listed and left out of the total', () => {
    const view = tripViewOf(trip, place, [...handoff(), expense(bread, null, null)], items)

    expect(view.expenses).toHaveLength(4)
    expect(view.expenses[3]?.unitPrice).toBeNull()
    expect(view.total).toEqual([{ minor: 649_312n, currency: 'AMD' }])
  })

  it('NULL: a price without a quantity, or a quantity without a price, has no unit price', () => {
    const view = tripViewOf(
      trip,
      place,
      [expense(bread, '250', null), expense(bread, null, ['1', 'piece'])],
      items,
    )
    expect(view.expenses.map((line) => line.unitPrice)).toEqual([null, null])
    expect(view.total).toEqual([{ minor: 25_000n, currency: 'AMD' }])
  })

  it('NULL: a trip with nothing in it has an empty total, not a zero', () => {
    expect(tripViewOf(trip, place, [], items).total).toEqual([])
  })

  it('boundary: a free item is priced at zero per unit, not left unpriced', () => {
    const view = tripViewOf(trip, place, [expense(bread, '0', ['1', 'piece'])], items)
    expect(view.expenses[0]?.unitPrice).toEqual({ scaledMinor: 0n, currency: 'AMD', unit: 'piece' })
  })

  it('a card paid in dollars on a dram trip is a second total, not an error', () => {
    const view = tripViewOf(
      trip,
      place,
      [...handoff(), expense(bread, '2', ['1', 'piece'], 'USD')],
      items,
    )
    expect(view.total).toEqual([
      { minor: 649_312n, currency: 'AMD' },
      { minor: 200n, currency: 'USD' },
    ])
  })

  it('the same item twice in one trip is two rows', () => {
    const view = tripViewOf(
      trip,
      place,
      [expense(ashkhar, '570', ['1', 'l']), expense(ashkhar, '570', ['1', 'l'])],
      items,
    )
    expect(view.expenses).toHaveLength(2)
  })

  it('converts nothing without a rate — every trip until MOL-39/40', () => {
    expect(tripViewOf(trip, place, handoff(), items).converted).toBeNull()
  })

  it('converts only the total in the trip currency, by the rate the trip snapshotted', () => {
    const withRate: Trip = {
      ...trip,
      rate: {
        base: 'RUB',
        quote: 'AMD',
        scaled: parseRate('4.82'),
        source: 'official',
        asOf: new Date('2026-09-19T08:00:00.000Z'),
      },
    }
    const view = tripViewOf(
      withRate,
      place,
      [...handoff(), expense(bread, '2', ['1', 'piece'], 'USD')],
      items,
    )
    // 6 493,12 / 4,82 = 1 347,12 ₽ — the dollars are not part of it.
    expect(view.converted).toEqual({ minor: 134_712n, currency: 'RUB' })
  })

  it('has no conversion when nothing is priced in the trip currency', () => {
    const withRate: Trip = {
      ...trip,
      rate: {
        base: 'RUB',
        quote: 'AMD',
        scaled: parseRate('4.82'),
        source: 'official',
        asOf: new Date('2026-09-19T08:00:00.000Z'),
      },
    }
    expect(
      tripViewOf(withRate, place, [expense(bread, '2', null, 'USD')], items).converted,
    ).toBeNull()
  })

  it('refuses a row whose item was not read — a defect, not a state, so not a DomainError', () => {
    // A DomainError would reach the client as 404 «not found»; a broken server must be a 500.
    expect(() => tripViewOf(trip, place, handoff(), [ashkhar])).toThrow(/was not read/)
    expect(() => tripViewOf(trip, place, handoff(), [ashkhar])).not.toThrow(DomainError)
  })
})

describe('tripViewCodec', () => {
  const view = () =>
    tripViewOf(
      trip,
      place,
      [...handoff(), expense(bread, null, null)],
      [ashkhar, marianna, beef, bread],
    )

  it('survives JSON both ways', () => {
    const original = view()
    const wire = JSON.parse(JSON.stringify(z.encode(tripViewCodec, original))) as unknown
    expect(tripViewCodec.parse(wire)).toEqual(original)
  })

  it('carries the unit price with every digit the ratio holds', () => {
    const wire = z.encode(tripViewCodec, view())
    expect(wire.expenses[1]?.unitPrice).toEqual({
      amount: '577.77777778',
      currency: 'AMD',
      unit: 'l',
    })
  })

  it('never carries the identity of whoever added an item', () => {
    const wire = JSON.stringify(z.encode(tripViewCodec, view()))
    expect(wire).not.toContain(CREATOR)
    expect(wire).not.toContain('createdBy')
    expect(wire).not.toContain('actorId')
  })

  it('refuses a reply that grew a field, at any depth', () => {
    const wire = z.encode(tripViewCodec, view())
    expect(tripViewCodec.safeParse({ ...wire, actorId: CREATOR }).success).toBe(false)
    expect(
      tripViewCodec.safeParse({ ...wire, place: { ...wire.place, country: 'AM' } }).success,
    ).toBe(false)
  })

  it('«no trip» is a trip of null, not a missing field', () => {
    expect(currentTripResponseSchema.parse({ trip: null })).toEqual({ trip: null })
    expect(currentTripResponseSchema.safeParse({}).success).toBe(false)
  })
})

describe('unitPriceCodec', () => {
  it('refuses a price that is not a number, rather than reading it as zero', () => {
    expect(unitPriceCodec.safeParse({ amount: 'дёшево', currency: 'AMD', unit: 'l' }).success).toBe(
      false,
    )
    expect(unitPriceCodec.safeParse({ amount: '-1', currency: 'AMD', unit: 'l' }).success).toBe(
      false,
    )
  })
})

describe('startTripBodySchema', () => {
  const body = { id: TRIP, place: { kind: 'store', name: 'Ереван Сити' } }

  it('takes an identifier and a store by name', () => {
    expect(startTripBodySchema.parse(body)).toEqual(body)
  })

  it('refuses a venue until 0.3', () => {
    expect(
      startTripBodySchema.safeParse({ ...body, place: { kind: 'venue', name: 'Кафе' } }).success,
    ).toBe(false)
  })

  it('refuses a trip with no identifier, or one that is not a uuid', () => {
    expect(startTripBodySchema.safeParse({ place: body.place }).success).toBe(false)
    expect(startTripBodySchema.safeParse({ ...body, id: 'trip-1' }).success).toBe(false)
  })

  it('refuses what the server decides: the country, the currency, the owner', () => {
    expect(
      startTripBodySchema.safeParse({ ...body, place: { ...body.place, country: 'AM' } }).success,
    ).toBe(false)
    expect(startTripBodySchema.safeParse({ ...body, currency: 'AMD' }).success).toBe(false)
    expect(startTripBodySchema.safeParse({ ...body, actorId: CREATOR }).success).toBe(false)
  })

  it('refuses a name with nothing visible in it', () => {
    expect(
      startTripBodySchema.safeParse({ ...body, place: { kind: 'store', name: ' \u200b ' } })
        .success,
    ).toBe(false)
  })
})

describe('addExpenseBodySchema', () => {
  const body = { id: 'aa11bb22-cc33-4d44-8e55-ff6677889900', itemId: ashkhar.id }

  it('takes the item alone — everything else can come later', () => {
    expect(addExpenseBodySchema.parse(body)).toEqual(body)
  })

  it('takes the price and the quantity off the wire as decimal strings', () => {
    const parsed = addExpenseBodySchema.parse({
      ...body,
      quantity: { value: '0.9', unit: 'l' },
      amount: { amount: '520', currency: 'AMD' },
    })
    expect(parsed.quantity).toEqual({ milli: 900n, unit: 'l' })
    expect(parsed.amount).toEqual({ minor: 52_000n, currency: 'AMD' })
  })

  it('refuses the trip in the body — it is in the path, and one of the two would be ignored', () => {
    expect(addExpenseBodySchema.safeParse({ ...body, tripId: TRIP }).success).toBe(false)
  })

  it('boundary: a query of the longest searchable length passes, one more does not', () => {
    const at = 'м'.repeat(CATALOGUE_QUERY_MAX)
    expect(addExpenseBodySchema.safeParse({ ...body, query: at }).success).toBe(true)
    expect(addExpenseBodySchema.safeParse({ ...body, query: `${at}м` }).success).toBe(false)
  })

  it('boundary: a price of zero passes, a negative one and a quantity of zero do not', () => {
    expect(
      addExpenseBodySchema.safeParse({ ...body, amount: { amount: '0', currency: 'AMD' } }).success,
    ).toBe(true)
    expect(
      addExpenseBodySchema.safeParse({ ...body, amount: { amount: '-1', currency: 'AMD' } })
        .success,
    ).toBe(false)
    expect(
      addExpenseBodySchema.safeParse({ ...body, quantity: { value: '0', unit: 'kg' } }).success,
    ).toBe(false)
  })
})

describe('adversarial А: a unit price past int8', () => {
  it('crosses the wire and back whole — it is a ratio, never stored', () => {
    // 92 233 720,37 ֏ for one gram: each field legal, the price per kilo past int8.
    const price = {
      scaledMinor: 9_223_372_037_000_000_000n,
      currency: 'AMD' as const,
      unit: 'kg' as const,
    }
    const wire = JSON.parse(JSON.stringify(z.encode(unitPriceCodec, price))) as unknown
    expect(unitPriceCodec.parse(wire)).toEqual(price)
  })
})

describe('the device names rows in lower case (adversarial round 2, В)', () => {
  const upper = 'AA11BB22-CC33-4D44-8E55-FF6677889900'

  it('refuses an upper-case identifier in either body', () => {
    expect(
      startTripBodySchema.safeParse({ id: upper, place: { kind: 'store', name: 'SAS' } }).success,
    ).toBe(false)
    expect(addExpenseBodySchema.safeParse({ id: upper, itemId: ashkhar.id }).success).toBe(false)
    expect(
      addExpenseBodySchema.safeParse({ id: upper.toLowerCase(), itemId: ashkhar.id }).success,
    ).toBe(true)
  })
})

describe('С-11: an estimate that does not fit is none, not a refusal', () => {
  it('converted is null when the total, converted, is past int8', () => {
    const tiny: Trip = {
      ...trip,
      rate: {
        base: 'RUB',
        quote: 'AMD',
        scaled: parseRate('0.0001'),
        source: 'official',
        asOf: new Date('2026-09-19T08:00:00.000Z'),
      },
    }
    // 90 000 000 000 000 000 ֏ — within int8 as money, ten thousand times past it converted.
    const huge = expense(bread, '90000000000000000', null)
    const view = tripViewOf(tiny, place, [huge], [bread])
    expect(view.total).toEqual([{ minor: 9_000_000_000_000_000_000n, currency: 'AMD' }])
    expect(view.converted).toBeNull()
  })
})
