import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CATALOGUE_QUERY_MAX } from '#model/contracts/catalogue'
import {
  addExpenseBodySchema,
  currentTripResponseSchema,
  finishTripBodySchema,
  isDeviceDay,
  isDeviceTime,
  startTripBodySchema,
  tripReceiptBodySchema,
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
  rateProvider: null,
  rateJumped: false,
  previousRate: null,
  manualRate: null,
  rateChoice: null,
  startedAt: new Date('2026-09-19T10:00:00.000Z'),
  finishedAt: null,
  accountId: null,
  debited: null,
  receipt: null,
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
      line.unitPrice
        ? `${digits(formatUnitPrice(line.unitPrice)).replace(/[^\d,]/g, '')}/${line.unitPrice.unit}`
        : null,
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
      rateProvider: 'cba',
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
      rateProvider: 'cba',
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

  it('carries the city of its place beside the place, and reads a server before it (MOL-120)', () => {
    const wire = z.encode(tripViewCodec, view())
    expect(wire.placeCity).toBe(place.city)
    // Beside `place`, never inside: the phone's caches of the version before read `place` strictly.
    expect(Object.keys(wire.place).sort()).toEqual(['id', 'kind', 'name'])
    const before: Record<string, unknown> = { ...wire }
    delete before.placeCity
    expect(tripViewCodec.safeParse(before).success).toBe(true)
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
      rateProvider: 'cba',
    }
    // 90 000 000 000 000 000 ֏ — within int8 as money, ten thousand times past it converted.
    const huge = expense(bread, '90000000000000000', null)
    const view = tripViewOf(tiny, place, [huge], [bread])
    expect(view.total).toEqual([{ minor: 9_000_000_000_000_000_000n, currency: 'AMD' }])
    expect(view.converted).toBeNull()
  })
})

describe('a moment a phone names for itself (Б1)', () => {
  const body = (at: string) => finishTripBodySchema.safeParse({ finishedOnDeviceAt: at })

  it('refuses nothing a phone can send: the schema has no clock to judge it by', () => {
    // Both ends belong to the use case (Р-33). A refusal here would be final — the queue never
    // retries one — and a phone whose battery died calls it 1970 (В2, Г1).
    for (const at of [
      '0001-01-01T00:00:00.000Z',
      '1970-01-01T00:00:00.000Z',
      '1999-12-31T23:59:59.999Z',
      '2000-01-01T00:00:00.000Z',
      '9999-12-31T23:59:59.999Z',
    ]) {
      expect(body(at).success).toBe(true)
    }
    expect(body('не дата').success).toBe(false)
  })

  it('judges both ends by the same rule, in the one place that has a clock', () => {
    const now = new Date('2026-09-23T12:00:00.000Z')
    expect(isDeviceTime(new Date('9999-12-31T23:59:59.999Z'), now)).toBe(false)
    expect(isDeviceTime(new Date('2026-09-24T12:00:00.000Z'), now)).toBe(true)
    expect(isDeviceTime(new Date('2026-09-24T12:00:00.001Z'), now)).toBe(false)
    expect(isDeviceTime(new Date('1970-01-01T00:00:00.000Z'), now)).toBe(false)
    expect(isDeviceTime(new Date('1999-12-31T23:59:59.999Z'), now)).toBe(false)
    expect(isDeviceTime(new Date('2000-01-01T00:00:00.000Z'), now)).toBe(true)
  })

  // The day of a tap (MOL-121, adversarial rounds 2 П and 3 С): whatever a broken clock writes — 1970,
  // year 1 in five characters or four, past 9999 — the body takes it and the use case drops it.
  it('takes any day of a tap, and judges it where the clock is', () => {
    for (const finishedOn of ['1970-01-01', '0001-01-01', '1-01-01', '10000-01-01', '2026-02-31']) {
      expect(finishTripBodySchema.safeParse({ finishedOn }).success).toBe(true)
    }
    expect(finishTripBodySchema.safeParse({ finishedOn: 'x'.repeat(33) }).success).toBe(false)
    const now = new Date('2026-09-23T12:00:00.000Z')
    for (const day of [
      '1970-01-01',
      '1999-12-31',
      '1-01-01',
      '10000-01-01',
      '2026-02-31',
      'вчера',
    ]) {
      expect(isDeviceDay(day, now)).toBe(false)
    }
    expect(isDeviceDay('2000-01-01', now)).toBe(true)
    // 12:00 UTC: past midnight at UTC+14 — the 24th has come there, the 25th nowhere.
    expect(isDeviceDay('2026-09-24', now)).toBe(true)
    expect(isDeviceDay('2026-09-25', now)).toBe(false)
  })

  it('has nothing to say about a body that names no time at all', () => {
    expect(finishTripBodySchema.parse({})).toEqual({})
  })
})

describe('сумма по чеку (MOL-78)', () => {
  const items = [ashkhar, marianna, beef, bread]
  const cheque = (amount: string, currency: 'AMD' | 'USD' = 'AMD'): Trip => ({
    ...trip,
    receipt: parseMoney(amount, currency),
  })

  it('без суммы — итог по ценам, как было, и разбора нет', () => {
    const view = tripViewOf(trip, place, [...handoff(), expense(bread, null, null)], items)
    expect(view.receipt).toBeNull()
    expect(view.total).toEqual([{ minor: 649_312n, currency: 'AMD' }])
    expect(view.prices).toEqual(view.total)
    expect(view.gap).toBeNull()
  })

  it('частичные цены: итог — сумма чека, цены рядом, без цены — остаток (В-2)', () => {
    const view = tripViewOf(
      cheque('8000'),
      place,
      [...handoff(), expense(bread, null, null)],
      items,
    )
    expect(view.total).toEqual([{ minor: 800_000n, currency: 'AMD' }])
    expect(view.prices).toEqual([{ minor: 649_312n, currency: 'AMD' }])
    expect(view.gap).toEqual({ kind: 'unpriced', amount: { minor: 150_688n, currency: 'AMD' } })
  })

  it('ни одной цены: вся сумма — на покупки без цены', () => {
    const view = tripViewOf(cheque('1200'), place, [expense(bread, null, null)], items)
    expect(view.total).toEqual([{ minor: 120_000n, currency: 'AMD' }])
    expect(view.prices).toEqual([])
    expect(view.gap).toEqual({ kind: 'unpriced', amount: { minor: 120_000n, currency: 'AMD' } })
  })

  it('цены больше чека — не отказ, а «больше на …»; на копейку больше, ровно и на копейку меньше', () => {
    const rows = handoff()
    expect(tripViewOf(cheque('6493.11'), place, rows, items).gap).toEqual({
      kind: 'over',
      amount: { minor: 1n, currency: 'AMD' },
    })
    expect(tripViewOf(cheque('6493.12'), place, rows, items).gap).toBeNull()
    expect(tripViewOf(cheque('6493.13'), place, rows, items).gap).toEqual({
      kind: 'under',
      amount: { minor: 1n, currency: 'AMD' },
    })
  })

  it('сумма совпала с ценами, но у части покупок цены нет — разбора нет', () => {
    const view = tripViewOf(
      cheque('6493.12'),
      place,
      [...handoff(), expense(bread, null, null)],
      items,
    )
    expect(view.gap).toBeNull()
  })

  it('цены в другой валюте — сумма чека стоит за всеми, вычитать не из чего (В-3)', () => {
    const rows = [expense(ashkhar, '570', ['1', 'l']), expense(bread, '2', null, 'USD')]
    const view = tripViewOf(cheque('1400'), place, rows, items)
    expect(view.total).toEqual([{ minor: 140_000n, currency: 'AMD' }])
    expect(view.prices).toEqual([
      { minor: 57_000n, currency: 'AMD' },
      { minor: 200n, currency: 'USD' },
    ])
    expect(view.gap).toBeNull()
  })

  it('пересчитывает сумму чека в валюте записи по курсу снимка, в другой валюте — нет (Р-8)', () => {
    const rate = {
      base: 'RUB' as const,
      quote: 'AMD' as const,
      scaled: parseRate('4.33'),
      source: 'official' as const,
      asOf: new Date('2026-09-19T08:00:00.000Z'),
    }
    const inDrams = tripViewOf(
      { ...cheque('12400'), rate, rateProvider: 'cba' },
      place,
      handoff(),
      items,
    )
    expect(inDrams.converted).toEqual({ minor: 286_374n, currency: 'RUB' })
    const inDollars = tripViewOf(
      { ...cheque('30', 'USD'), rate, rateProvider: 'cba' },
      place,
      handoff(),
      items,
    )
    expect(inDollars.total).toEqual([{ minor: 3000n, currency: 'USD' }])
    expect(inDollars.converted).toBeNull()
  })

  it('проходит провод туда и обратно, а ответ старого сервера читается без новых полей', () => {
    const original = tripViewOf(cheque('8000'), place, handoff(), items)
    const wire = JSON.parse(JSON.stringify(z.encode(tripViewCodec, original))) as unknown
    expect(tripViewCodec.parse(wire)).toEqual(original)
    const current: Record<string, unknown> = z.encode(
      tripViewCodec,
      tripViewOf(trip, place, handoff(), items),
    )
    const older = Object.fromEntries(
      Object.entries(current).filter(([key]) => !['receipt', 'prices', 'gap'].includes(key)),
    )
    const read = tripViewCodec.parse(older)
    expect([read.receipt, read.prices, read.gap]).toEqual([null, [], null])
  })

  it('тело: сумма больше нуля или null, ничего лишнего', () => {
    expect(tripReceiptBodySchema.parse({ receipt: { amount: '0.01', currency: 'AMD' } })).toEqual({
      receipt: { minor: 1n, currency: 'AMD' },
    })
    expect(tripReceiptBodySchema.parse({ receipt: null })).toEqual({ receipt: null })
    expect(
      tripReceiptBodySchema.safeParse({ receipt: { amount: '0', currency: 'AMD' } }).success,
    ).toBe(false)
    expect(tripReceiptBodySchema.safeParse({}).success).toBe(false)
    expect(tripReceiptBodySchema.safeParse({ receipt: null, tripId: TRIP }).success).toBe(false)
  })
})
