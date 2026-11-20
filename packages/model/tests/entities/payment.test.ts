import { describe, expect, it } from 'vitest'
import {
  PAYMENT_TARIFFS,
  TIP_CENTS,
  accessOf,
  anchorCentsOf,
  extendedUntil,
  paymentPrice,
  refundedUntil,
} from '#model/entities/payment'
import { DomainError } from '#model/support/errors'
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

describe('anchorCentsOf — the dollar a payment names', () => {
  it('is the tariff’s own, whatever tip is named beside it', () => {
    expect(anchorCentsOf('both')).toBe(250n)
    expect(anchorCentsOf('data', 500n)).toBe(100n)
  })

  it('takes a tip only of the three amounts', () => {
    expect(anchorCentsOf('tip', 300n)).toBe(300n)
    expect(anchorCentsOf('tip', 200n)).toBeNull()
    expect(anchorCentsOf('tip')).toBeNull()
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

describe('refundedUntil — a whole refund takes the thirty days back (owner’s В-2 «а»)', () => {
  it('takes thirty days off, keeping a later payment’s days', () => {
    expect(refundedUntil(days(now, 60), now)).toEqual(days(now, 30))
  })

  it('never goes earlier than now', () => {
    expect(refundedUntil(days(now, 20), now)).toEqual(now)
    expect(refundedUntil(days(now, 30), now)).toEqual(now)
  })

  it('leaves an access already over, or never open, as it is', () => {
    expect(refundedUntil(null, now)).toBeNull()
    const past = days(now, -3)
    expect(refundedUntil(past, now)).toEqual(past)
    expect(refundedUntil(now, now)).toEqual(now)
  })
})
