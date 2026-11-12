import { describe, expect, it } from 'vitest'
import { marketTrack, vsMarketBars, walletTrack } from '#model/entities/exchange-screen'
import type { VsMarketBarInput } from '#model/entities/exchange-screen'
import { CHART_LEVEL } from '#model/entities/money-charts'
import type { Currency } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

function rate(base: Currency, quote: Currency, figure: string): ExchangeRate {
  return {
    base,
    quote,
    scaled: parseRate(figure),
    source: 'official',
    asOf: yerevanMidnight('2026-11-11'),
  }
}

function dram(minor: bigint) {
  return { minor, currency: 'AMD' as const }
}

/** An exchange measured as the sum measures it: drams more than the market, of drams expected. */
function measured(
  id: string,
  exchangedOn: string,
  difference: bigint,
  of: Partial<VsMarketBarInput> = {},
): VsMarketBarInput {
  return {
    id,
    exchangedOn,
    note: null,
    cardDifference: difference,
    difference: dram(difference),
    expected: dram(10_000_00n),
    ...of,
  }
}

describe('vsMarketBars', () => {
  it('stands the bars oldest first, as tall as their drams against the furthest, down for less', () => {
    // The list comes newest first.
    const bars = vsMarketBars([
      measured('c', '2026-10-03', 1_877_600n),
      measured('b', '2026-06-09', -469_400n),
      measured('a', '2025-12-14', 293_400n),
    ])
    expect(bars.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
    expect(bars.map(({ level }) => level)).toEqual([156, -250, CHART_LEVEL])
    expect(bars.map(({ sign }) => sign)).toEqual([1, -1, 1])
    expect(bars[2]?.percent).toBe(18_776)
  })

  it('keeps two exchanges of one day in the order they were made', () => {
    const bars = vsMarketBars([
      measured('later', '2026-10-03', 100n),
      measured('earlier', '2026-10-03', 200n),
    ])
    expect(bars.map(({ id }) => id)).toEqual(['earlier', 'later'])
  })

  it('puts an exchange with no market on the line, in no scale, with no sign', () => {
    const bars = vsMarketBars([
      measured('none', '2026-10-01', 0n, {
        cardDifference: null,
        difference: null,
        expected: null,
      }),
      measured('one', '2026-09-01', 500n),
    ])
    expect(bars[1]).toMatchObject({
      id: 'none',
      difference: null,
      percent: null,
      sign: null,
      level: 0,
    })
    expect(bars[0]?.level).toBe(CHART_LEVEL)
  })

  it('leaves out of the scale a market that would have given nothing', () => {
    const bars = vsMarketBars([
      measured('void', '2026-10-01', 9_000_000n, { expected: dram(0n) }),
      measured('one', '2026-09-01', 500n),
    ])
    expect(bars[1]).toMatchObject({ difference: null, sign: null, level: 0 })
    expect(bars[0]?.level).toBe(CHART_LEVEL)
  })

  it('takes the tone from the card’s own money, never from the drams rounded into the sum', () => {
    // Spent in dollars, −1 ֏ is under a cent: the sum says 0, the card says «хуже» (MOL-190, А1).
    const [bar] = vsMarketBars([
      measured('x', '2026-10-01', 0n, { cardDifference: -100n, difference: dram(0n) }),
    ])
    expect(bar).toMatchObject({ sign: -1, level: 0 })
  })

  it('says «ровно» as a zero of money: no level, no sign but nought', () => {
    const [bar] = vsMarketBars([measured('x', '2026-10-01', 0n)])
    expect(bar).toMatchObject({ sign: 0, level: 0, percent: 0 })
  })

  it('names the place as written, trimmed; empty is none', () => {
    const bars = vsMarketBars([
      measured('a', '2026-10-01', 1n, { note: '  ВТБ банкомат ' }),
      measured('b', '2026-09-01', 1n, { note: '   ' }),
    ])
    expect(bars.map(({ place }) => place)).toEqual([null, 'ВТБ банкомат'])
  })
})

describe('marketTrack', () => {
  const rouble = {
    currency: 'RUB' as const,
    official: rate('RUB', 'AMD', '4.34'),
    quotes: [
      {
        channel: 'bankCash' as const,
        buys: rate('RUB', 'AMD', '4.13'),
        sells: rate('RUB', 'AMD', '4.37'),
      },
      {
        channel: 'bankNoncash' as const,
        buys: rate('RUB', 'AMD', '4.24'),
        sells: rate('RUB', 'AMD', '4.34'),
      },
      {
        channel: 'exchanger' as const,
        buys: rate('RUB', 'AMD', '4.02'),
        sells: rate('RUB', 'AMD', '4.09'),
      },
    ],
  }

  it('orders selling by the highest the bank buys at, buying by the lowest it sells at', () => {
    const track = marketTrack(rouble)
    expect(track.sell.map(({ channel }) => channel)).toEqual([
      'bankNoncash',
      'bankCash',
      'exchanger',
    ])
    expect(track.buy.map(({ channel }) => channel)).toEqual([
      'exchanger',
      'bankNoncash',
      'bankCash',
    ])
  })

  it('places every figure and the central bank on one track from the lowest to the highest', () => {
    const track = marketTrack(rouble)
    // 4,02 … 4,37: 35 hundredths.
    expect(track.sell.map(({ at }) => at)).toEqual([629, 314, 0])
    expect(track.buy.map(({ at }) => at)).toEqual([200, 914, CHART_LEVEL])
    expect(track.official).toBe(914)
  })

  it('reads a figure kept the other way round on the same side, in drams per unit', () => {
    const turned = marketTrack({
      ...rouble,
      official: rate('AMD', 'RUB', '0.230415'),
    })
    expect(turned.official).toBe(914)
  })

  it('has no line of the central bank without its rate, and leaves out a side with no figure', () => {
    const track = marketTrack({
      currency: 'EUR',
      official: null,
      quotes: [
        { channel: 'bankCash', buys: rate('EUR', 'AMD', '407'), sells: null },
        { channel: 'exchanger', buys: rate('EUR', 'AMD', '410'), sells: rate('EUR', 'AMD', '416') },
      ],
    })
    expect(track.official).toBeNull()
    expect(track.buy).toEqual([{ channel: 'exchanger', at: CHART_LEVEL }])
    expect(track.sell).toEqual([
      { channel: 'exchanger', at: 333 },
      { channel: 'bankCash', at: 0 },
    ])
  })

  it('stands equal figures in the middle, in the order of the channels', () => {
    const track = marketTrack({
      currency: 'USD',
      official: null,
      quotes: [
        { channel: 'bankCash', buys: rate('USD', 'AMD', '362'), sells: null },
        { channel: 'bankNoncash', buys: rate('USD', 'AMD', '362'), sells: null },
      ],
    })
    expect(track.sell).toEqual([
      { channel: 'bankCash', at: CHART_LEVEL / 2 },
      { channel: 'bankNoncash', at: CHART_LEVEL / 2 },
    ])
  })

  it('has empty lists and no line for a currency with no figure at all', () => {
    expect(marketTrack({ currency: 'USD', official: null, quotes: [] })).toEqual({
      official: null,
      sell: [],
      buy: [],
    })
  })
})

describe('walletTrack', () => {
  it('stands the higher printed figure to the right', () => {
    expect(walletTrack(rate('RUB', 'AMD', '4.87'), rate('RUB', 'AMD', '4.34'))).toEqual({
      own: 850,
      official: 150,
    })
    expect(walletTrack(rate('RUB', 'AMD', '4.20'), rate('RUB', 'AMD', '4.34'))).toEqual({
      own: 150,
      official: 850,
    })
  })

  it('compares a rate kept the other way round by its printed side', () => {
    // 0,205339 ₽/֏ is printed 4,87 ֏/₽.
    expect(walletTrack(rate('AMD', 'RUB', '0.205339'), rate('RUB', 'AMD', '4.34'))).toEqual({
      own: 850,
      official: 150,
    })
  })

  it('stands both in the middle when they are one figure', () => {
    expect(walletTrack(rate('RUB', 'AMD', '4.34'), rate('RUB', 'AMD', '4.34'))).toEqual({
      own: CHART_LEVEL / 2,
      official: CHART_LEVEL / 2,
    })
  })

  it('draws nothing for rates of two different pairs', () => {
    expect(walletTrack(rate('USD', 'AMD', '387'), rate('RUB', 'AMD', '4.34'))).toBeNull()
  })
})
