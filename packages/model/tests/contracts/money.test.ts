import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MONEY_JOURNAL_PAGE,
  moneyMonthCodec,
  moneyMonthQuerySchema,
  moneyMonthViewOf,
  monthSchema,
} from '#model/contracts/money'
import type { MoneyMonthView } from '#model/contracts/money'
import { moneyMonth } from '#model/entities/money-month'
import type { Spending } from '#model/entities/spending'
import { SPENDING_PRESETS } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { money } from '#model/values/money'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const categories: SpendingCategory[] = SPENDING_PRESETS.map((preset, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  actorId: OWNER,
  preset,
  name: null,
  colour: null,
  archivedAt: index === 0 ? new Date('2026-09-10T00:00:00Z') : null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
}))

function spendings(count: number, day: (index: number) => string): Spending[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    actorId: OWNER,
    spentOn: day(index),
    amount: money(100n, 'AMD'),
    categoryId: categories[12]!.id,
    note: null,
    place: null,
    rate: null,
    revision: 1,
    createdAt: new Date(`${day(index)}T10:${String(index % 60).padStart(2, '0')}:00Z`),
    amendedAt: null,
  }))
}

const OTHER = '00000000-0000-4000-8000-999999999999'

function idsOf(view: MoneyMonthView): string[] {
  return view.days.flatMap((day) =>
    day.entries.map((entry) => (entry.kind === 'manual' ? entry.spending.id : entry.tripId)),
  )
}

function monthOf(list: Spending[]) {
  return moneyMonth({
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spendings: list,
    trips: [],
    incomes: [],
    categories,
    rate: null,
    rateKind: 'live',
    inSpend: () => null,
    incomeInIncome: () => null,
  })
}

describe('a month on the wire', () => {
  it('sends the journal a page at a time, and a day cut by the page keeps its whole total', () => {
    // 50 spendings, all on one day: the first page holds 40 of them.
    const view = moneyMonthViewOf(monthOf(spendings(50, () => '2026-09-20')), null, categories)
    expect(view.days).toHaveLength(1)
    expect(view.days[0]?.entries).toHaveLength(MONEY_JOURNAL_PAGE)
    expect(view.days[0]?.total).toEqual(money(5000n, 'AMD'))
    expect(view.remaining).toBe(10)

    const next = moneyMonthViewOf(
      monthOf(spendings(50, () => '2026-09-20')),
      null,
      categories,
      view.cursor ?? undefined,
    )
    expect(next.days[0]?.entries).toHaveLength(10)
    expect(next).toMatchObject({ cursor: null, remaining: 0, remainingFrom: null })
  })

  it('starts the next page after the last row shown, whatever was written or removed above (Д3)', () => {
    const list = spendings(45, () => '2026-09-20')
    const first = moneyMonthViewOf(monthOf(list), null, categories)
    const shown = idsOf(first)
    const newer = spendings(1, () => '2026-09-21').map((row) => ({ ...row, id: OTHER }))
    const withNew = moneyMonthViewOf(
      monthOf([...newer, ...list]),
      null,
      categories,
      first.cursor ?? undefined,
    )
    expect(idsOf(withNew).filter((id) => shown.includes(id))).toEqual([])
    expect(idsOf(withNew)).toHaveLength(5)

    const withoutFirst = list.filter((row) => row.id !== shown[0])
    const after = moneyMonthViewOf(
      monthOf(withoutFirst),
      null,
      categories,
      first.cursor ?? undefined,
    )
    expect(new Set([...shown, ...idsOf(after)]).size).toBe(45)
  })

  it('crosses the wire as the key of the row, and reads back as one', () => {
    const view = moneyMonthViewOf(monthOf(spendings(41, () => '2026-09-20')), null, categories)
    const wire = z.encode(moneyMonthCodec, view)
    expect(wire.cursor).toMatch(/^2026-09-20~\d+~[\da-f-]{36}$/)
    expect(moneyMonthQuerySchema.parse({ cursor: wire.cursor }).cursor).toEqual(view.cursor)
    expect(moneyMonthQuerySchema.safeParse({ cursor: '40' }).success).toBe(false)
  })

  it('is a month of days a rate may be dated by — not year zero (Д4)', () => {
    expect(monthSchema.safeParse('2026-09').success).toBe(true)
    expect(monthSchema.safeParse('2000-01').success).toBe(true)
    expect(monthSchema.safeParse('1999-12').success).toBe(false)
    expect(monthSchema.safeParse('0000-01').success).toBe(false)
    expect(monthSchema.safeParse('2026-13').success).toBe(false)
  })

  it('names the days still to come for «И ещё N трат за …»', () => {
    const list = spendings(
      45,
      (index) => `2026-09-${String(28 - Math.floor(index / 2)).padStart(2, '0')}`,
    )
    const view = moneyMonthViewOf(monthOf(list), null, categories)
    expect(view.remaining).toBe(5)
    expect(view.remainingTo).toBe('2026-09-08')
    expect(view.remainingFrom).toBe('2026-09-06')
  })

  it('names every category, the removed ones marked, and encodes to the contract', () => {
    const view = moneyMonthViewOf(monthOf(spendings(1, () => '2026-09-01')), null, categories)
    expect(view.categories[0]).toMatchObject({ preset: 'groceries', archived: true })
    expect(() => z.encode(moneyMonthCodec, view)).not.toThrow()
  })
})
