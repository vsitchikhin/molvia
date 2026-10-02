import { describe, expect, it } from 'vitest'
import {
  RATE_CHART_MONTHS,
  rateChart,
  rateChartPairs,
  rateDays,
  rateLevels,
  ratePeriodFrom,
  rateScale,
  rateWeeks,
  stepRate,
} from '#model/entities/exchange-rate-chart'
import type { RateChart, RateChartExchangeInput } from '#model/entities/exchange-rate-chart'
import { CHART_LEVEL, EXCHANGE_LOSS_MONTHS } from '#model/entities/money-charts'
import type { Currency } from '#model/values/money'
import type { MarketChannel, MarketRate, MarketSide } from '#model/values/market-rates'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const FROM = '2025-11-01'
const TODAY = '2026-10-02'
/** The year of the chart: the day after the same day a year back (MOL-168, В-1 «б»). */
const YEAR_FROM = '2025-10-03'

/** A pair's year, as every chart test before MOL-168 read the one period there was. */
function year(chart: RateChart | null, index = 0) {
  return chart?.pairs[index]?.periods[12]
}

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
  /** As «Обмены против рынка» measured it, in minor units of the spending currency. */
  measured?: { difference: bigint; expected: bigint } | null
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
    // Drams received: the measure of «Обмены против рынка» is the market's own difference.
    measured:
      of.measured === undefined ? measuredOf(of.own ?? of.best, of.amount ?? 41_500) : of.measured,
  }
}

function measuredOf(quote: { difference: number } | undefined, amount: number) {
  if (!quote) return null
  const difference = BigInt(quote.difference) * 100n
  return { difference, expected: BigInt(amount) * 100n - difference }
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

describe('stepRate', () => {
  const rows = [row('2026-03-16', '4.50'), row('2026-03-20', '4.60'), row('2026-03-23', '4.70')]

  it('takes the latest row of the week, never one after its end', () => {
    expect(stepRate(rows, '2026-03-22')?.scaled).toBe(parseRate('4.60'))
  })

  it('takes a row up to a week before the end, and none older', () => {
    expect(stepRate([row('2026-03-15', '4.40')], '2026-03-22')?.date).toBe('2026-03-15')
    expect(stepRate([row('2026-03-14', '4.40')], '2026-03-22')).toBeNull()
  })

  it('is none with no rows', () => {
    expect(stepRate([], '2026-03-22')).toBeNull()
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

describe('rateScale', () => {
  it('spans the figures as they are when they are wider than a hundredth of their middle', () => {
    expect(rateScale(parseRate('4.25'), parseRate('4.95'))).toEqual([
      parseRate('4.25'),
      parseRate('4.95'),
    ])
  })

  it('widens a narrow span to a hundredth of its middle, around it', () => {
    expect(rateScale(parseRate('4.60'), parseRate('4.6034'))).toEqual([
      parseRate('4.578692'),
      parseRate('4.624709'),
    ])
  })

  it('never narrower than two steps of the axis', () => {
    expect(rateScale(parseRate('1.00'), parseRate('1.00'))).toEqual([
      parseRate('0.99'),
      parseRate('1.01'),
    ])
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
    const chart = rateChart([rub], [], TODAY)
    const weeks = year(chart)?.steps ?? []
    expect(weeks.find(({ day }) => day === '2026-03-22')?.rate?.scaled).toBe(parseRate('4.60'))
    expect(weeks.find(({ day }) => day === '2026-09-27')?.rate?.scaled).toBe(parseRate('4.22'))
    expect(weeks.find(({ day }) => day === '2026-09-27')?.rate?.asOf).toEqual(
      yerevanMidnight('2026-09-25'),
    )
    const gap = weeks.find(({ day }) => day === '2026-06-07')
    expect(gap).toMatchObject({ rate: null, level: null })
    // 3 October 2025 is a Friday: the first week ends two days in, of 364.
    expect(weeks[0]).toMatchObject({ day: '2025-10-05', x: 5 })
    expect(weeks.at(-1)).toMatchObject({ day: TODAY, x: CHART_LEVEL })
    expect(year(chart)?.exchanges).toEqual([])
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
      TODAY,
    )
    const point = year(chart)?.exchanges[0]
    expect(point).toMatchObject({
      day: '2026-09-29',
      step: rateWeeks(YEAR_FROM, TODAY).length - 1,
      place: 'Ардшинбанк',
      // 400 of the 41 100 ֏ the market would have given.
      percent: 97,
      market: { basis: 'bankCash', rate: drams('4.11', '2026-09-29') },
    })
    expect(point?.rate.scaled).toBe(parseRate('4.15'))
    // The mark ends below the point, the line runs above both.
    const week = year(chart)?.steps.find(({ day }) => day === '2026-10-02')
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
      TODAY,
    )
    const [measured, bare] = year(chart)?.exchanges ?? []
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
      TODAY,
    )
    const points = year(chart)?.exchanges ?? []
    expect(points.map(({ day }) => day)).toEqual(['2026-09-22', '2026-09-24'])
    expect(points[0]?.step).toBe(points[1]?.step)
    expect(points[0]?.x).toBeLessThan(points[1]?.x ?? 0)
  })

  it('takes the percent from the measure of «Обмены против рынка», drams and all (adversarial В)', () => {
    // 100 ₽ bought for 437,91 ֏: −0,67 ₽ against the market, −2,89 ֏ of 434,76 ֏ once in drams.
    const chart = rateChart(
      [{ ...rub, side: 'bankSells', rows: [row('2026-09-25', '4.40', { side: 'bankSells' })] }],
      [
        exchange('2026-09-29', {
          given: 'AMD',
          received: 'RUB',
          amount: 100,
          rate: '4.3791',
          best: { rate: '4.35', difference: 0 },
          measured: { difference: -289n, expected: 43_476n },
        }),
      ],
      TODAY,
    )
    expect(year(chart)?.exchanges[0]?.percent).toBe(-66)
  })

  it('has no percent where «Обмены против рынка» has no comparison', () => {
    const chart = rateChart(
      [rub],
      [exchange('2026-09-29', { best: { rate: '4.11', difference: 400 }, measured: null })],
      TODAY,
    )
    expect(year(chart)?.exchanges[0]).toMatchObject({
      percent: null,
      market: { basis: 'bankCash' },
    })
  })

  it('keeps two exchanges of one day in the order they were made, whatever their ids', () => {
    // The list comes newest first: the evening's exchange, then the morning's.
    const chart = rateChart(
      [rub],
      [
        exchange('2026-09-22', { id: '00000000-0000-4000-8000-000000000001', note: 'Обменник' }),
        exchange('2026-09-22', { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff', note: 'Ардшинбанк' }),
      ],
      TODAY,
    )
    expect(year(chart)?.exchanges.map(({ place }) => place)).toEqual(['Ардшинбанк', 'Обменник'])
  })

  it('compares nothing where the market would have given nothing, as «Обмены против рынка»', () => {
    const chart = rateChart(
      [rub],
      [exchange('2026-09-22', { amount: 100, best: { rate: '4.10', difference: 100 } })],
      TODAY,
    )
    expect(year(chart)?.exchanges[0]).toMatchObject({ percent: null, market: null })
  })

  it('draws neither the other side, nor another pair, nor the days outside the window', () => {
    const chart = rateChart(
      [rub],
      [
        exchange('2026-09-21', { given: 'AMD', received: 'RUB', rate: '4.60' }),
        exchange('2026-09-21', { given: 'USD', rate: '386' }),
        exchange('2025-10-01'),
        exchange('2026-10-03'),
        exchange('2026-09-21', { rate: null }),
      ],
      TODAY,
    )
    expect(year(chart)?.exchanges).toEqual([])
  })

  it('lays the ticks over the line, the points and the marks alike', () => {
    const chart = rateChart(
      [rub],
      [exchange('2026-09-29', { rate: '4.95', best: { rate: '4.11', difference: 0 } })],
      TODAY,
    )
    const pair = year(chart)
    // 4,11 is the lowest figure, 4,95 the highest: the middle is 4,53.
    expect(pair?.levels.map(({ rate }) => rate.scaled)).toEqual(
      ['4.20', '4.50', '4.80'].map(parseRate),
    )
    expect(pair?.exchanges[0]?.level).toBe(CHART_LEVEL)
    expect(pair?.exchanges[0]?.market?.level).toBe(0)
  })

  it('stands at half height when every figure is one, on a scale of a hundredth of it', () => {
    const chart = rateChart(
      [{ ...rub, rows: [row('2026-09-25', '4.15')] }],
      [exchange('2026-09-29')],
      TODAY,
    )
    const pair = year(chart)
    expect(pair?.levels).toEqual([
      { rate: drams('4.13', TODAY), level: 18 },
      { rate: drams('4.15', TODAY), level: CHART_LEVEL / 2 },
      { rate: drams('4.17', TODAY), level: 982 },
    ])
    expect(pair?.exchanges[0]?.level).toBe(CHART_LEVEL / 2)
  })

  it('keeps a flat line off a round figure at half height, its ticks round within the scale', () => {
    const chart = rateChart(
      [{ ...rub, rows: [row('2026-09-25', '4.152')] }],
      [exchange('2026-09-29', { rate: '4.152' })],
      TODAY,
    )
    const pair = year(chart)
    expect(pair?.levels.map(({ rate }) => rate.scaled)).toEqual(
      ['4.14', '4.15', '4.16'].map(parseRate),
    )
    expect(pair?.steps.at(-1)?.level).toBe(CHART_LEVEL / 2)
    expect(pair?.exchanges[0]?.level).toBe(CHART_LEVEL / 2)
  })

  it('draws 0,07 % off a flat year as 0,07 %, not the whole height (adversarial Г2)', () => {
    // A year of 4,60, and 10 000 ₽ changed for 46 034 ֏ on a day the market gave 46 000 ֏.
    const chart = rateChart(
      [{ ...rub, rows: [row('2026-09-25', '4.60')] }],
      [
        exchange('2026-09-29', {
          rate: '4.6034',
          amount: 46_034,
          best: { rate: '4.60', difference: 34 },
        }),
      ],
      TODAY,
    )
    const point = year(chart)?.exchanges[0]
    expect(point?.percent).toBe(7)
    // A scale of 0,046 around 4,6017: the point and its mark some 74 thousandths apart.
    expect((point?.level ?? 0) - (point?.market?.level ?? 0)).toBe(74)
  })

  it("says the exchange's own rate is the person's", () => {
    const chart = rateChart([rub], [exchange('2026-09-29')], TODAY)
    expect(year(chart)?.exchanges[0]?.rate.source).toBe('personal')
  })

  it('leaves out a pair with no figure in any week, and is null with none left', () => {
    const usd = { currency: 'USD' as const, side: 'bankBuys' as const, rows: [] }
    expect(rateChart([rub, usd], [], TODAY)?.pairs.map(({ currency }) => currency)).toEqual(['RUB'])
    expect(rateChart([usd], [exchange('2026-09-21', { given: 'USD' })], TODAY)).toBeNull()
    expect(rateChart([], [], TODAY)).toBeNull()
  })
})

describe('ratePeriodFrom', () => {
  it('looks back from the day after the same day of the month (MOL-168, В-1 «б»)', () => {
    expect(RATE_CHART_MONTHS.map((months) => ratePeriodFrom(TODAY, months))).toEqual([
      '2026-09-03',
      '2026-04-03',
      YEAR_FROM,
    ])
  })

  it('takes the last day of a shorter month for the same day, a leap February too', () => {
    expect(ratePeriodFrom('2026-03-31', 1)).toBe('2026-03-01')
    expect(ratePeriodFrom('2028-03-31', 1)).toBe('2028-03-01')
    expect(ratePeriodFrom('2026-12-31', 1)).toBe('2026-12-01')
    expect(ratePeriodFrom('2026-08-31', 6)).toBe('2026-03-01')
    expect(ratePeriodFrom('2028-02-29', 12)).toBe('2027-03-01')
    expect(ratePeriodFrom('2026-03-30', 1)).toBe('2026-03-01')
  })

  it('looks back whole months on the last day of a month (adversarial round 2, В′)', () => {
    // The day after the 30th of October is still October: the 30th of November from the 1st.
    expect(ratePeriodFrom('2026-11-30', 1)).toBe('2026-11-01')
    expect(ratePeriodFrom('2027-02-28', 1)).toBe('2027-02-01')
    expect(ratePeriodFrom('2027-04-30', 6)).toBe('2026-11-01')
    expect(ratePeriodFrom('2029-02-28', 12)).toBe('2028-03-01')
    expect(ratePeriodFrom('2026-12-31', 12)).toBe('2026-01-01')
    // The day before the last is not the last: the day after the same day, as on any day.
    expect(ratePeriodFrom('2026-11-29', 1)).toBe('2026-10-30')
  })

  it('crosses the year back', () => {
    expect(ratePeriodFrom('2026-01-15', 1)).toBe('2025-12-16')
    expect(ratePeriodFrom('2026-03-02', 6)).toBe('2025-09-03')
    expect(ratePeriodFrom('2026-01-31', 1)).toBe('2026-01-01')
  })

  it('makes the year of the chart the window of «Обмены против рынка»', () => {
    expect(RATE_CHART_MONTHS.at(-1)).toBe(EXCHANGE_LOSS_MONTHS)
  })
})

describe('rateDays', () => {
  it('reads every day from the first to today, across a month', () => {
    expect(rateDays('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
    expect(rateDays(TODAY, TODAY)).toEqual([TODAY])
  })
})

describe('rateChart by period (MOL-168)', () => {
  // The bank publishes on working days: Friday the 25th and Monday the 28th, nothing between.
  const rows = [
    row('2026-03-20', '4.60'),
    row('2026-09-25', '4.22'),
    row('2026-09-28', '4.20'),
    row('2026-10-02', '4.25'),
  ]
  const rub = { currency: 'RUB' as const, side: 'bankBuys' as const, rows }

  it('reads the month by days and half a year and the year by weeks', () => {
    const periods = rateChart([rub], [], TODAY)?.pairs[0]?.periods
    expect(periods?.[1]?.step).toBe('day')
    expect(periods?.[1]?.steps).toHaveLength(30)
    expect(periods?.[1]?.steps[0]).toMatchObject({ day: '2026-09-03', x: 0 })
    expect(periods?.[1]?.steps.at(-1)).toMatchObject({ day: TODAY, x: CHART_LEVEL })
    expect(periods?.[6]?.step).toBe('week')
    expect(periods?.[6]?.steps[0]?.day).toBe('2026-04-05')
    expect(periods?.[12]?.steps).toHaveLength(rateWeeks(YEAR_FROM, TODAY).length)
  })

  it("draws a weekend of the month at Friday's figure, the one its exchange is measured by (В-2 «а»)", () => {
    const month = rateChart([rub], [], TODAY)?.pairs[0]?.periods[1]
    const on = (day: string) => month?.steps.find((step) => step.day === day)?.rate
    expect(on('2026-09-26')).toEqual(drams('4.22', '2026-09-25'))
    expect(on('2026-09-27')).toEqual(drams('4.22', '2026-09-25'))
    expect(on('2026-09-28')).toEqual(drams('4.20', '2026-09-28'))
    // Eight days and more with no row is a gap, as for a week.
    expect(on('2026-09-03')).toBeNull()
  })

  it('puts an exchange of a Sunday on its own day of the month and in its week of the year', () => {
    const chart = rateChart([rub], [exchange('2026-09-27')], TODAY)
    const month = chart?.pairs[0]?.periods[1]
    const year = chart?.pairs[0]?.periods[12]
    const point = month?.exchanges[0]
    expect(month?.steps[point?.step ?? -1]?.day).toBe('2026-09-27')
    expect(year?.steps[year.exchanges[0]?.step ?? -1]?.day).toBe('2026-09-27')
    // The 24th day of 29 in the month, the 359th of 364 in the year.
    expect(point?.x).toBe(828)
    expect(year?.exchanges[0]?.x).toBe(986)
  })

  it('takes an exchange of the first day of a period, and leaves out the day before', () => {
    const chart = rateChart([rub], [exchange('2026-09-03'), exchange('2026-09-02')], TODAY)
    const days = (months: 1 | 6 | 12) =>
      chart?.pairs[0]?.periods[months]?.exchanges.map(({ day }) => day)
    expect(days(1)).toEqual(['2026-09-03'])
    expect(days(6)).toEqual(['2026-09-02', '2026-09-03'])
    const year = (day: string) =>
      rateChart([rub], [exchange(day)], TODAY)?.pairs[0]?.periods[12]?.exchanges
    expect(year(YEAR_FROM)).toHaveLength(1)
    expect(year('2025-10-02')).toEqual([])
  })

  it('holds one exchange of the last day of a month, on the last day of a shorter one (В′)', () => {
    const ends = [
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
      '2028-07-31',
    ]
      .concat(['2028-08-31', '2028-09-30', '2028-10-31', '2028-11-30', '2028-12-31', '2029-01-31'])
      .concat(['2029-02-28'])
    const line = { ...rub, rows: [row('2029-02-27', '4.20')] }
    const periods = rateChart([line], ends.map((day) => exchange(day)).reverse(), '2029-02-28')
      ?.pairs[0]?.periods
    expect(periods?.[1]?.exchanges.map(({ day }) => day)).toEqual(['2029-02-28'])
    expect(periods?.[6]?.exchanges).toHaveLength(6)
    expect(periods?.[12].exchanges).toHaveLength(12)
  })

  it('holds one monthly exchange a month and twelve a year, on the very day of one (adversarial В)', () => {
    // 20 000 ₽ on the 2nd of every month, 2 October 2025 to 2 October 2026; today is the 2nd.
    const monthly = Array.from({ length: 13 }, (_, index) => {
      const month = 9 + index
      const year = 2025 + Math.floor(month / 12)
      return exchange(`${String(year)}-${String((month % 12) + 1).padStart(2, '0')}-02`)
    }).reverse()
    const periods = rateChart([rub], monthly, TODAY)?.pairs[0]?.periods
    expect(periods?.[1]?.exchanges.map(({ day }) => day)).toEqual([TODAY])
    expect(periods?.[6]?.exchanges).toHaveLength(6)
    expect(periods?.[12].exchanges).toHaveLength(12)
  })

  it('scales each period by its own figures: the month is not pressed by the spring', () => {
    const periods = rateChart([rub], [], TODAY)?.pairs[0]?.periods
    expect(periods?.[12]?.levels.map(({ rate }) => rate.scaled)).toEqual(
      ['4.30', '4.40', '4.50'].map(parseRate),
    )
    expect(periods?.[1]?.levels.map(({ rate }) => rate.scaled)).toEqual(
      ['4.21', '4.23', '4.25'].map(parseRate),
    )
  })

  it('keeps the pair of the year in a month with none of its exchanges: a line with no points (Р-1)', () => {
    const usd = {
      currency: 'USD' as const,
      side: 'bankBuys' as const,
      rows: [
        row('2026-05-04', '386', { currency: 'USD' }),
        row('2026-09-28', '384', { currency: 'USD' }),
      ],
    }
    const chart = rateChart(
      [rub, usd],
      [exchange('2026-05-04', { given: 'USD', rate: '386' })],
      TODAY,
    )
    const dollar = chart?.pairs.find(({ currency }) => currency === 'USD')
    expect(dollar?.periods[1]?.exchanges).toEqual([])
    expect(dollar?.periods[6]?.exchanges).toHaveLength(1)
  })

  it('has no month with no figure in it while the year has one (Р-6)', () => {
    const spring = { ...rub, rows: [row('2026-05-20', '4.60')] }
    const periods = rateChart([spring], [exchange('2026-09-22')], TODAY)?.pairs[0]?.periods
    expect(periods?.[1]).toBeNull()
    expect(periods?.[6]?.steps.some(({ rate }) => rate !== null)).toBe(true)
    expect(periods?.[12]).toBeTruthy()
  })
})
