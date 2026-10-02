import { describe, expect, it } from 'vitest'
import {
  CHART_LEVEL,
  chartMonths,
  DONUT_SECTORS,
  donutSlices,
  exchangeLosses,
} from '#model/entities/money-charts'
import type { ExchangeLossInput } from '#model/entities/money-charts'
import { money } from '#model/values/money'
import type { Money } from '#model/values/money'

const amd = (major: number): Money => money(BigInt(major) * 100n, 'AMD')

describe('chartMonths', () => {
  it('ends with the current month and crosses a year', () => {
    expect(chartMonths('2026-03', 6)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ])
    expect(chartMonths('2026-09', 12)).toHaveLength(12)
    expect(chartMonths('2026-09', 1)).toEqual(['2026-09'])
  })
})

/** The categories of a month as `moneyMonth` orders them, largest first, in drams. */
function categories(...amounts: number[]): { categoryId: string; amount: Money }[] {
  return amounts.map((amount, index) => ({
    categoryId: `c${String(index + 1)}`,
    amount: amd(amount),
  }))
}

describe('donutSlices', () => {
  it('draws nothing for a month with nothing in a category', () => {
    expect(donutSlices([])).toEqual([])
  })

  it('gives one category the whole ring', () => {
    expect(donutSlices(categories(5_000))).toEqual([
      { categoryId: 'c1', amount: amd(5_000), count: 1, level: CHART_LEVEL },
    ])
  })

  it('names all seven: an «Остальные» of one would hide a name for nothing', () => {
    const slices = donutSlices(categories(70, 60, 50, 40, 30, 20, 10))
    expect(slices).toHaveLength(DONUT_SECTORS + 1)
    expect(slices.every((slice) => slice.categoryId !== null && slice.count === 1)).toBe(true)
  })

  it('puts everything past six into «Остальные», last, with how many it holds', () => {
    const slices = donutSlices(categories(80, 70, 60, 50, 40, 30, 20, 10))
    expect(slices.map((slice) => slice.categoryId)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      null,
    ])
    expect(slices.at(-1)).toMatchObject({ amount: amd(30), count: 2 })
  })

  it('keeps the sum of the month and closes the ring exactly (handoff MOL-157 figures)', () => {
    const month = categories(68_076, 60_318, 51_294, 43_728, 20_390, 17_917, 6_500, 3_600, 2_700)
    const slices = donutSlices(month)
    expect(slices.reduce((sum, slice) => sum + slice.amount.minor, 0n)).toBe(amd(274_523).minor)
    expect(slices.reduce((sum, slice) => sum + slice.level, 0)).toBe(CHART_LEVEL)
    expect(slices.at(-1)).toMatchObject({ categoryId: null, amount: amd(12_800), count: 3 })
    expect(slices[0]?.level).toBe(248)
  })

  it('shares the rounding out by the largest remainder, the earlier first on a tie', () => {
    expect(donutSlices(categories(1, 1, 1)).map((slice) => slice.level)).toEqual([334, 333, 333])
    expect(donutSlices(categories(2, 1)).map((slice) => slice.level)).toEqual([667, 333])
  })

  it('leaves a sector a level of nothing rather than none, when it is a crumb of the month', () => {
    const slices = donutSlices(categories(1_000_000, 1))
    expect(slices.map((slice) => slice.level)).toEqual([CHART_LEVEL, 0])
    expect(slices).toHaveLength(2)
  })
})

function loss(
  note: string | null,
  difference: number | null,
  expected: number | null,
  exchangedOn = '2026-09-10',
): ExchangeLossInput {
  return {
    note,
    exchangedOn,
    difference: difference === null ? null : amd(difference),
    expected: expected === null ? null : amd(expected),
  }
}

describe('exchangeLosses', () => {
  it('groups by the place as a name is read, and names it as the newest wrote it', () => {
    const losses = exchangeLosses(
      [
        loss('аэропорт', -1000, 100_000, '2026-08-01'),
        loss(' Аэропорт ', -1000, 100_000, '2026-09-01'),
        loss('аэро⁠порт', -1000, 100_000, '2026-07-01'),
        loss(null, 500, 50_000),
      ],
      'AMD',
    )
    expect(losses?.groups.map((group) => [group.place, group.count])).toEqual([
      ['Аэропорт', 3],
      [null, 1],
    ])
    expect(losses?.total).toEqual(amd(-2500))
  })

  it('weighs the percent by the money, not by the exchange (Р-7)', () => {
    const losses = exchangeLosses([loss('банк', -100, 10_000), loss('банк', -10, 100)], 'AMD')
    // −110 of 10 100: −1,09 %, where the mean of −1 % and −10 % would say −5,5 %.
    expect(losses?.groups[0]?.percent).toBe(-109)
  })

  it('puts the worst first and measures every bar against the widest, with its sign', () => {
    const losses = exchangeLosses(
      [loss('fast bank', 27, 10_000), loss('аэропорт', -721, 10_000), loss('втб', -149, 10_000)],
      'AMD',
    )
    expect(losses?.groups.map((group) => [group.place, group.percent, group.level])).toEqual([
      ['аэропорт', -721, -CHART_LEVEL],
      ['втб', -149, -207],
      ['fast bank', 27, 37],
    ])
  })

  it('names what could not be measured or converted and sums none of it', () => {
    const losses = exchangeLosses(
      [loss('банк', -100, 10_000), loss('банк', null, null), loss('касса', -5, null)],
      'AMD',
    )
    expect(losses?.uncounted).toBe(2)
    expect(losses?.total).toEqual(amd(-100))
    expect(losses?.groups).toHaveLength(1)
  })

  it('is no card when nothing is measured', () => {
    expect(exchangeLosses([], 'AMD')).toBeNull()
    expect(exchangeLosses([loss('банк', null, null)], 'AMD')).toBeNull()
  })

  it('reads a zero difference as zero percent, and the only group as the widest', () => {
    const losses = exchangeLosses([loss('банк', 0, 10_000)], 'AMD')
    expect(losses?.groups[0]).toMatchObject({ percent: 0, level: 0 })
  })
})
