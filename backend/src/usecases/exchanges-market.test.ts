import { describe, expect, it } from 'vitest'
import type { CachedRate, MarketRate } from '@molvia/model'
import { marketTodayOf } from './exchanges'

const TODAY = '2026-09-30'

function figure(
  channel: MarketRate['channel'],
  date: string,
  scaled: bigint,
  side: MarketRate['side'] = 'bankBuys',
): MarketRate {
  return { channel, currency: 'RUB', date, side, scaled }
}

const official = (provider: CachedRate['provider'], date: string, scaled: bigint): CachedRate => ({
  provider,
  currency: 'RUB',
  date,
  scaled,
  jump: false,
})

describe('marketTodayOf — «Курсы по данным ЦБ РА» (MOL-137)', () => {
  it('names only the central bank’s own rate: an open source standing in is not shown as it (П-3)', () => {
    const rows = [
      official('cba', '2026-09-15', 4_300_000n),
      official('cbr', '2026-09-29', 4_310_000n),
    ]
    const [rouble] = marketTodayOf([], rows, TODAY)
    expect(rouble?.official).toBeNull()
    const fresh = marketTodayOf([], [official('cba', '2026-09-29', 4_318_700n)], TODAY)
    expect(fresh[0]?.official?.scaled).toBe(4_318_700n)
  })

  it('stars the best of the latest day only: last week’s exchange office is shown, not starred (П-5)', () => {
    const [rouble] = marketTodayOf(
      [
        figure('bankCash', '2026-09-29', 4_110_180n),
        figure('bankNoncash', '2026-09-29', 4_221_606n),
        figure('exchanger', '2026-09-25', 4_250_000n),
      ],
      [],
      TODAY,
    )
    expect(rouble?.quotes.map((quote) => [quote.channel, quote.bestBuys])).toEqual([
      ['bankCash', false],
      ['bankNoncash', true],
      ['exchanger', false],
    ])
    // The lists stand the star first and last week's office after its day (MOL-348, adversarial А3).
    expect(rouble?.track?.sell.map(({ channel }) => channel)).toEqual([
      'bankNoncash',
      'bankCash',
      'exchanger',
    ])
  })

  it('lists last week’s office after the starred banks, where it would buy dearest (MOL-348, А3)', () => {
    const [rouble] = marketTodayOf(
      [
        figure('bankCash', '2026-09-29', 4_480_000n, 'bankSells'),
        figure('bankNoncash', '2026-09-29', 4_420_000n, 'bankSells'),
        figure('exchanger', '2026-09-18', 4_390_000n, 'bankSells'),
      ],
      [],
      TODAY,
    )
    expect(rouble?.quotes.find((quote) => quote.bestSells)?.channel).toBe('bankNoncash')
    expect(rouble?.track?.buy.map(({ channel }) => channel)).toEqual([
      'bankNoncash',
      'bankCash',
      'exchanger',
    ])
  })

  it('stars an exchange office when it is of the latest day and the best of it', () => {
    const [rouble] = marketTodayOf(
      [figure('bankCash', '2026-09-29', 4_110_180n), figure('exchanger', '2026-09-29', 4_157_339n)],
      [],
      TODAY,
    )
    expect(rouble?.quotes.find((quote) => quote.channel === 'exchanger')?.bestBuys).toBe(true)
  })
})
