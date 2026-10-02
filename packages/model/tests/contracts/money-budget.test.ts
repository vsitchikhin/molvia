import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  budgetPlanBodySchema,
  moneyBudgetCodec,
  moneyBudgetViewOf,
} from '#model/contracts/money-budget'
import { monthBudget } from '#model/entities/money-budget'
import type { MoneyMonth } from '#model/entities/money-month'
import { SPENDING_PRESETS } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { money } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const CATEGORY = '00000000-0000-4000-9000-000000000003'
const categories: SpendingCategory[] = SPENDING_PRESETS.map((preset, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  actorId: OWNER,
  preset,
  name: null,
  colour: null,
  archivedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
}))

const october: MoneyMonth = {
  month: '2026-10',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  spent: money(26_000_000n, 'AMD'),
  uncounted: [],
  uncountedIn: [],
  foreign: [],
  spentIncome: money(6_046_512n, 'RUB'),
  income: money(18_000_000n, 'RUB'),
  incomeUncounted: [],
  incomeCount: 1,
  shiftedIn: [],
  shiftedOut: [],
  rest: null,
  accountsFrom: null,
  accountsRemoved: false,
  rate: {
    base: 'RUB',
    quote: 'AMD',
    scaled: parseRate('4.3'),
    source: 'official',
    asOf: yerevanMidnight('2026-10-01'),
  },
  rateKind: 'live',
  byCategory: [{ categoryId: CATEGORY, amount: money(26_000_000n, 'AMD') }],
  days: [],
}

describe('PUT /budget/plans body (MOL-117)', () => {
  const body = { categoryId: CATEGORY, from: '2026-10' }

  it('takes a sum, a whole percent, or no plan', () => {
    expect(
      budgetPlanBodySchema.parse({
        ...body,
        plan: { kind: 'amount', amount: { amount: '250000', currency: 'AMD' } },
      }).plan,
    ).toEqual({ kind: 'amount', amount: money(25_000_000n, 'AMD') })
    expect(
      budgetPlanBodySchema.parse({ ...body, plan: { kind: 'share', percent: 10 } }).plan,
    ).toEqual({ kind: 'share', percent: 10 })
    expect(budgetPlanBodySchema.parse({ ...body, plan: null }).plan).toBeNull()
  })

  it.each([
    ['a percent past a hundred', { kind: 'share', percent: 101 }],
    ['a percent below zero', { kind: 'share', percent: -1 }],
    ['a fraction of a percent', { kind: 'share', percent: 2.5 }],
    ['a sum below zero', { kind: 'amount', amount: { amount: '-1', currency: 'AMD' } }],
  ])('refuses %s', (_, plan) => {
    expect(budgetPlanBodySchema.safeParse({ ...body, plan }).success).toBe(false)
  })

  it('takes a sum up to ten trillion drams and refuses one past it (Н of round 6)', () => {
    const sum = (amount: string) => ({
      ...body,
      plan: { kind: 'amount', amount: { amount, currency: 'AMD' } },
    })
    expect(budgetPlanBodySchema.safeParse(sum('10000000000000')).success).toBe(true)
    const past = budgetPlanBodySchema.safeParse(sum('10000000000000.01'))
    expect(past.success).toBe(false)
    expect(past.error?.issues[0]?.message).toBe('error.invalid_amount')
  })

  it('takes the savings target as a share and never as a sum (В-4)', () => {
    const savings = { categoryId: null, from: '2026-10' }
    expect(
      budgetPlanBodySchema.safeParse({ ...savings, plan: { kind: 'share', percent: 25 } }).success,
    ).toBe(true)
    expect(budgetPlanBodySchema.safeParse({ ...savings, plan: null }).success).toBe(true)
    expect(
      budgetPlanBodySchema.safeParse({
        ...savings,
        plan: { kind: 'amount', amount: { amount: '1', currency: 'AMD' } },
      }).success,
    ).toBe(false)
  })

  it('refuses a month that is none, and a field it does not know', () => {
    expect(budgetPlanBodySchema.safeParse({ ...body, from: '2026-13', plan: null }).success).toBe(
      false,
    )
    expect(budgetPlanBodySchema.safeParse({ ...body, plan: null, actorId: OWNER }).success).toBe(
      false,
    )
  })
})

describe('GET /money/months/:month/budget answer (MOL-117)', () => {
  it('goes over the wire and back as it was, over the plan below zero', () => {
    const budget = monthBudget(
      october,
      [
        {
          categoryId: CATEGORY,
          from: '2026-09',
          plan: { kind: 'amount', amount: money(25_000_000n, 'AMD') },
        },
        { categoryId: null, from: '2026-09', plan: { kind: 'share', percent: 25 } },
      ],
      categories,
    )
    const view = moneyBudgetViewOf(
      budget,
      { spendCurrency: 'AMD', incomeCurrency: 'RUB' },
      categories,
    )
    const wire = z.encode(moneyBudgetCodec, view)
    expect(wire.rows[0]?.left).toEqual({ amount: '-10000.00', currency: 'AMD' })
    expect(moneyBudgetCodec.parse(wire)).toEqual(view)
    expect(view.categories).toHaveLength(SPENDING_PRESETS.length)
    expect(view.savings).toMatchObject({ target: 25, actual: 66 })
  })
})
