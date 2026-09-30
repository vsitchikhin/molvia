import { describe, expect, it } from 'vitest'
import {
  bestQuote,
  exchangersPending,
  isMarketPlausible,
  marketQuotesOn,
  marketQuotesToday,
  marketRateOf,
  marketSideOf,
} from '#model/values/market-rates'
import type { MarketRate } from '#model/values/market-rates'
import { yerevanMidnight } from '#model/values/rates'

function row(
  channel: MarketRate['channel'],
  date: string,
  scaled: bigint,
  side: MarketRate['side'] = 'bankBuys',
  currency: MarketRate['currency'] = 'RUB',
): MarketRate {
  return { channel, currency, date, side, scaled }
}

// The rouble on 29.09.2026 from the central bank's files: people in cash and not, all bank clients.
const rouble = [
  row('bankCash', '2026-09-29', 4_110_180n),
  row('bankNoncash', '2026-09-29', 4_221_606n),
  row('banksAll', '2026-09-29', 4_217_687n),
  row('bankCash', '2026-09-29', 4_347_948n, 'bankSells'),
  row('bankNoncash', '2026-09-29', 4_361_759n, 'bankSells'),
  row('exchanger', '2026-09-29', 4_157_339n),
]

describe('marketSideOf', () => {
  it('gave roubles for drams — the bank bought roubles', () => {
    expect(marketSideOf('RUB', 'AMD')).toEqual({ currency: 'RUB', side: 'bankBuys' })
  })

  it('gave drams for dollars — the bank sold dollars', () => {
    expect(marketSideOf('AMD', 'USD')).toEqual({ currency: 'USD', side: 'bankSells' })
  })

  it('has no market for a pair without the dram (В-4)', () => {
    expect(marketSideOf('RUB', 'USD')).toBeNull()
    expect(marketSideOf('EUR', 'USD')).toBeNull()
  })
})

describe('marketQuotesOn', () => {
  it('gives each channel a person can name its figure of the day, on the side asked', () => {
    expect(marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-09-29')).toEqual([
      { channel: 'bankCash', basis: 'bankCash', date: '2026-09-29', scaled: 4_110_180n },
      { channel: 'bankNoncash', basis: 'bankNoncash', date: '2026-09-29', scaled: 4_221_606n },
      { channel: 'exchanger', basis: 'exchanger', date: '2026-09-29', scaled: 4_157_339n },
    ])
    expect(marketQuotesOn(rouble, 'RUB', 'bankSells', '2026-09-29').map((q) => q.channel)).toEqual([
      'bankCash',
      'bankNoncash',
    ])
  })

  it('takes a weekend day from the working day before it, within a week (Р-2)', () => {
    const [cash] = marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-10-04')
    expect(cash).toMatchObject({ channel: 'bankCash', date: '2026-09-29' })
  })

  it('stops at seven days: the eighth is not the market of that day', () => {
    expect(marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-10-06')).toHaveLength(2)
    expect(marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-10-07')).toEqual([])
  })

  it('takes exchange offices of that very day only: they publish every day (review, major 1)', () => {
    const late = [
      row('bankCash', '2026-09-29', 4_110_180n),
      row('exchanger', '2026-09-20', 4_076_782n),
    ]
    expect(marketQuotesOn(late, 'RUB', 'bankBuys', '2026-09-29').map((q) => q.channel)).toEqual([
      'bankCash',
    ])
  })

  it('never takes a figure from after the day', () => {
    expect(marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-09-28')).toEqual([])
  })

  it('puts all bank clients in for non-cash only, on a day before non-cash was collected (В-2)', () => {
    const before = [
      row('banksAll', '2026-09-24', 4_209_500n),
      row('exchanger', '2026-09-24', 4_150_000n),
    ]
    expect(marketQuotesOn(before, 'RUB', 'bankBuys', '2026-09-24')).toEqual([
      { channel: 'bankNoncash', basis: 'banksAll', date: '2026-09-24', scaled: 4_209_500n },
      { channel: 'exchanger', basis: 'exchanger', date: '2026-09-24', scaled: 4_150_000n },
    ])
  })

  it('does not mix currencies', () => {
    expect(marketQuotesOn(rouble, 'USD', 'bankBuys', '2026-09-29')).toEqual([])
  })

  it('without a day, gives each channel its latest of any age — the block of today', () => {
    const old = [
      row('exchanger', '2026-09-01', 4_000_000n),
      row('exchanger', '2026-09-20', 4_076_782n),
    ]
    expect(marketQuotesOn(old, 'RUB', 'bankBuys', null)).toEqual([
      { channel: 'exchanger', basis: 'exchanger', date: '2026-09-20', scaled: 4_076_782n },
    ])
  })
})

describe('bestQuote', () => {
  const quotes = marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-09-29')

  it('is the highest when the bank buys: more drams for what was sold', () => {
    expect(bestQuote(quotes, 'bankBuys')?.channel).toBe('bankNoncash')
  })

  it('is the lowest when the bank sells: fewer drams for what was bought', () => {
    const selling = marketQuotesOn(rouble, 'RUB', 'bankSells', '2026-09-29')
    expect(bestQuote(selling, 'bankSells')?.channel).toBe('bankCash')
  })

  it('goes to the channel named first on a tie, and is null with nothing to choose from', () => {
    const tie = [
      { channel: 'bankCash' as const, basis: 'bankCash' as const, date: '2026-09-29', scaled: 1n },
      {
        channel: 'exchanger' as const,
        basis: 'exchanger' as const,
        date: '2026-09-29',
        scaled: 1n,
      },
    ]
    expect(bestQuote(tie, 'bankBuys')?.channel).toBe('bankCash')
    expect(bestQuote([], 'bankBuys')).toBeNull()
  })
})

describe('exchangersPending', () => {
  const banks = marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-09-29').filter(
    (quote) => quote.channel !== 'exchanger',
  )

  it('waits for a day the exchange offices have not reached yet (В-3)', () => {
    expect(exchangersPending(banks, '2026-09-25', '2026-09-29', '2026-09-30')).toBe(true)
  })

  it('does not wait for a day the file has passed: that day simply has no row', () => {
    expect(exchangersPending(banks, '2026-09-25', '2026-09-12', '2026-09-30')).toBe(false)
  })

  it('does not wait once the day has its exchange offices', () => {
    const all = marketQuotesOn(rouble, 'RUB', 'bankBuys', '2026-09-29')
    expect(exchangersPending(all, '2026-09-25', '2026-09-29', '2026-09-30')).toBe(false)
  })

  it('waits while nothing of theirs was ever read — for a recent day only (review, minor 8)', () => {
    expect(exchangersPending(banks, null, '2026-09-29', '2026-09-30')).toBe(true)
    expect(exchangersPending(banks, null, '2026-09-09', '2026-09-30')).toBe(true)
    expect(exchangersPending(banks, null, '2026-09-08', '2026-09-30')).toBe(false)
    expect(exchangersPending(banks, null, '2022-03-01', '2026-09-30')).toBe(false)
  })

  it('a week of the file behind the day is not that day: the banks, and «still to come»', () => {
    const late = [
      row('bankCash', '2026-09-25', 4_110_180n),
      row('exchanger', '2026-09-20', 4_076_782n),
    ]
    const quotes = marketQuotesOn(late, 'RUB', 'bankBuys', '2026-09-25')
    expect(quotes.map((quote) => quote.channel)).toEqual(['bankCash'])
    expect(exchangersPending(quotes, '2026-09-20', '2026-09-25', '2026-09-30')).toBe(true)
  })
})

describe('marketQuotesToday', () => {
  it('keeps each channel’s latest of any age, dated — the exchange offices a week late', () => {
    expect(
      marketQuotesToday(rouble, 'RUB', 'bankBuys', '2026-09-30').map((q) => [q.channel, q.basis]),
    ).toEqual([
      ['bankCash', 'bankCash'],
      ['bankNoncash', 'bankNoncash'],
      ['exchanger', 'exchanger'],
    ])
  })

  it('puts all bank clients fresh today in place of a non-cash row over a week old', () => {
    const stale = [
      row('bankNoncash', '2026-09-10', 4_221_606n),
      row('banksAll', '2026-09-29', 4_217_687n),
    ]
    expect(marketQuotesToday(stale, 'RUB', 'bankBuys', '2026-09-30')).toEqual([
      { channel: 'bankNoncash', basis: 'banksAll', date: '2026-09-29', scaled: 4_217_687n },
    ])
    expect(marketQuotesToday(stale.slice(0, 1), 'RUB', 'bankBuys', '2026-09-30')).toEqual([
      { channel: 'bankNoncash', basis: 'bankNoncash', date: '2026-09-10', scaled: 4_221_606n },
    ])
  })
})

describe('marketRateOf', () => {
  it('is the currency in drams on its own day', () => {
    const quote = {
      channel: 'bankCash' as const,
      basis: 'bankCash' as const,
      date: '2026-09-29',
      scaled: 4_110_180n,
    }
    expect(marketRateOf(quote, 'RUB')).toEqual({
      base: 'RUB',
      quote: 'AMD',
      scaled: 4_110_180n,
      source: 'official',
      asOf: yerevanMidnight('2026-09-29'),
    })
  })
})

describe('isMarketPlausible', () => {
  it('lets the rouble in cash through, five percent off', () => {
    expect(isMarketPlausible(4_110_180n, 4_318_700n)).toBe(true)
  })

  // The central bank's own file against its own archive (adversarial review А): banks sold
  // roubles 27.5 % above the official rate on 3 March 2022. The market of a crisis is the market.
  it('lets the market of March 2022 through: banks selling roubles at 5,431169 against 4,26', () => {
    expect(isMarketPlausible(5_431_169n, 4_260_000n)).toBe(true)
    expect(isMarketPlausible(5_662_229n, 4_790_000n)).toBe(true)
  })

  it('holds at a factor of two either way, the bound itself included', () => {
    expect(isMarketPlausible(8_637_400n, 4_318_700n)).toBe(true)
    expect(isMarketPlausible(8_637_401n, 4_318_700n)).toBe(false)
    expect(isMarketPlausible(2_159_350n, 4_318_700n)).toBe(true)
    expect(isMarketPlausible(2_159_349n, 4_318_700n)).toBe(false)
  })

  it('refuses what a column read one place off gives: a volume, a rate per ten units', () => {
    expect(isMarketPlausible(3_651_380_510n, 363_180_000n)).toBe(false)
    expect(isMarketPlausible(43_187_000n, 4_318_700n)).toBe(false)
  })
})
