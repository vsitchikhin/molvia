import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR, ISSUE } from '#model/support/errors'
import {
  exchangeAmendBodySchema,
  exchangeBodySchema,
  exchangesResponseCodec,
  ratePreferenceBodySchema,
} from '#model/contracts/exchange'
import type { ExchangesResponse } from '#model/contracts/exchange'
import { money, signedMoneyCodec } from '#model/values/money'
import { yerevanMidnight } from '#model/values/rates'

const body = {
  id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  given: { amount: '20000', currency: 'RUB' },
  received: { amount: '95000', currency: 'AMD' },
  exchangedOn: '2026-09-15',
}

const issueOf = (input: unknown) => exchangeBodySchema.safeParse(input).error?.issues[0]?.message

describe('exchangeBodySchema', () => {
  it('reads an exchange as the form sends it, with or without what was held', () => {
    expect(exchangeBodySchema.parse(body).received).toEqual(money(9_500_000n, 'AMD'))
    const held = { ...body, heldBefore: { amount: '20000', currency: 'AMD' } }
    expect(exchangeBodySchema.parse(held).heldBefore).toEqual(money(2_000_000n, 'AMD'))
  })

  it('refuses nothing given or nothing received', () => {
    expect(issueOf({ ...body, given: { amount: '0', currency: 'RUB' } })).toBe(ERROR.INVALID_AMOUNT)
    expect(issueOf({ ...body, received: { amount: '-5', currency: 'AMD' } })).toBe(
      ERROR.INVALID_AMOUNT,
    )
  })

  it('refuses one currency on both sides, and a remainder in another', () => {
    expect(issueOf({ ...body, received: { amount: '5', currency: 'RUB' } })).toBe(
      ISSUE.EXCHANGE_SAME_CURRENCY,
    )
    expect(issueOf({ ...body, heldBefore: { amount: '5', currency: 'RUB' } })).toBe(
      ISSUE.EXCHANGE_HELD_NOT_RECEIVED,
    )
  })

  it('refuses amounts no rate in the band says, under «received» (А3)', () => {
    const absurd = {
      ...body,
      given: { amount: '1', currency: 'RUB' },
      received: { amount: '5000000', currency: 'AMD' },
    }
    const issue = exchangeBodySchema.safeParse(absurd).error?.issues[0]
    expect(issue?.message).toBe(ERROR.INVALID_RATE)
    expect(issue?.path).toEqual(['received'])
  })

  it('refuses an identifier the device would not recognise in the answer, and extra fields', () => {
    expect(exchangeBodySchema.safeParse({ ...body, id: body.id.toUpperCase() }).success).toBe(false)
    expect(exchangeBodySchema.safeParse({ ...body, rate: '4.75' }).success).toBe(false)
  })

  it('refuses a day that is not one', () => {
    expect(exchangeBodySchema.safeParse({ ...body, exchangedOn: '2026-09-31' }).success).toBe(false)
    expect(exchangeBodySchema.safeParse({ ...body, exchangedOn: '15.09.2026' }).success).toBe(false)
  })
})

describe('ratePreferenceBodySchema', () => {
  it('knows two preferences and nothing else', () => {
    expect(ratePreferenceBodySchema.safeParse({ preference: 'official' }).success).toBe(true)
    expect(ratePreferenceBodySchema.safeParse({ preference: 'fallback' }).success).toBe(false)
  })
})

describe('signedMoneyCodec', () => {
  it('carries a difference below zero, which a price never is', () => {
    const wire = z.encode(signedMoneyCodec, money(-500_000n, 'AMD'))
    expect(wire).toEqual({ amount: '-5000.00', currency: 'AMD' })
    expect(z.decode(signedMoneyCodec, wire)).toEqual(money(-500_000n, 'AMD'))
  })

  it('refuses what is not an amount', () => {
    expect(signedMoneyCodec.safeParse({ amount: '5,00,0', currency: 'AMD' }).success).toBe(false)
  })
})

describe('exchangeAmendBodySchema (MOL-42, В-3)', () => {
  const fields = { given: body.given, received: body.received, exchangedOn: body.exchangedOn }
  const amend = { ...fields, revision: 1 }

  it('reads the exchange whole as it should now be, with the version it was made over', () => {
    const read = exchangeAmendBodySchema.parse({ ...amend, note: '  аэропорт, по памяти ' })
    expect(read).toMatchObject({ revision: 1, note: 'аэропорт, по памяти' })
    expect(read.received).toEqual(money(9_500_000n, 'AMD'))
  })

  it('holds the rules of a new exchange, and refuses an identifier or a version below one', () => {
    const same = { ...amend, received: { amount: '5', currency: 'RUB' } }
    expect(exchangeAmendBodySchema.safeParse(same).error?.issues[0]?.message).toBe(
      ISSUE.EXCHANGE_SAME_CURRENCY,
    )
    expect(exchangeAmendBodySchema.safeParse({ ...amend, id: body.id }).success).toBe(false)
    expect(exchangeAmendBodySchema.safeParse({ ...amend, revision: 0 }).success).toBe(false)
    expect(exchangeAmendBodySchema.safeParse(fields).success).toBe(false)
  })

  it('refuses a note that draws nothing — in a new exchange too', () => {
    expect(exchangeAmendBodySchema.safeParse({ ...amend, note: '   ' }).success).toBe(false)
    expect(issueOf({ ...body, note: '\u2060' })).toBe(ISSUE.TEXT_NOT_VISIBLE)
  })
})

describe('exchangesResponseCodec', () => {
  const rate = {
    base: 'RUB' as const,
    quote: 'AMD' as const,
    scaled: 4_791_667n,
    source: 'personal' as const,
    asOf: yerevanMidnight('2026-09-15'),
  }
  const response: ExchangesResponse = {
    preference: 'personal',
    pair: { base: 'RUB', quote: 'AMD' },
    wallet: { rate, basis: 'weighted', estimated: false },
    costs: [
      {
        rate: {
          ...rate,
          base: 'USD',
          quote: 'RUB',
          scaled: 89_035_302n,
          asOf: yerevanMidnight('2026-08-31'),
        },
        basis: 'last',
        estimated: true,
      },
    ],
    heldEstimates: [{ held: money(8_500_000n, 'AMD'), whole: true }],
    baseSince: '2026-09-01',
    walletUnknown: null,
    exchanges: [
      {
        id: body.id,
        exchangedOn: '2026-09-15',
        given: money(2_000_000n, 'RUB'),
        received: money(9_500_000n, 'AMD'),
        heldBefore: money(2_000_000n, 'AMD'),
        note: 'ВТБ банкомат',
        revision: 2,
        amendedAt: new Date('2026-09-25T10:00:00.000Z'),
        history: [
          {
            given: money(2_000_000n, 'RUB'),
            received: money(9_000_000n, 'AMD'),
            exchangedOn: '2026-09-14',
            heldBefore: null,
            note: null,
            replacedAt: new Date('2026-09-25T10:00:00.000Z'),
          },
        ],
        rate: { ...rate, scaled: 4_750_000n },
        official: {
          rate: { ...rate, scaled: 4_312_300n, source: 'official' },
          provider: 'cba',
          difference: money(875_400n, 'AMD'),
        },
        officialDoubtful: false,
        priced: true,
      },
    ],
  }

  it('crosses the wire and comes back the same', () => {
    const wire = z.encode(exchangesResponseCodec, response)
    expect(wire.wallet?.rate.rate).toBe('4.791667')
    expect(z.decode(exchangesResponseCodec, wire)).toEqual(response)
  })

  it('is strict: a field the screen never reads fails rather than travelling past it', () => {
    const wire = { ...z.encode(exchangesResponseCodec, response), actorId: 'x' }
    expect(exchangesResponseCodec.safeParse(wire).success).toBe(false)
  })
})
