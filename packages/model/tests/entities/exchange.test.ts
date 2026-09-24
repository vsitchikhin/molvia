import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '#model/support/errors'
import {
  exchangeRateOf,
  exchangeSchema,
  heldEstimate,
  officialDifference,
  walletRate,
} from '#model/entities/exchange'
import type { Exchange } from '#model/entities/exchange'
import { convertMoney } from '#model/entities/trip'
import { formatEstimate, money } from '#model/values/money'
import type { Currency } from '#model/values/money'
import { RATE_MAX, parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

let sequence = 0

/** An exchange in major units: `exchange('20000 RUB', '100000 AMD', '2026-09-01')`. */
function exchange(
  given: string,
  received: string,
  exchangedOn: string,
  heldBefore: string | null = null,
): Exchange {
  const toMoney = (text: string) => {
    const [amount = '', currency = ''] = text.split(' ')
    return money(BigInt(amount) * 100n, currency as Currency)
  }
  sequence += 1
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
    given: toMoney(given),
    received: toMoney(received),
    exchangedOn,
    heldBefore: heldBefore === null ? null : toMoney(heldBefore),
    createdAt: new Date(`${exchangedOn}T12:00:00Z`),
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

  it('is not moved by an exchange of another pair, the reverse one included', () => {
    const dollars = exchange('100 USD', '38000 AMD', '2026-09-10', '1000 AMD')
    const back = exchange('10000 AMD', '2000 RUB', '2026-09-12')
    const wallet = walletRate([first, dollars, back, second], 'RUB', 'AMD', '2026-09-30')
    expect(wallet?.rate.scaled).toBe(4_791_667n)
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

describe('heldEstimate', () => {
  it('is what the last exchange left, less what was spent since', () => {
    expect(heldEstimate(second, 3_000_000n)).toEqual(money(8_500_000n, 'AMD'))
    expect(heldEstimate(first, 3_000_000n)).toEqual(money(7_000_000n, 'AMD'))
  })

  it('never goes below zero', () => {
    expect(heldEstimate(first, 99_999_999n)).toEqual(money(0n, 'AMD'))
  })
})
