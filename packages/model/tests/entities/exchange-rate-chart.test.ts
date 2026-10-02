import { describe, expect, it } from 'vitest'
import {
  rateChart,
  rateChartPairs,
  rateLevels,
  rateWeeks,
  weekRate,
} from '#model/entities/exchange-rate-chart'
import type { RateChartExchangeInput } from '#model/entities/exchange-rate-chart'
import { CHART_LEVEL } from '#model/entities/money-charts'
import type { Currency } from '#model/values/money'
import type { MarketChannel, MarketRate, MarketSide } from '#model/values/market-rates'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const FROM = '2025-11-01'
const TODAY = '2026-10-02'

function row(
  date: string,
  rate: string,
  of: { channel?: MarketChannel; side?: MarketSide; currency?: 'RUB' | 'USD' | 'EUR' } = {},
): MarketRate {
  return {
    channel: of.channel ?? 'banksAll',
    currency: of.currency ?? 'RUB',
    side: of.side ?? 'bankBuys',
    date,
    scaled: parseRate(rate),
  }
}

function drams(rate: string, day: string, currency: Currency = 'RUB'): ExchangeRate {
  return {
    base: currency,
    quote: 'AMD',
    scaled: parseRate(rate),
    source: 'official',
    asOf: yerevanMidnight(day),
  }
}

interface ExchangeOf {
  id?: string
  given?: Currency
  received?: Currency
  /** Drams received, in whole drams. */
  amount?: number
  rate?: string | null
  note?: string | null
  /** The market measured by: rate and difference in whole drams. */
  best?: { rate: string; difference: number; basis?: MarketChannel }
  own?: { rate: string; difference: number; basis?: MarketChannel }
}

function exchange(day: string, of: ExchangeOf = {}): RateChartExchangeInput {
  const quote = (q: { rate: string; difference: number; basis?: MarketChannel }) => ({
    basis: q.basis ?? 'bankCash',
    rate: drams(q.rate, day),
    difference: { minor: BigInt(q.difference) * 100n },
  })
  const given = of.given ?? 'RUB'
  const received = of.received ?? 'AMD'
  return {
    id: of.id ?? `00000000-0000-4000-8000-${day.replaceAll('-', '').padStart(12, '0')}`,
    exchangedOn: day,
    given: { currency: given },
    received: { minor: BigInt(of.amount ?? 41_500) * 100n, currency: received },
    note: of.note === undefined ? 'Ардшинбанк' : of.note,
    rate:
      of.rate === null ? null : drams(of.rate ?? '4.15', day, given === 'AMD' ? received : given),
    market: of.best ? { best: quote(of.best), own: of.own ? quote(of.own) : null } : null,
  }
}

describe('rateWeeks', () => {
  it('reads every Sunday of the window, then today', () => {
    const weeks = rateWeeks(FROM, TODAY)
    // 1 November 2025 is a Saturday: the first week ends the next day.
    expect(weeks[0]).toBe('2025-11-02')
    expect(weeks.at(-2)).toBe('2026-09-27')
    expect(weeks.at(-1)).toBe(TODAY)
    expect(weeks).toHaveLength(49)
    expect(weeks).toContain('2026-01-04')
  })

  it('does not read today twice when it is a Sunday', () => {
    expect(rateWeeks('2026-09-14', '2026-09-27')).toEqual(['2026-09-20', '2026-09-27'])
  })

  it('takes a window that starts on a Sunday from that very day', () => {
    expect(rateWeeks('2026-09-20', '2026-09-23')).toEqual(['2026-09-20', '2026-09-23'])
  })
})

describe('weekRate', () => {
  const rows = [row('2026-03-16', '4.50'), row('2026-03-20', '4.60'), row('2026-03-23', '4.70')]

  it('takes the latest row of the week, never one after its end', () => {
    expect(weekRate(rows, '2026-03-22')?.scaled).toBe(parseRate('4.60'))
  })

  it('takes a row up to a week before the end, and none older', () => {
    expect(weekRate([row('2026-03-15', '4.40')], '2026-03-22')?.date).toBe('2026-03-15')
    expect(weekRate([row('2026-03-14', '4.40')], '2026-03-22')).toBeNull()
  })

  it('is none with no rows', () => {
    expect(weekRate([], '2026-03-22')).toBeNull()
  })
})

describe('rateLevels', () => {
  it('lays three round ticks of 0,30 within the rouble of the handoff', () => {
    expect(rateLevels(parseRate('4.25'), parseRate('4.95'))).toEqual(
      ['4.30', '4.60', '4.90'].map(parseRate),
    )
  })

  it('takes a step of five for the dollar', () => {
    expect(rateLevels(parseRate('380'), parseRate('392'))).toEqual(
      ['381', '386', '391'].map(parseRate),
    )
  })

  it('narrows the step until three fit inside', () => {
    expect(rateLevels(parseRate('4.11'), parseRate('4.17'))).toEqual(
      ['4.11', '4.14', '4.17'].map(parseRate),
    )
  })

  it('gives one tick when three of two digits do not fit', () => {
    expect(rateLevels(parseRate('4.123'), parseRate('4.13'))).toEqual([parseRate('4.13')])
    expect(rateLevels(parseRate('4.150001'), parseRate('4.150001'))).toEqual([parseRate('4.15')])
  })
})

describe('rateChartPairs', () => {
  it('offers every currency changed against the dram, the currency of conversion first', () => {
    const pairs = rateChartPairs(
      [
        exchange('2026-09-01', { given: 'USD' }),
        exchange('2026-08-01'),
        exchange('2026-07-01', { given: 'EUR' }),
      ],
      FROM,
      TODAY,
      'RUB',
    )
    expect(pairs.map(({ currency }) => currency)).toEqual(['RUB', 'USD', 'EUR'])
  })

  it('takes the side of the latest exchange of the pair (В-2)', () => {
    const pairs = rateChartPairs(
      [exchange('2026-09-01', { given: 'AMD', received: 'RUB' }), exchange('2026-08-01')],
      FROM,
      TODAY,
      'RUB',
    )
    expect(pairs).toEqual([{ currency: 'RUB', side: 'bankSells' }])
  })

  it('leaves out a pair without the dram and exchanges outside the window', () => {
    const pairs = rateChartPairs(
      [
        exchange('2026-09-01', { given: 'RUB', received: 'USD' }),
        exchange('2025-10-31', { given: 'EUR' }),
      ],
      FROM,
      TODAY,
      'USD',
    )
    expect(pairs).toEqual([{ currency: 'USD', side: 'bankBuys' }])
  })

  it('is the currency of conversion alone with no exchanges, and nothing when it is the dram', () => {
    expect(rateChartPairs([], FROM, TODAY, 'RUB')).toEqual([{ currency: 'RUB', side: 'bankBuys' }])
    expect(rateChartPairs([], FROM, TODAY, 'AMD')).toEqual([])
  })
})

describe('rateChart', () => {
  const line = [
    row('2026-03-20', '4.60'),
    row('2026-09-25', '4.22'),
    row('2026-10-02', '4.25'),
    // Another channel and the other side are not the line.
    row('2026-09-25', '4.10', { channel: 'bankCash' }),
    row('2026-09-25', '4.60', { side: 'bankSells' }),
  ]
  const rub = { currency: 'RUB' as const, side: 'bankBuys' as const, rows: line }

  it('draws the line by all bank clients at the end of each week, a gap where none is fresh', () => {
    const chart = rateChart([rub], [], FROM, TODAY)
    const weeks = chart?.pairs[0]?.weeks ?? []
    expect(weeks.find(({ day }) => day === '2026-03-22')?.rate?.scaled).toBe(parseRate('4.60'))
    expect(weeks.find(({ day }) => day === '2026-09-27')?.rate?.scaled).toBe(parseRate('4.22'))
    expect(weeks.find(({ day }) => day === '2026-09-27')?.rate?.asOf).toEqual(
      yerevanMidnight('2026-09-25'),
    )
    const gap = weeks.find(({ day }) => day === '2026-06-07')
    expect(gap).toMatchObject({ rate: null, level: null })
    expect(weeks[0]?.x).toBe(3)
    expect(weeks.at(-1)).toMatchObject({ day: TODAY, x: CHART_LEVEL })
    expect(chart?.pairs[0]?.exchanges).toEqual([])
  })

  it('sets a cash exchange beside its own channel: the percent and the mark agree (В-1)', () => {
    // 10 000 ₽ at 4,15 in cash, when banks bought cash at 4,11: 400 ֏ more than the market.
    const chart = rateChart(
      [rub],
      [
        exchange('2026-09-29', {
          amount: 41_500,
          best: { rate: '4.12', difference: 300, basis: 'exchanger' },
          own: { rate: '4.11', difference: 400 },
        }),
      ],
      FROM,
      TODAY,
    )
    const point = chart?.pairs[0]?.exchanges[0]
    expect(point).toMatchObject({
      day: '2026-09-29',
      week: rateWeeks(FROM, TODAY).length - 1,
      place: 'Ардшинбанк',
      // 400 of the 41 100 ֏ the market would have given.
      percent: 97,
      market: { basis: 'bankCash', rate: drams('4.11', '2026-09-29') },
    })
    expect(point?.rate.scaled).toBe(parseRate('4.15'))
    // The mark ends below the point, the line runs above both.
    const week = chart?.pairs[0]?.weeks.find(({ day }) => day === '2026-10-02')
    expect(point?.market?.level).toBeLessThan(point?.level ?? 0)
    expect(point?.level).toBeLessThan(week?.level ?? 0)
  })

  it('measures by the best of the day when no channel was named, and by nothing with no market', () => {
    const chart = rateChart(
      [rub],
      [
        exchange('2026-09-21', { best: { rate: '4.20', difference: -200, basis: 'banksAll' } }),
        exchange('2026-09-22', { note: null }),
      ],
      FROM,
      TODAY,
    )
    const [measured, bare] = chart?.pairs[0]?.exchanges ?? []
    expect(measured).toMatchObject({ percent: -48, market: { basis: 'banksAll' } })
    expect(bare).toMatchObject({ percent: null, market: null, place: null })
  })

  it('puts each exchange on its own day, two of one week as two points in order', () => {
    const chart = rateChart(
      [rub],
      [
        exchange('2026-09-24', { id: 'b0000000-0000-4000-8000-000000000000' }),
        exchange('2026-09-22', { id: 'a0000000-0000-4000-8000-000000000000' }),
      ],
      FROM,
      TODAY,
    )
    const points = chart?.pairs[0]?.exchanges ?? []
    expect(points.map(({ day }) => day)).toEqual(['2026-09-22', '2026-09-24'])
    expect(points[0]?.week).toBe(points[1]?.week)
    expect(points[0]?.x).toBeLessThan(points[1]?.x ?? 0)
  })

  it('draws neither the other side, nor another pair, nor the days outside the window', () => {
    const chart = rateChart(
      [rub],
      [
        exchange('2026-09-21', { given: 'AMD', received: 'RUB', rate: '4.60' }),
        exchange('2026-09-21', { given: 'USD', rate: '386' }),
        exchange('2025-10-31'),
        exchange('2026-10-03'),
        exchange('2026-09-21', { rate: null }),
      ],
      FROM,
      TODAY,
    )
    expect(chart?.pairs[0]?.exchanges).toEqual([])
  })

  it('lays the ticks over the line, the points and the marks alike', () => {
    const chart = rateChart(
      [rub],
      [exchange('2026-09-29', { rate: '4.95', best: { rate: '4.11', difference: 0 } })],
      FROM,
      TODAY,
    )
    const pair = chart?.pairs[0]
    // 4,11 is the lowest figure, 4,95 the highest: the middle is 4,53.
    expect(pair?.levels.map(({ rate }) => rate.scaled)).toEqual(
      ['4.20', '4.50', '4.80'].map(parseRate),
    )
    expect(pair?.exchanges[0]?.level).toBe(CHART_LEVEL)
    expect(pair?.exchanges[0]?.market?.level).toBe(0)
  })

  it('stands at half height when every figure is one', () => {
    const chart = rateChart(
      [{ ...rub, rows: [row('2026-09-25', '4.15')] }],
      [exchange('2026-09-29')],
      FROM,
      TODAY,
    )
    const pair = chart?.pairs[0]
    expect(pair?.levels).toEqual([{ rate: drams('4.15', TODAY), level: CHART_LEVEL / 2 }])
    expect(pair?.exchanges[0]?.level).toBe(CHART_LEVEL / 2)
  })

  it('leaves out a pair with no figure in any week, and is null with none left', () => {
    const usd = { currency: 'USD' as const, side: 'bankBuys' as const, rows: [] }
    expect(rateChart([rub, usd], [], FROM, TODAY)?.pairs.map(({ currency }) => currency)).toEqual([
      'RUB',
    ])
    expect(rateChart([usd], [exchange('2026-09-21', { given: 'USD' })], FROM, TODAY)).toBeNull()
    expect(rateChart([], [], FROM, TODAY)).toBeNull()
  })
})
