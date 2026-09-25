import { describe, expect, it } from 'vitest'
import { INT8_MAX } from '#model/support/decimal'
import { ERROR, ISSUE } from '#model/support/errors'
import {
  currencyCosts,
  exchangeRateOf,
  exchangeSchema,
  heldEstimate,
  isPlausibleExchange,
  lastReceipt,
  officialDifference,
  walletRate,
} from '#model/entities/exchange'
import type { Exchange, OfficialRateOf } from '#model/entities/exchange'
import { convertMoney } from '#model/entities/trip'
import { formatEstimate, money } from '#model/values/money'
import type { Currency } from '#model/values/money'
import { RATE_MAX, parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

let sequence = 0

/** An exchange in major units: `exchange('20000 RUB', '224.63 USD', '2026-09-01')`. */
function exchange(
  given: string,
  received: string,
  exchangedOn: string,
  heldBefore: string | null = null,
): Exchange {
  const toMoney = (text: string) => {
    const [amount = '', currency = ''] = text.split(' ')
    const [whole = '', cents = ''] = amount.split('.')
    return money(BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0')), currency as Currency)
  }
  sequence += 1
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
    given: toMoney(given),
    received: toMoney(received),
    exchangedOn,
    heldBefore: heldBefore === null ? null : toMoney(heldBefore),
    note: null,
    revision: 1,
    createdAt: new Date(`${exchangedOn}T12:00:00Z`),
    amendedAt: null,
  }
}

// The owner's example from the product plan (decisions of MOL-41, 22.09.2026).
const first = exchange('20000 RUB', '100000 AMD', '2026-09-01')
const second = exchange('20000 RUB', '95000 AMD', '2026-09-15', '20000 AMD')

describe('exchangeSchema', () => {
  it('holds an exchange as the person enters it', () => {
    expect(exchangeSchema.safeParse(second).success).toBe(true)
  })

  it('refuses one currency on both sides — nothing was exchanged', () => {
    const same = { ...first, received: money(100n, 'RUB') }
    expect(exchangeSchema.safeParse(same).error?.issues[0]?.message).toBe(
      ISSUE.EXCHANGE_SAME_CURRENCY,
    )
  })

  it('refuses a zero on either side, and what was held in any currency but the received one', () => {
    expect(
      exchangeSchema.safeParse({ ...first, given: money(0n, 'RUB') }).error?.issues[0]?.message,
    ).toBe(ERROR.INVALID_AMOUNT)
    const held = { ...second, heldBefore: money(100n, 'RUB') }
    expect(exchangeSchema.safeParse(held).error?.issues[0]?.message).toBe(
      ISSUE.EXCHANGE_HELD_NOT_RECEIVED,
    )
  })

  it('takes nothing held as an answer, not as a missing one', () => {
    expect(exchangeSchema.safeParse({ ...second, heldBefore: money(0n, 'AMD') }).success).toBe(true)
  })

  it('refuses a day that is not one', () => {
    expect(exchangeSchema.safeParse({ ...first, exchangedOn: '2026-02-31' }).success).toBe(false)
  })

  it('keeps a note of one visible line, and refuses one that draws nothing (MOL-42, В-4)', () => {
    expect(exchangeSchema.safeParse({ ...first, note: 'ВТБ банкомат (озон)' }).success).toBe(true)
    expect(exchangeSchema.safeParse({ ...first, note: '\u200b' }).error?.issues[0]?.message).toBe(
      ISSUE.TEXT_NOT_VISIBLE,
    )
    expect(exchangeSchema.safeParse({ ...first, note: 'x'.repeat(201) }).success).toBe(false)
  })
})

describe('walletRate', () => {
  it('is the rate of the first exchange, and says it was taken from one exchange', () => {
    const wallet = walletRate([first], 'RUB', 'AMD', '2026-09-01')
    expect(wallet?.rate.scaled).toBe(parseRate('5'))
    expect(wallet?.basis).toBe('last')
    expect(wallet?.rate).toMatchObject({ base: 'RUB', quote: 'AMD', source: 'personal' })
    expect(wallet?.rate.asOf).toEqual(yerevanMidnight('2026-09-01'))
  })

  it('weighs what was left: the owner’s 115 000 ֏ for 24 000 ₽, and 1 000 ֏ ≈ 209 ₽', () => {
    const wallet = walletRate([first, second], 'RUB', 'AMD', '2026-09-30')
    // 115000 / 24000 = 4.791666…, rounded once, at the end.
    expect(wallet?.rate.scaled).toBe(4_791_667n)
    expect(wallet?.basis).toBe('weighted')
    expect(wallet?.rate.asOf).toEqual(yerevanMidnight('2026-09-15'))

    if (!wallet) throw new Error('the wallet has a rate')
    const purchase = convertMoney(money(100_000n, 'AMD'), wallet.rate)
    expect(purchase).toEqual(money(20_870n, 'RUB'))
    expect(digits(formatEstimate(purchase))).toBe('209₽')
  })

  it('is neither the last exchange nor the average of every exchange ever made', () => {
    const scaled = walletRate([first, second], 'RUB', 'AMD', '2026-09-30')?.rate.scaled
    expect(scaled).not.toBe(parseRate('4.75'))
    // 195000 / 40000 — also the mean of 5 and 4.75: as if nothing had been spent in between.
    expect(scaled).not.toBe(parseRate('4.875'))
  })

  it('without what was held, takes the last exchange and says so', () => {
    const unknown = exchange('20000 RUB', '95000 AMD', '2026-09-15')
    const wallet = walletRate([first, unknown], 'RUB', 'AMD', '2026-09-30')
    expect(wallet?.rate.scaled).toBe(parseRate('4.75'))
    expect(wallet?.basis).toBe('last')
  })

  it('with nothing held, weighs by nothing — the new rate, but a weighted one', () => {
    const empty = exchange('20000 RUB', '95000 AMD', '2026-09-15', '0 AMD')
    const wallet = walletRate([first, empty], 'RUB', 'AMD', '2026-09-30')
    expect(wallet?.rate.scaled).toBe(parseRate('4.75'))
    expect(wallet?.basis).toBe('weighted')
  })

  it('ignores what was held before the very first exchange: that money has no known cost', () => {
    const opening = exchange('20000 RUB', '100000 AMD', '2026-09-01', '50000 AMD')
    const wallet = walletRate([opening], 'RUB', 'AMD', '2026-09-30')
    expect(wallet?.rate.scaled).toBe(parseRate('5'))
    expect(wallet?.basis).toBe('last')
  })

  it('carries no rounding from one link of a chain to the next', () => {
    const third = exchange('10000 RUB', '47000 AMD', '2026-09-20', '30000 AMD')
    // Exactly 161/34 = 4.735294117…
    expect(walletRate([first, second, third], 'RUB', 'AMD', '2026-09-30')?.rate.scaled).toBe(
      4_735_294n,
    )
  })

  it('orders by the day of the exchange, not by the order it was written in', () => {
    const late = walletRate([second, first], 'RUB', 'AMD', '2026-09-30')
    expect(late?.rate.scaled).toBe(4_791_667n)
  })

  it('counts an exchange on the day itself and not one on the day after', () => {
    expect(walletRate([first, second], 'RUB', 'AMD', '2026-09-15')?.rate.scaled).toBe(4_791_667n)
    expect(walletRate([first, second], 'RUB', 'AMD', '2026-09-14')?.rate.scaled).toBe(
      parseRate('5'),
    )
    expect(walletRate([first], 'RUB', 'AMD', '2026-08-31')).toBeNull()
  })

  it('is not moved by an exchange back into the currency of conversion', () => {
    const back = exchange('10000 AMD', '2250 RUB', '2026-09-20')
    const wallet = walletRate([first, second, back], 'RUB', 'AMD', '2026-09-30')
    expect(wallet).toMatchObject({ basis: 'weighted', estimated: false })
    expect(wallet?.rate.scaled).toBe(4_791_667n)
    expect(wallet?.rate.asOf).toEqual(yerevanMidnight('2026-09-15'))
  })

  it('is none without an exchange of the pair', () => {
    expect(walletRate([], 'RUB', 'AMD', '2026-09-30')).toBeNull()
    expect(walletRate([first], 'USD', 'AMD', '2026-09-30')).toBeNull()
  })

  it('is none when the rate falls outside the band a snapshot accepts', () => {
    const absurd: Exchange = {
      ...first,
      given: money(1n, 'RUB'),
      received: money((RATE_MAX / 1_000_000n) * 1000n, 'AMD'),
    }
    expect(walletRate([absurd], 'RUB', 'AMD', '2026-09-30')).toBeNull()
  })
})

/** The official rate of RUB into `currency`, as the use case would hand it in. */
function officialFrom(table: Partial<Record<Currency, string>>): OfficialRateOf {
  return (currency, day) => {
    const value = table[currency]
    return value === undefined
      ? null
      : {
          base: 'RUB',
          quote: currency,
          scaled: parseRate(value),
          source: 'official',
          asOf: yerevanMidnight(day),
        }
  }
}

// The owner's own journal (sheet «Обмен валюты»): roubles to a card in dollars, dollars to drams.
const dollars = exchange('20000 RUB', '224.63 USD', '2026-08-31')
const drams = exchange('100 USD', '36150 AMD', '2026-09-13')

describe('walletRate through other currencies (MOL-42)', () => {
  it('carries the price of the dollars into the drams bought with them', () => {
    // 100 $ cost 100 × 20000 / 224.63 = 8 903.53 ₽, so 36 150 ֏ at 4.06018725.
    const wallet = walletRate([dollars, drams], 'RUB', 'AMD', '2026-09-30')
    expect(wallet).toMatchObject({ basis: 'last', estimated: false })
    expect(wallet?.rate.scaled).toBe(4_060_187n)
    expect(wallet?.rate.asOf).toEqual(yerevanMidnight('2026-09-13'))
  })

  it('weighs what was held by its own cost, whichever currency bought it', () => {
    const before = exchange('7654.42 RUB', '30000 AMD', '2026-09-05')
    const weighed = exchange('100 USD', '36150 AMD', '2026-09-13', '20000 AMD')
    const wallet = walletRate([dollars, before, weighed], 'RUB', 'AMD', '2026-09-30')
    expect(wallet?.basis).toBe('weighted')
    expect(wallet?.rate.scaled).toBe(4_008_860n)
  })

  it('comes to the same rate by a chain as by the pair, when the sums say the same', () => {
    const direct = walletRate([first], 'RUB', 'AMD', '2026-09-30')
    const chain = walletRate(
      [
        exchange('20000 RUB', '250 USD', '2026-09-01'),
        exchange('250 USD', '100000 AMD', '2026-09-01'),
      ],
      'RUB',
      'AMD',
      '2026-09-30',
    )
    expect(chain?.rate.scaled).toBe(direct?.rate.scaled)
  })

  it('does not re-price drams already bought when the dollars later get dearer', () => {
    const dearer = exchange('20000 RUB', '200 USD', '2026-09-20')
    const wallet = walletRate([dollars, drams, dearer], 'RUB', 'AMD', '2026-09-30')
    expect(wallet?.rate.scaled).toBe(4_060_187n)
  })

  it('values money of no known cost at the official rate of the day, and says so (В-1)', () => {
    // 600 $ brought from home: 600 / 0.011111 = 54 000.54 ₽ for 217 200 ֏.
    const airport = exchange('600 USD', '217200 AMD', '2026-08-25')
    const wallet = walletRate(
      [airport],
      'RUB',
      'AMD',
      '2026-09-30',
      officialFrom({ USD: '0.011111' }),
    )
    expect(wallet).toMatchObject({ basis: 'last', estimated: true })
    expect(wallet?.rate.scaled).toBe(4_022_182n)
  })

  it('keeps the estimate in a weighted cost, and drops it once a link starts afresh', () => {
    const airport = exchange('600 USD', '217200 AMD', '2026-08-25')
    const official = officialFrom({ USD: '0.011111' })
    const weighed = exchange('20000 RUB', '95000 AMD', '2026-09-15', '100000 AMD')
    expect(walletRate([airport, weighed], 'RUB', 'AMD', '2026-09-30', official)).toMatchObject({
      basis: 'weighted',
      estimated: true,
    })
    expect(walletRate([airport, weighed], 'RUB', 'AMD', '2026-09-30', official)?.rate.scaled).toBe(
      4_346_651n,
    )
    const fresh = exchange('20000 RUB', '95000 AMD', '2026-09-15')
    expect(walletRate([airport, fresh], 'RUB', 'AMD', '2026-09-30', official)).toMatchObject({
      basis: 'last',
      estimated: false,
    })
  })

  it('without an official rate either, knows no cost until an exchange starts one afresh', () => {
    const airport = exchange('600 USD', '217200 AMD', '2026-09-05')
    expect(walletRate([first], 'RUB', 'AMD', '2026-09-10')?.rate.scaled).toBe(parseRate('5'))
    expect(walletRate([first, airport], 'RUB', 'AMD', '2026-09-10')).toBeNull()
    // What was held has no known cost to weigh by: the next exchange is taken alone.
    const next = exchange('20000 RUB', '95000 AMD', '2026-09-15', '100000 AMD')
    expect(walletRate([first, airport, next], 'RUB', 'AMD', '2026-09-30')).toMatchObject({
      basis: 'last',
      estimated: false,
    })
  })

  it('ignores an official rate of any other pair', () => {
    const airport = exchange('600 USD', '217200 AMD', '2026-08-25')
    const foreign: OfficialRateOf = (currency, day) => ({
      base: 'EUR',
      quote: currency,
      scaled: parseRate('1.08'),
      source: 'official',
      asOf: yerevanMidnight(day),
    })
    expect(walletRate([airport], 'RUB', 'AMD', '2026-09-30', foreign)).toBeNull()
  })

  it('counts from the day the currency of conversion changed, and not a day before (В-2)', () => {
    const since = '2026-09-15'
    // The rouble exchange of the 1st belongs to the old base and is not re-counted.
    expect(walletRate([first], 'RUB', 'AMD', '2026-09-30', undefined, since)).toBeNull()
    // The one of the day itself counts, and its remainder has no cost to weigh by.
    expect(walletRate([first, second], 'RUB', 'AMD', '2026-09-30', undefined, since)).toMatchObject(
      { basis: 'last', rate: { scaled: parseRate('4.75') } },
    )
    expect(walletRate([first, second], 'RUB', 'AMD', '2026-09-30', undefined, null)?.basis).toBe(
      'weighted',
    )
  })

  it('works in any currency of conversion, through any currency', () => {
    const euros = exchange('1000 EUR', '1080 USD', '2026-09-01')
    const spent = exchange('500 USD', '190000 AMD', '2026-09-02')
    // 380 ֏ per $ at 1.08 $ per € — 410.4 ֏ per €.
    expect(walletRate([euros, spent], 'EUR', 'AMD', '2026-09-30')?.rate.scaled).toBe(410_400_000n)
    expect(walletRate([spent], 'USD', 'AMD', '2026-09-30')?.rate.scaled).toBe(parseRate('380'))
    expect(walletRate([spent], 'AMD', 'AMD', '2026-09-30')).toBeNull()
  })
})

describe('currencyCosts', () => {
  it('lists what every currency held by exchange cost, and never the base itself', () => {
    const back = exchange('50 USD', '4500 RUB', '2026-09-14')
    const costs = currencyCosts([dollars, drams, back], 'RUB', '2026-09-30')
    expect(costs.map(({ rate }) => rate.base).sort()).toEqual(['AMD', 'USD'])
    // The price of one dollar in roubles, 20000 / 224.63 — and handing dollars over, for drams or
    // back for roubles, leaves it where it was.
    expect(costs.find(({ rate }) => rate.base === 'USD')?.rate).toMatchObject({
      quote: 'RUB',
      scaled: 89_035_302n,
      source: 'personal',
    })
  })
})

describe('exchangeRateOf', () => {
  it('is what one exchange was made at, in the direction it was made', () => {
    expect(exchangeRateOf(second)?.scaled).toBe(parseRate('4.75'))
    const back = exchange('10000 AMD', '2000 RUB', '2026-09-12')
    expect(exchangeRateOf(back)).toMatchObject({
      base: 'AMD',
      quote: 'RUB',
      scaled: parseRate('0.2'),
    })
  })
})

describe('officialDifference', () => {
  const official = (value: string, base: Currency = 'RUB'): ExchangeRate => ({
    base,
    quote: 'AMD',
    scaled: parseRate(value),
    source: 'official',
    asOf: yerevanMidnight('2026-09-15'),
  })

  it('is what the exchange gave beyond the bank, in the received currency', () => {
    // The bank would have given 20 000 × 4.3123 = 86 246 ֏; the exchanger gave 95 000.
    expect(officialDifference(second, official('4.3123'))).toEqual(money(875_400n, 'AMD'))
  })

  it('goes below zero when the exchange gave less — a difference, not a commission', () => {
    expect(officialDifference(second, official('5'))).toEqual(money(-500_000n, 'AMD'))
  })

  it('is none for a rate of another pair', () => {
    expect(officialDifference(second, official('380', 'USD'))).toBeNull()
  })
})

describe('lastReceipt', () => {
  it('is the latest exchange into a currency, by day and then as written, up to a day', () => {
    expect(lastReceipt([second, first, dollars], 'AMD', '2026-09-30')).toBe(second)
    expect(lastReceipt([second, first], 'AMD', '2026-09-14')).toBe(first)
    expect(lastReceipt([first], 'USD', '2026-09-30')).toBeUndefined()
  })
})

describe('heldEstimate', () => {
  it('is what the last exchange left, less what was spent since, and says whether it is all', () => {
    expect(heldEstimate([first, second], second, 3_000_000n)).toEqual({
      held: money(8_500_000n, 'AMD'),
      whole: true,
    })
    // The first exchange never says what was there before: the hint is about its own money.
    expect(heldEstimate([first], first, 3_000_000n)).toEqual({
      held: money(7_000_000n, 'AMD'),
      whole: false,
    })
  })

  it('takes away what later exchanges gave of it, as a purchase would (MOL-42, Р-3)', () => {
    const back = exchange('10000 AMD', '2250 RUB', '2026-09-20')
    const earlier = exchange('5000 AMD', '1000 RUB', '2026-09-10')
    expect(heldEstimate([first, earlier, second, back], second, 3_000_000n)?.held).toEqual(
      money(7_500_000n, 'AMD'),
    )
    expect(heldEstimate([dollars, drams], dollars, 0n)?.held).toEqual(money(12_463n, 'USD'))
  })

  it('never goes below zero', () => {
    expect(heldEstimate([first], first, 99_999_999n)?.held).toEqual(money(0n, 'AMD'))
  })

  it('is none when the sum is not money at all — it took the screen down once (А1)', () => {
    const absurd: Exchange = { ...second, heldBefore: money(INT8_MAX, 'AMD') }
    expect(heldEstimate([absurd], absurd, 0n)).toBeNull()
  })
})

describe('isPlausibleExchange', () => {
  it('holds an ordinary exchange and refuses one no rate in the band says (А3)', () => {
    expect(isPlausibleExchange(money(2_000_000n, 'RUB'), money(9_500_000n, 'AMD'))).toBe(true)
    expect(isPlausibleExchange(money(100n, 'RUB'), money(500_000_000n, 'AMD'))).toBe(false)
    expect(isPlausibleExchange(money(100_000_000_000n, 'AMD'), money(1n, 'RUB'))).toBe(false)
  })

  it('refuses the same in the entity itself', () => {
    const absurd = { ...first, given: money(100n, 'RUB'), received: money(500_000_000n, 'AMD') }
    expect(exchangeSchema.safeParse(absurd).error?.issues[0]?.message).toBe(ERROR.INVALID_RATE)
  })
})
