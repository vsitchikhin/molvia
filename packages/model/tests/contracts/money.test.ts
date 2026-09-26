import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MONEY_JOURNAL_PAGE, moneyMonthCodec, moneyMonthViewOf } from '#model/contracts/money'
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
    tripInSpend: () => null,
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
    expect(view).toMatchObject({ cursor: MONEY_JOURNAL_PAGE, remaining: 10 })

    const next = moneyMonthViewOf(monthOf(spendings(50, () => '2026-09-20')), null, categories, 40)
    expect(next.days[0]?.entries).toHaveLength(10)
    expect(next).toMatchObject({ cursor: null, remaining: 0, remainingFrom: null })
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
