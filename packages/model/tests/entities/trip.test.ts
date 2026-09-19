import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '#model/support/errors'
import type { Expense } from '#model/entities/expense'
import { formatMoney, money, parseMoney } from '#model/values/money'
import { parseRate } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'
import {
  convertMoney,
  effectiveRate,
  isTripRateStale,
  manualRateFor,
  newTripSchema,
  tripSchema,
  tripTotal,
} from '#model/entities/trip'
import { formatUnitPrice, parseQuantity, unitPrice } from '#model/values/units'

const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

const rate = (value: string, source: 'personal' | 'official' = 'official'): ExchangeRate => ({
  base: 'RUB',
  quote: 'AMD',
  scaled: parseRate(value),
  source,
  asOf: new Date('2026-09-08T10:00:00Z'),
})

const trip = {
  id: 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
  actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
  placeId: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b',
  currency: 'AMD',
  rate: rate('4.82'),
  startedAt: new Date('2026-09-08T10:00:00Z'),
  finishedAt: null,
}

const expense = (amount: Expense['amount']): Expense => ({
  id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  tripId: trip.id,
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  quantity: null,
  amount,
  createdAt: new Date('2026-09-08T10:05:00Z'),
})

describe('tripSchema', () => {
  it('accepts a trip that is still going', () => {
    expect(tripSchema.parse(trip).finishedAt).toBeNull()
  })

  it('accepts a trip with no rate — nothing to convert into', () => {
    expect(() => tripSchema.parse({ ...trip, rate: null })).not.toThrow()
  })

  it('refuses a rate quoted in some other currency than the trip', () => {
    const foreign = { ...rate('90'), quote: 'USD' as const }
    expect(() => tripSchema.parse({ ...trip, rate: foreign })).toThrow()
  })

  it('refuses a trip that finishes before it starts', () => {
    expect(() =>
      tripSchema.parse({ ...trip, finishedAt: new Date('2026-09-08T09:00:00Z') }),
    ).toThrow()
    expect(() =>
      tripSchema.parse({ ...trip, finishedAt: new Date('2026-09-08T10:00:00Z') }),
    ).not.toThrow()
  })
})

describe('newTripSchema', () => {
  it('takes the place and nothing else', () => {
    expect(newTripSchema.parse({ placeId: trip.placeId })).toEqual({ placeId: trip.placeId })
  })

  it('refuses the rate: the server snapshots it, so there is no pair to get wrong', () => {
    // The "rate must be quoted in the currency of the trip" rule sat on the read schema
    // only, so a rate between any two currencies used to pass on write.
    expect(() => newTripSchema.parse({ placeId: trip.placeId, rate: rate('4.82') })).toThrow()
  })

  it('refuses the currency and the owner: the server knows both', () => {
    expect(() => newTripSchema.parse({ placeId: trip.placeId, currency: 'AMD' })).toThrow()
    expect(() => newTripSchema.parse({ placeId: trip.placeId, actorId: trip.actorId })).toThrow()
  })
})

describe('tripTotal', () => {
  // The three lines of the handoff: a litre of milk, a smaller bottle, and beef by weight.
  const milk = expense(parseMoney('570', 'AMD'))
  const small = expense(parseMoney('520', 'AMD'))
  const beef = expense(parseMoney('5403.12', 'AMD'))

  it('adds up the trip from the handoff', () => {
    const [total] = tripTotal([milk, small, beef])
    expect(total).toEqual({ minor: 649312n, currency: 'AMD' })
    expect(digits(formatMoney(total ?? money(0n, 'AMD')))).toContain('6493,12')
  })

  it('skips a line with no price instead of counting it as zero', () => {
    expect(tripTotal([milk, expense(null), small, beef])[0]?.minor).toBe(649312n)
  })

  it('gives nothing for an empty trip, because zero means something else', () => {
    expect(tripTotal([])).toEqual([])
    expect(tripTotal([expense(null)])).toEqual([])
  })

  it('splits by currency instead of refusing the whole total', () => {
    // Paying for one thing by card in roubles inside a dram shop is an ordinary
    // afternoon. Refusing to total the trip over it would break the common case in
    // order to catch nothing.
    expect(tripTotal([milk, expense(money(50000n, 'RUB')), small])).toEqual([
      { minor: 109000n, currency: 'AMD' },
      { minor: 50000n, currency: 'RUB' },
    ])
  })

  it('reads back the shelf prices the comparison is made on', () => {
    const perLitre = unitPrice(parseMoney('570', 'AMD'), parseQuantity('1', 'l'))
    const perSmall = unitPrice(parseMoney('520', 'AMD'), parseQuantity('0.9', 'l'))
    const perKilo = unitPrice(parseMoney('5403.12', 'AMD'), parseQuantity('1.128', 'kg'))
    expect(digits(formatUnitPrice(perLitre))).toContain('570,00')
    expect(digits(formatUnitPrice(perSmall))).toContain('577,78')
    expect(digits(formatUnitPrice(perKilo))).toContain('4790,00')
  })
})

describe('convertMoney', () => {
  const total = money(649312n, 'AMD')

  it('converts the trip total at the official rate', () => {
    // 6 493,12 ֏ at 4,82 ֏ per rouble is about 1 347 ₽.
    expect(digits(formatMoney(convertMoney(total, rate('4.82'))))).toContain('1347,12')
  })

  it('converts it again at the rate the money was actually changed at', () => {
    expect(digits(formatMoney(convertMoney(total, rate('4.60', 'personal'))))).toContain('1411,55')
  })

  it('rounds a half away from zero, the way a till does', () => {
    // 0,01 ֏ at exactly 2 ֏ per rouble is 0,005 ₽ — the boundary case. "Half up" would
    // name a different rule for negatives, and the next test is the one that tells them
    // apart: away from zero gives −1, up would give 0.
    expect(convertMoney(money(1n, 'AMD'), rate('2')).minor).toBe(1n)
  })

  it('and away from zero on a difference, which is the only negative money there is', () => {
    expect(convertMoney(money(-1n, 'AMD'), rate('2')).minor).toBe(-1n)
  })

  it('refuses an amount that is not in the currency the rate is quoted in', () => {
    expect(() => convertMoney(money(100n, 'RUB'), rate('4.82'))).toThrow(
      expect.objectContaining({ code: ERROR.CURRENCY_MISMATCH }),
    )
  })

  it('passes an amount through untouched at a rate of one', () => {
    // Both currencies keep two digits today, so a rate of 1 must not shift the number.
    expect(convertMoney(money(12345n, 'AMD'), rate('1')).minor).toBe(12345n)
  })
})

describe('convertMoney: a result past int8', () => {
  it('refuses rather than build a Money nothing can carry (MOL-21, adversarial А)', () => {
    // A rate at the bottom of its band multiplies: the largest amount becomes ten thousand times it.
    const tiny: ExchangeRate = { ...rate('0.0001'), quote: 'AMD' }
    expect(() => convertMoney({ minor: 9_000_000_000_000_000n, currency: 'AMD' }, tiny)).toThrow(
      ERROR.INVALID_AMOUNT,
    )
    expect(convertMoney({ minor: 100n, currency: 'AMD' }, tiny)).toEqual({
      minor: 1_000_000n,
      currency: 'RUB',
    })
  })
})

describe('скачок курса в походе (MOL-39, Р-19, Р-21)', () => {
  const jumped = { ...trip, rate: rate('482'), rateJumped: true }
  const at = new Date('2026-09-09T08:00:00Z')

  it('считает по снимку, пока человек не выбрал', () => {
    expect(effectiveRate(tripSchema.parse(jumped))?.scaled).toBe(parseRate('482'))
  })

  it('считает по прежнему или по своему, когда выбран он', () => {
    const previous = tripSchema.parse({
      ...jumped,
      previousRate: rate('4.82'),
      rateChoice: 'previous',
    })
    expect(effectiveRate(previous)?.scaled).toBe(parseRate('4.82'))

    const own = manualRateFor(jumped.rate, '4,81', at)
    expect(own).toEqual({
      base: 'RUB',
      quote: 'AMD',
      scaled: parseRate('4.81'),
      source: 'personal',
      asOf: at,
    })
    expect(
      effectiveRate(tripSchema.parse({ ...jumped, manualRate: own, rateChoice: 'manual' })),
    ).toEqual(own)
  })

  it('свой курс, который не курс, — invalid_rate, как у «моего курса»', () => {
    expect(() => manualRateFor(jumped.rate, 'abc', at)).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_RATE }),
    )
  })

  it('не принимает прежний или свой без скачка, чужую пару и выбор того, чего нет', () => {
    const own = manualRateFor(jumped.rate, '4.81', at)
    for (const bad of [
      { ...trip, previousRate: rate('4.82') },
      { ...trip, manualRate: own },
      { ...jumped, previousRate: { ...rate('4.82'), base: 'USD' } },
      { ...jumped, previousRate: rate('4.82', 'personal') },
      { ...jumped, manualRate: rate('4.81', 'official') },
      { ...jumped, rateChoice: 'previous' },
      { ...jumped, rateChoice: 'manual' },
      { ...trip, rateChoice: 'jumped' },
      { ...trip, rate: null, rateJumped: true },
    ]) {
      expect(tripSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('называет нарушение своим кодом: чужой курс рядом со снимком и выбор того, чего нет', () => {
    const codeOf = (value: unknown) => tripSchema.safeParse(value).error?.issues[0]?.message
    expect(codeOf({ ...trip, previousRate: rate('4.82') })).toBe(ISSUE.SIDE_RATE_UNMATCHED)
    expect(codeOf({ ...jumped, rateChoice: 'manual' })).toBe(ISSUE.RATE_CHOICE_NOT_HELD)
  })

  it('свой курс никогда не «устарел»; официальный старше недели на начало похода — устарел', () => {
    const own = manualRateFor(jumped.rate, '4.81', new Date('2026-08-01T00:00:00Z'))
    expect(
      isTripRateStale(tripSchema.parse({ ...jumped, manualRate: own, rateChoice: 'manual' })),
    ).toBe(false)
    const old = { ...rate('4.82'), asOf: new Date('2026-08-30T20:00:00Z') }
    expect(isTripRateStale(tripSchema.parse({ ...trip, rate: old }))).toBe(true)
    const week = { ...rate('4.82'), asOf: new Date('2026-08-31T20:00:00Z') }
    expect(isTripRateStale(tripSchema.parse({ ...trip, rate: week }))).toBe(false)
  })
})
