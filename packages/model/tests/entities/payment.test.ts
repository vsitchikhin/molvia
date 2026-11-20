import { describe, expect, it } from 'vitest'
import {
  PAYMENT_TARIFFS,
  TIP_CENTS,
  accessOf,
  anchorCentsOf,
  extendedUntil,
  paymentPrice,
  refundSum,
  refundedUntil,
  unlivedMs,
} from '#model/entities/payment'
import { DomainError, ERROR } from '#model/support/errors'
import { parseRate } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const drams = (rate: string): ExchangeRate => ({
  base: 'USD',
  quote: 'AMD',
  scaled: parseRate(rate),
  source: 'official',
  asOf: new Date('2026-11-20T00:00:00+04:00'),
})

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-12-01T12:00:00Z')
const days = (from: Date, count: number) => new Date(from.getTime() + count * DAY)

describe('paymentPrice — dollars into drams, up to 10 ֏ (MOL-271)', () => {
  it('rounds each tariff up at the rate of the day', () => {
    const rate = drams('383.12')
    expect(paymentPrice(PAYMENT_TARIFFS.data.cents, rate)).toEqual({
      minor: 39_000n,
      currency: 'AMD',
    })
    expect(paymentPrice(PAYMENT_TARIFFS.receipts.cents, rate)).toEqual({
      minor: 77_000n,
      currency: 'AMD',
    })
    // 2,5 × 383,12 = 957,80 → 960
    expect(paymentPrice(PAYMENT_TARIFFS.both.cents, rate)).toEqual({
      minor: 96_000n,
      currency: 'AMD',
    })
  })

  it('takes a price exactly on a step as it is, and one hundredth over it to the next step', () => {
    expect(paymentPrice(100n, drams('390')).minor).toBe(39_000n)
    expect(paymentPrice(100n, drams('390.01')).minor).toBe(40_000n)
  })

  it('carries the rate’s sixth digit into the rounding', () => {
    // 1 × 380,000001 is past 380 by a millionth of a dram — still past the step
    expect(paymentPrice(100n, drams('380.000001')).minor).toBe(39_000n)
    expect(paymentPrice(100n, drams('380.000000')).minor).toBe(38_000n)
  })

  it('prices a tip as any other amount', () => {
    expect(TIP_CENTS.map((cents) => paymentPrice(cents, drams('383.12')).minor)).toEqual([
      39_000n,
      115_000n,
      192_000n,
    ])
  })

  it('refuses a rate of another pair, the inverse one included', () => {
    expect(() => paymentPrice(100n, { ...drams('383.12'), base: 'AMD', quote: 'USD' })).toThrow(
      DomainError,
    )
    expect(() => paymentPrice(100n, { ...drams('383.12'), base: 'EUR' })).toThrow(DomainError)
  })
})

describe('anchorCentsOf — the dollar an order names', () => {
  it('is the tariff’s own', () => {
    expect(anchorCentsOf({ tariff: 'both' })).toBe(250n)
    expect(anchorCentsOf({ tariff: 'data' })).toBe(100n)
  })

  it('takes a tip only of the three amounts', () => {
    expect(anchorCentsOf({ tariff: 'tip', tipCents: 300n })).toBe(300n)
    expect(anchorCentsOf({ tariff: 'tip', tipCents: 200n })).toBeNull()
  })
})

describe('accessOf — what a tariff extends', () => {
  it('opens one column, both, or none for a tip', () => {
    expect(accessOf('data')).toEqual(['shared'])
    expect(accessOf('receipts')).toEqual(['receipts'])
    expect(accessOf('both')).toEqual(['shared', 'receipts'])
    expect(accessOf('tip')).toEqual([])
  })
})

describe('extendedUntil — thirty days from the end, or from now (MOL-271)', () => {
  it('extends a running access from its end', () => {
    const until = days(now, 2)
    expect(extendedUntil(until, now)).toEqual(days(until, 30))
  })

  it('starts from now when access is empty, over, or ends this very moment', () => {
    expect(extendedUntil(null, now)).toEqual(days(now, 30))
    expect(extendedUntil(days(now, -5), now)).toEqual(days(now, 30))
    expect(extendedUntil(now, now)).toEqual(days(now, 30))
  })

  it('extends twice for two payments in a row (owner’s В-3 «а»)', () => {
    expect(extendedUntil(extendedUntil(null, now), now)).toEqual(days(now, 60))
  })
})

describe('refundSum — refunds add up, never past the amount (MOL-281 §1)', () => {
  const paid = { state: 'paid' as const, amountMinor: 77_000n, refundedMinor: 7_000n }

  it('gives back all that is left when no sum is named, or the sum named up to it', () => {
    expect(refundSum(paid)).toBe(70_000n)
    expect(refundSum(paid, 70_000n)).toBe(70_000n)
    expect(refundSum(paid, 1n)).toBe(1n)
  })

  it('refuses past what is left, nothing, and a payment not paid — a conflict', () => {
    for (const [payment, minor] of [
      [paid, 70_001n],
      [paid, 0n],
      [paid, -1n],
      [{ ...paid, state: 'created' as const, refundedMinor: 0n }, 1_000n],
      [{ ...paid, state: 'refunded' as const, refundedMinor: 77_000n }, undefined],
    ] as const) {
      expect(() => refundSum(payment, minor)).toThrow(
        expect.objectContaining({ code: ERROR.CONFLICT }),
      )
    }
  })
})

describe('unlivedMs — what of a payment’s days is still to come', () => {
  it('is the thirty days before the end, less what is lived', () => {
    expect(unlivedMs(days(now, 30), now)).toBe(30 * DAY)
    expect(unlivedMs(days(now, 45), now)).toBe(30 * DAY)
    expect(unlivedMs(days(now, 10), now)).toBe(10 * DAY)
  })

  it('is none once lived, or for a payment that extended nothing', () => {
    expect(unlivedMs(now, now)).toBe(0)
    expect(unlivedMs(days(now, -3), now)).toBe(0)
    expect(unlivedMs(null, now)).toBe(0)
  })
})

describe('refundedUntil — a whole refund takes back the days not lived (owner’s В-2 «а»)', () => {
  it('takes the thirty days back when none is lived yet, keeping a later payment’s days', () => {
    // Paid now to day 30, another payment after it to day 60.
    expect(refundedUntil(days(now, 60), days(now, 30), now)).toEqual(days(now, 30))
  })

  it('takes back only what is left of the payment’s own days', () => {
    // Paid ten days ago to day 20: ten of its days lived, twenty taken back.
    expect(refundedUntil(days(now, 50), days(now, 20), now)).toEqual(days(now, 30))
  })

  it('takes nothing of a payment whose days are lived — a later one’s and a grant’s stay (А1)', () => {
    expect(refundedUntil(days(now, 25), days(now, -15), now)).toEqual(days(now, 25))
    expect(refundedUntil(days(now, 25), now, now)).toEqual(days(now, 25))
  })

  it('never goes earlier than now', () => {
    expect(refundedUntil(days(now, 20), days(now, 30), now)).toEqual(now)
    expect(refundedUntil(days(now, 30), days(now, 30), now)).toEqual(now)
  })

  it('leaves an access already over, never open, or a payment that extended nothing as it is', () => {
    expect(refundedUntil(null, days(now, 30), now)).toBeNull()
    const past = days(now, -3)
    expect(refundedUntil(past, days(now, 30), now)).toEqual(past)
    expect(refundedUntil(now, days(now, 30), now)).toEqual(now)
    expect(refundedUntil(days(now, 10), null, now)).toEqual(days(now, 10))
  })
})
