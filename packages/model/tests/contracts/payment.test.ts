import { describe, expect, it } from 'vitest'
import {
  paymentOfferCodec,
  paymentStartedSchema,
  paymentStatusCodec,
  startPaymentSchema,
} from '#model/contracts/payment'

const until = new Date('2026-12-31T12:00:00.000Z')

describe('the wire of payment by card (MOL-277)', () => {
  it('takes a tariff with the price shown, in the page’s language, or a tip of its three sums — nothing else', () => {
    const amount = { amount: '960', currency: 'AMD' }
    expect(startPaymentSchema.parse({ tariff: 'both', amount, lang: 'en' })).toEqual({
      tariff: 'both',
      amount: { minor: 96_000n, currency: 'AMD' },
      lang: 'en',
    })
    expect(
      startPaymentSchema.parse({ tariff: 'tip', tipCents: 500, amount, lang: 'ru' }),
    ).toMatchObject({ tipCents: 500 })
    for (const body of [
      { tariff: 'tip', tipCents: 200, amount, lang: 'ru' },
      { tariff: 'tip', tipCents: 1.5, amount, lang: 'ru' },
      { tariff: 'data', tipCents: 100, amount, lang: 'ru' },
      { tariff: 'data', amount, lang: 'hy' },
      // the price the screen showed is required (adversarial А4)
      { tariff: 'data', lang: 'ru' },
    ]) {
      expect(startPaymentSchema.safeParse(body).success).toBe(false)
    }
  })

  it('hands back an http(s) page only', () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    expect(paymentStartedSchema.safeParse({ id, url: 'https://bank.am/Pay?id=1' }).success).toBe(
      true,
    )
    expect(paymentStartedSchema.safeParse({ id, url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('carries the offer and a status as money and moments, the same both ways', () => {
    const offer = {
      access: { shared: null, receipts: until },
      tariffs: [
        {
          tariff: 'receipts' as const,
          cents: 200,
          amount: { minor: 77_000n, currency: 'AMD' as const },
          after: { shared: null, receipts: new Date('2027-01-30T12:00:00.000Z') },
        },
      ],
      tips: [{ cents: 100, amount: { minor: 39_000n, currency: 'AMD' as const } }],
    }
    const wire = paymentOfferCodec.encode(offer)
    expect(wire.access).toEqual({ shared: null, receipts: '2026-12-31T12:00:00.000Z' })
    expect(wire.tariffs?.[0]?.amount).toEqual({ amount: '770.00', currency: 'AMD' })
    expect(paymentOfferCodec.decode(wire)).toEqual(offer)
    expect(paymentOfferCodec.decode({ ...wire, tariffs: null, tips: null })).toMatchObject({
      tariffs: null,
      tips: null,
    })

    const status = {
      state: 'paid' as const,
      tariff: 'receipts' as const,
      amount: { minor: 77_000n, currency: 'AMD' as const },
      access: { shared: null, receipts: until },
    }
    expect(paymentStatusCodec.decode(paymentStatusCodec.encode(status))).toEqual(status)
  })
})
